import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringConfigService } from './scoring-config.service.js';
import { PhaseService } from './phase.service.js';
import { classifyOutcome } from './classify-outcome.js';
import {
  MatchAlreadyFinishedException,
  MatchNotFinishedException,
  PhaseAlreadyPaidException,
} from '../../common/exceptions/domain.exceptions.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import type { Match } from '../../../generated/prisma/client.js';

/**
 * BullMQ job names produced by the scoring flow. Routed by the
 * dispatching `NotificationsProcessor` (and, for `leaderboard.refresh`,
 * the `LeaderboardRefreshProcessor` registered there in Task 8.9).
 */
export const LEADERBOARD_REFRESH_JOB = 'leaderboard.refresh';
/**
 * BullMQ rejects custom job ids that contain `:` because it reserves
 * that character for its internal Redis key namespacing. The spec calls
 * the dedup key `leaderboard:refresh`; we keep the human-readable name
 * here for the audit trail and use {@link LEADERBOARD_REFRESH_JOB_ID}
 * (with `_` swapped in) as the actual job id passed to BullMQ.
 */
export const LEADERBOARD_REFRESH_DEDUP_KEY = 'leaderboard:refresh';
export const LEADERBOARD_REFRESH_JOB_ID = 'leaderboard_refresh';
export const MATCH_RESULT_JOB = 'match-result';

/**
 * Orchestrates the "admin loaded a result" flow described in spec 6.3.
 *
 * The hot path is `finishMatchAndScore`:
 *   1. Pre-checks (status != FINISHED, phase not already paid out) outside
 *      any TX so the user gets fast 4xx feedback when they're blocked.
 *   2. Resolve scoring rules + phase multiplier from cache.
 *   3. One Prisma TX with a 30-second timeout: update the match (with
 *      `status: { not: 'FINISHED' }` guard so a concurrent admin call
 *      can't double-score), pull the predictions, score them sequentially
 *      (Prisma TX shares ONE pooled connection — Promise.all here would
 *      either serialise anyway or throw connection-busy), then write the
 *      audit log.
 *   4. POST-COMMIT side effects: enqueue `leaderboard.refresh` (deduped
 *      via stable `jobId`), enqueue `match-result` (consumed by Phase 11
 *      worker), and call `phaseService.maybeClosePhase` (Task 8.7).
 *
 * `recalculateMatch` mirrors the same shape but pivots the guard rails:
 * the match MUST be FINISHED, and we record before/after scores in the
 * audit log so the trail can answer "what changed and when".
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringConfig: ScoringConfigService,
    private readonly phaseService: PhaseService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  async finishMatchAndScore(
    matchId: string,
    scoreHome: number,
    scoreAway: number,
    adminUserId: string,
  ): Promise<Match> {
    // ── Pre-checks (outside TX) ────────────────────────────────────────
    const matchPrev = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
    });
    if (matchPrev.status === 'FINISHED') {
      throw new MatchAlreadyFinishedException();
    }
    const phaseWinner = await this.prisma.phaseWinner.findUnique({
      where: { phase: matchPrev.phase },
    });
    if (phaseWinner?.prizeStatus === 'PAID') {
      throw new PhaseAlreadyPaidException();
    }

    const rules = await this.scoringConfig.getRules();
    const multipliers = await this.scoringConfig.getMultipliers();
    const multiplier = multipliers[matchPrev.phase];

    // ── Atomic update + scoring ───────────────────────────────────────
    let predictionsScored = 0;
    let updated: Match | null = null;
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Atomic guard: if a concurrent caller already FINISHED this
        //    match, this update affects 0 rows and Prisma throws —
        //    Promise rejects, TX rolls back, we surface a 400 from the
        //    pre-check on retry. Cleaner than a SELECT … FOR UPDATE.
        updated = await tx.match.update({
          where: { id: matchId, status: { not: 'FINISHED' } },
          data: {
            scoreHome,
            scoreAway,
            status: 'FINISHED',
            finishedAt: new Date(),
          },
        });

        // 2. Pull every prediction for this match.
        const predictions = await tx.prediction.findMany({
          where: { matchId },
        });
        predictionsScored = predictions.length;

        // 3. Sequential update — Prisma TX shares one pooled connection.
        //    Promise.all here would either serialise anyway or throw
        //    "Transaction already closed" on a busy connection.
        for (const p of predictions) {
          const outcomeType = classifyOutcome(
            { scoreHome: p.scoreHome, scoreAway: p.scoreAway },
            { scoreHome, scoreAway },
          );
          const basePoints = rules[outcomeType] ?? 0;
          const pointsEarned = Math.round(basePoints * multiplier);
          await tx.prediction.update({
            where: { id: p.id },
            data: {
              outcomeType,
              basePoints,
              multiplier,
              pointsEarned,
              evaluatedAt: new Date(),
            },
          });
        }

        // 4. Audit row inside the same TX so it commits atomically with
        //    the rest. The interceptor-driven audit log is for HTTP
        //    side-effects; this is the domain event of record.
        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'match.finished',
            entity: 'match',
            entityId: matchId,
            changes: {
              score: { home: scoreHome, away: scoreAway },
              predictionsScored: predictions.length,
            },
          },
        });
      },
      { timeout: 30_000 },
    );

    // ── POST-COMMIT side effects ──────────────────────────────────────
    // Refresh the leaderboard MV asynchronously. `jobId` provides
    // BullMQ-level dedup: two finishes in quick succession share one
    // pending refresh.
    await this.enqueueLeaderboardRefresh();
    // Fan-out match-result notifications (Phase 11 worker).
    await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
    // Phase progression hook (full impl arrives in Task 8.7).
    await this.phaseService.maybeClosePhase(matchPrev.phase);

    this.logger.log(
      `Match ${matchId} finished: scored ${predictionsScored} predictions, multiplier=${multiplier}`,
    );

    return updated!;
  }

  /**
   * Re-scores an already-FINISHED match after the admin corrected the
   * scoreline. Same shape as `finishMatchAndScore` but with flipped guard
   * rails:
   *
   *   - The match MUST be FINISHED (a never-finished match should go
   *     through the regular `finishMatchAndScore` path).
   *   - The phase MUST NOT have a paid PhaseWinner — once the prize is
   *     out, the match is immutable.
   *
   * The audit row carries `before` and `after` so the trail answers
   * "what changed and when" without re-reading a different table. The
   * post-commit side effects mirror the finish path: refresh the
   * leaderboard MV, fan-out a fresh `match-result` notification batch
   * (the message body changes when the scoreline does), and re-trigger
   * `maybeClosePhase` (idempotent — the phase's PhaseWinner row would
   * already exist if the phase had previously closed).
   *
   * Note: we deliberately do NOT call `maybeClosePhase` from inside the
   * TX. The spec's safe-guard against double-creation of `PhaseWinner`
   * lives there (it findUnique's the row before inserting).
   */
  async recalculateMatch(
    matchId: string,
    scoreHome: number,
    scoreAway: number,
    adminUserId: string,
  ): Promise<Match> {
    // ── Pre-checks (outside TX) ────────────────────────────────────────
    const matchPrev = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
    });
    if (matchPrev.status !== 'FINISHED') {
      throw new MatchNotFinishedException();
    }
    const phaseWinner = await this.prisma.phaseWinner.findUnique({
      where: { phase: matchPrev.phase },
    });
    if (phaseWinner?.prizeStatus === 'PAID') {
      throw new PhaseAlreadyPaidException();
    }

    const before = {
      scoreHome: matchPrev.scoreHome,
      scoreAway: matchPrev.scoreAway,
    };

    const rules = await this.scoringConfig.getRules();
    const multipliers = await this.scoringConfig.getMultipliers();
    const multiplier = multipliers[matchPrev.phase];

    let predictionsScored = 0;
    let updated: Match | null = null;
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Replace the score. We don't re-check status inside the TX
        //    because the pre-check already proved status === FINISHED;
        //    a concurrent recalculate writing the same row would race
        //    on `updatedAt` but produce a deterministic last-writer-wins
        //    outcome — both calls produce valid scoring states.
        updated = await tx.match.update({
          where: { id: matchId },
          data: { scoreHome, scoreAway },
        });

        // 2. Re-score every prediction with the new result. The prior
        //    points have to be cleared first via the same update path.
        const predictions = await tx.prediction.findMany({
          where: { matchId },
        });
        predictionsScored = predictions.length;

        for (const p of predictions) {
          const outcomeType = classifyOutcome(
            { scoreHome: p.scoreHome, scoreAway: p.scoreAway },
            { scoreHome, scoreAway },
          );
          const basePoints = rules[outcomeType] ?? 0;
          const pointsEarned = Math.round(basePoints * multiplier);
          await tx.prediction.update({
            where: { id: p.id },
            data: {
              outcomeType,
              basePoints,
              multiplier,
              pointsEarned,
              evaluatedAt: new Date(),
            },
          });
        }

        // 3. Audit row with before/after — the differential is the
        //    primary thing the admin panel will surface here.
        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'match.recalculated',
            entity: 'match',
            entityId: matchId,
            changes: {
              before,
              after: { scoreHome, scoreAway },
              predictionsScored: predictions.length,
            },
          },
        });
      },
      { timeout: 30_000 },
    );

    // ── POST-COMMIT side effects ──────────────────────────────────────
    await this.enqueueLeaderboardRefresh();
    await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
    // maybeClosePhase is idempotent (skips if PhaseWinner already exists),
    // but it MUST run for the rare case where recalculating swapped the
    // outcome from "phase still pending" to "everyone finished".
    await this.phaseService.maybeClosePhase(matchPrev.phase);

    this.logger.log(
      `Match ${matchId} recalculated: re-scored ${predictionsScored} predictions, ` +
        `was ${before.scoreHome}-${before.scoreAway}, now ${scoreHome}-${scoreAway}`,
    );

    return updated!;
  }

  /**
   * Resultados oficiales del torneo cargados por admin al final del
   * Mundial. Recorre TODOS los `SpecialPrediction` y popula los puntos
   * por categoría (champion / runnerUp / thirdPlace / topScorer / total
   * goles) según los matches con la realidad. También suma `totalPoints`
   * y setea `evaluatedAt`.
   *
   * Comportamiento idempotente: re-correr el método con resultados
   * distintos sobreescribe los puntos previos. El audit log queda con
   * el diff (cuántos cambios, distribución de puntos por categoría).
   *
   * Reglas (de `seed-config.ts:SPECIAL_PRIZE_RULES`):
   *   - champion (campeón):       25 si pred.championTeamId === results.championTeamId
   *   - runnerUp:                 12 si match
   *   - thirdPlace:                8 si match
   *   - topScorer:                15 si match (compara por playerId)
   *   - totalGoals:               10 si exacto · 5 si abs(diff) <= 5 · 0 si más
   *
   * No requiere que ningún match esté FINISHED — los specials son una
   * predicción agregada del torneo, no de partidos individuales. La
   * decisión de cuándo correr este endpoint (post-final, post-3°, etc.)
   * queda a criterio del admin.
   */
  async scoreSpecialPredictions(
    results: {
      championTeamId: string;
      runnerUpTeamId: string;
      thirdPlaceTeamId: string;
      /**
       * Goleadores oficiales. Array para soportar empate: si dos o más
       * jugadores comparten la cima del ranking de goles al final del
       * torneo, todos son considerados válidos. Cualquier user que haya
       * pickeado uno de ellos cobra los puntos del topScorer.
       */
      topScorerIds: string[];
      totalGoals: number;
    },
    adminUserId: string,
  ): Promise<{
    evaluated: number;
    totalPointsDistributed: number;
    breakdown: {
      champion: number;
      runnerUp: number;
      thirdPlace: number;
      topScorer: number;
      totalGoalsExact: number;
      totalGoalsClose: number;
    };
  }> {
    const prizeRules = await this.scoringConfig.getSpecialPrizeRules();
    const evaluatedAt = new Date();

    // Counters per categoría para el audit log y la respuesta.
    const breakdown = {
      champion: 0,
      runnerUp: 0,
      thirdPlace: 0,
      topScorer: 0,
      totalGoalsExact: 0,
      totalGoalsClose: 0,
    };
    let evaluated = 0;
    let totalPointsDistributed = 0;

    await this.prisma.$transaction(
      async (tx) => {
        const specials = await tx.specialPrediction.findMany();
        evaluated = specials.length;

        for (const sp of specials) {
          const championPoints =
            sp.championTeamId === results.championTeamId
              ? prizeRules.champion
              : 0;
          const runnerUpPoints =
            sp.runnerUpTeamId === results.runnerUpTeamId
              ? prizeRules.runnerUp
              : 0;
          const thirdPlacePoints =
            sp.thirdPlaceTeamId === results.thirdPlaceTeamId
              ? prizeRules.thirdPlace
              : 0;
          const topScorerPoints =
            sp.topScorerId !== null &&
            results.topScorerIds.includes(sp.topScorerId)
              ? prizeRules.topScorer
              : 0;

          let totalGoalsPoints = 0;
          if (sp.totalGoals !== null) {
            const diff = Math.abs(sp.totalGoals - results.totalGoals);
            if (diff === 0) totalGoalsPoints = prizeRules.totalGoalsExact;
            else if (diff <= 5) totalGoalsPoints = prizeRules.totalGoalsClose;
          }

          const totalPoints =
            championPoints +
            runnerUpPoints +
            thirdPlacePoints +
            topScorerPoints +
            totalGoalsPoints;

          await tx.specialPrediction.update({
            where: { id: sp.id },
            data: {
              championPoints,
              runnerUpPoints,
              thirdPlacePoints,
              topScorerPoints,
              totalGoalsPoints,
              totalPoints,
              evaluatedAt,
            },
          });

          if (championPoints > 0) breakdown.champion += 1;
          if (runnerUpPoints > 0) breakdown.runnerUp += 1;
          if (thirdPlacePoints > 0) breakdown.thirdPlace += 1;
          if (topScorerPoints > 0) breakdown.topScorer += 1;
          if (totalGoalsPoints === prizeRules.totalGoalsExact && totalGoalsPoints > 0)
            breakdown.totalGoalsExact += 1;
          else if (totalGoalsPoints > 0) breakdown.totalGoalsClose += 1;

          totalPointsDistributed += totalPoints;
        }

        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'tournament.specials_scored',
            entity: 'tournament',
            entityId: 'world-cup-2026',
            // Prisma's InputJsonValue requires an index signature; los
            // objetos tipados (`prizeRules: SpecialPrizeRulesMap`,
            // `breakdown: { champion: number, ... }`) son JSON-
            // serializables pero TS no se da cuenta. Cast explícito a la
            // forma que Prisma espera.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            changes: {
              results,
              prizeRules,
              evaluated,
              totalPointsDistributed,
              breakdown,
            } as any,
          },
        });
      },
      { timeout: 60_000 },
    );

    // POST-COMMIT: refresh leaderboard MV. Los specials suman al
    // ranking global vía `Entry.totalPoints` (cuando el join lo agrega)
    // — la MV depende del query de leaderboard, no de un campo cacheado
    // en SpecialPrediction; la refresh asegura que el ranking final se
    // muestre con los puntos especiales aplicados.
    await this.enqueueLeaderboardRefresh();

    this.logger.log(
      `Tournament specials scored by admin=${adminUserId}: ${evaluated} predictions, ${totalPointsDistributed} total points distributed`,
    );

    return { evaluated, totalPointsDistributed, breakdown };
  }

  /**
   * Internal helper: enqueues the dedup'd MV refresh. Extracted so the
   * recalculate path (Task 8.5) reuses the same call.
   */
  private async enqueueLeaderboardRefresh(): Promise<void> {
    await this.notificationsQueue.add(
      LEADERBOARD_REFRESH_JOB,
      {},
      {
        jobId: LEADERBOARD_REFRESH_JOB_ID,
        removeOnComplete: true,
      },
    );
  }
}
