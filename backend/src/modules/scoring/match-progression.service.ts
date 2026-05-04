import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';
import type { Match } from '../../../generated/prisma/client.js';

/**
 * Populates `homeTeamId` / `awayTeamId` (and opens predictions via
 * `predictionsOpenAt`) for each elimination-round match once the
 * previous phase has finished.
 *
 * Bracket model (matches the seed file under `prisma/data/matches.json`):
 *
 *   ROUND_32: matchNumbers 73..88 (16 matches). Labels reference group
 *     winners with FIFA 2026 placement codes ("Mejor R32 H1", "Mejor R32
 *     V1") — the actual mapping requires the official FIFA 2026 bracket.
 *
 *   ROUND_16: matchNumbers 89..96 (8 matches). Match k (1..8) takes the
 *     winners of R32 matches (2k-1) and (2k).
 *
 *   QUARTERS: matchNumbers 97..100 (4 matches). Match k (1..4) takes
 *     the winners of R16 matches (2k-1) and (2k).
 *
 *   SEMIS:    matchNumbers 101..102 (2 matches). Match k (1..2) takes
 *     the winners of QF matches (2k-1) and (2k).
 *
 *   THIRD_PL: matchNumber 103. LOSERS of the two SEMI matches.
 *   FINAL:    matchNumber 104. WINNERS of the two SEMI matches.
 *
 * GROUPS → ROUND_32 is the only step that doesn't fall out of the
 * sequential pairing rule — it depends on the FIFA 2026 bracket
 * (12 groups × 4 + 8 best 3rd places). The plan calls out that piece
 * as acceptable to skip with an AdminAlerts ping until the official
 * bracket is settled and the admin can use `PUT /admin/matches/:id`
 * to assign teams manually.
 *
 * Each populator is idempotent: re-entry sees the row already populated
 * (homeTeamId / awayTeamId no longer null) and writes nothing.
 */
@Injectable()
export class MatchProgressionService {
  private readonly logger = new Logger(MatchProgressionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  /**
   * GROUPS → ROUND_32. Acceptable simplification per Phase 8 plan: the
   * official FIFA 2026 bracket isn't fully encoded in the seed labels,
   * so we ping the admin for manual team assignment via
   * `PUT /admin/matches/:id`. The audit trail captures the manual
   * assignment with action `match.team_assigned`.
   *
   * TODO(8.8): replace with bracket logic once the FIFA 2026 placement
   * rules are settled (12 groups × 2 + 8 best-thirds). The seed labels
   * "Mejor R32 H1..V16" are the slots; the missing piece is the mapping
   * from group rank → slot.
   */
  async populateRound32Matches(): Promise<void> {
    this.logger.warn(
      'populateRound32Matches: FIFA 2026 bracket not encoded — delegating to admin',
    );
    await this.adminAlerts.notify({
      type: 'PHASE_PROGRESSION_MANUAL_REVIEW',
      message:
        'GROUPS phase closed. The 16 ROUND_32 matches need team ' +
        'assignments according to FIFA 2026 bracket rules (12 group ' +
        'winners + 12 runners-up + 8 best 3rd places). Use ' +
        'PUT /admin/matches/:id to assign each match\'s home/awayTeamId ' +
        'and trigger predictionsOpenAt automatically.',
      dedupKey: 'phase-progression:GROUPS->ROUND_32',
    });
  }

  /** ROUND_32 → ROUND_16. Pair winners of consecutive R32 matches. */
  async populateRound16Matches(): Promise<void> {
    await this.populateBySequentialPairing({
      sourceFromMatchNumber: 73,
      sourceToMatchNumber: 88,
      targetFromMatchNumber: 89,
      targetToMatchNumber: 96,
      pickFromLoser: false,
      label: 'ROUND_32 → ROUND_16',
    });
  }

  /** ROUND_16 → QUARTERS. */
  async populateQuarterMatches(): Promise<void> {
    await this.populateBySequentialPairing({
      sourceFromMatchNumber: 89,
      sourceToMatchNumber: 96,
      targetFromMatchNumber: 97,
      targetToMatchNumber: 100,
      pickFromLoser: false,
      label: 'ROUND_16 → QUARTERS',
    });
  }

  /** QUARTERS → SEMIS. */
  async populateSemiMatches(): Promise<void> {
    await this.populateBySequentialPairing({
      sourceFromMatchNumber: 97,
      sourceToMatchNumber: 100,
      targetFromMatchNumber: 101,
      targetToMatchNumber: 102,
      pickFromLoser: false,
      label: 'QUARTERS → SEMIS',
    });
  }

  /**
   * SEMIS → FINAL + THIRD_PLACE. Two targets simultaneously: match 103
   * takes the SEMI losers, match 104 takes the SEMI winners.
   */
  async populateFinalMatches(): Promise<void> {
    // FINAL (#104) takes both SEMI winners (matches 101, 102).
    await this.populateBySequentialPairing({
      sourceFromMatchNumber: 101,
      sourceToMatchNumber: 102,
      targetFromMatchNumber: 104,
      targetToMatchNumber: 104,
      pickFromLoser: false,
      label: 'SEMIS → FINAL',
    });
    // THIRD_PLACE (#103) takes both SEMI losers.
    await this.populateBySequentialPairing({
      sourceFromMatchNumber: 101,
      sourceToMatchNumber: 102,
      targetFromMatchNumber: 103,
      targetToMatchNumber: 103,
      pickFromLoser: true,
      label: 'SEMIS → THIRD_PLACE',
    });
  }

  /**
   * Generic sequential-pairing populator. Reads the source matches in
   * matchNumber order, picks the winner (or loser) of each, and assigns
   * pairs (2k-1, 2k) to consecutive target matches.
   *
   * Idempotent: skips target matches whose home/awayTeamId is already
   * populated.
   *
   * Errors out (with AdminAlerts) when:
   *   - any source match isn't FINISHED
   *   - any source match is a draw (pickFromLoser=false implies a clear
   *     winner; in real elimination matches penalties decide, but our
   *     schema doesn't model penalty shootouts — admin handles those
   *     via PUT /admin/matches/:id manually).
   *   - source ↔ target counts don't pair cleanly (shouldn't happen
   *     with the seed data; defensive).
   */
  private async populateBySequentialPairing(args: {
    sourceFromMatchNumber: number;
    sourceToMatchNumber: number;
    targetFromMatchNumber: number;
    targetToMatchNumber: number;
    pickFromLoser: boolean;
    label: string;
  }): Promise<void> {
    const sources = await this.prisma.match.findMany({
      where: {
        matchNumber: {
          gte: args.sourceFromMatchNumber,
          lte: args.sourceToMatchNumber,
        },
      },
      orderBy: { matchNumber: 'asc' },
    });

    const targets = await this.prisma.match.findMany({
      where: {
        matchNumber: {
          gte: args.targetFromMatchNumber,
          lte: args.targetToMatchNumber,
        },
      },
      orderBy: { matchNumber: 'asc' },
    });

    // 2 sources per 1 target.
    if (sources.length !== targets.length * 2) {
      this.logger.error(
        `${args.label}: expected ${targets.length * 2} sources, got ${sources.length} — aborting`,
      );
      return;
    }

    let assigned = 0;
    let skipped = 0;
    const now = new Date();
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const a = sources[2 * i];
      const b = sources[2 * i + 1];

      // Idempotency: if this target is already populated, leave it alone.
      if (target.homeTeamId !== null || target.awayTeamId !== null) {
        skipped++;
        continue;
      }

      // Per-target source validation. Each populator runs end-of-phase,
      // when ALL sources should be FINISHED — but we check per-target
      // so callers can selectively re-run a partial population without
      // spurious aborts on already-handled targets.
      if (a.status !== 'FINISHED' || b.status !== 'FINISHED') {
        await this.adminAlerts.notify({
          type: 'PHASE_PROGRESSION_INCONSISTENT_STATE',
          message:
            `Phase progression ${args.label}: source match(es) ` +
            `${a.status !== 'FINISHED' ? `#${a.matchNumber}` : ''}` +
            `${a.status !== 'FINISHED' && b.status !== 'FINISHED' ? ', ' : ''}` +
            `${b.status !== 'FINISHED' ? `#${b.matchNumber}` : ''} ` +
            `aren't FINISHED. Skipping target #${target.matchNumber}.`,
          dedupKey: `phase-progression:bad-source:${target.matchNumber}`,
        });
        continue;
      }

      const homeTeamId = this.pickTeam(a, args.pickFromLoser);
      const awayTeamId = this.pickTeam(b, args.pickFromLoser);

      if (!homeTeamId || !awayTeamId) {
        // pickTeam returned null → match was a draw (no penalties model).
        await this.adminAlerts.notify({
          type: 'PHASE_PROGRESSION_DRAW_NEEDS_REVIEW',
          message:
            `Phase progression ${args.label}: source match #${(!homeTeamId ? a : b).matchNumber} ` +
            `was a draw. Schema doesn't model penalty shootouts — assign the ` +
            `winning team manually via PUT /admin/matches/:id (target #${target.matchNumber}).`,
          dedupKey: `phase-progression:draw:${target.matchNumber}`,
        });
        continue;
      }

      await this.prisma.match.update({
        where: { id: target.id },
        data: {
          homeTeamId,
          awayTeamId,
          predictionsOpenAt: now,
        },
      });
      assigned++;
    }

    this.logger.log(
      `${args.label}: assigned=${assigned} already-set=${skipped}`,
    );
  }

  /**
   * Returns the winning (or losing) teamId of a finished match. `null`
   * when the match was a draw (the schema doesn't model penalties; the
   * admin assigns the surviving team manually in that case).
   */
  private pickTeam(match: Match, fromLoser: boolean): string | null {
    if (match.scoreHome === null || match.scoreAway === null) return null;
    if (match.scoreHome === match.scoreAway) return null;
    const homeWon = match.scoreHome > match.scoreAway;
    if (fromLoser) {
      return homeWon ? match.awayTeamId : match.homeTeamId;
    }
    return homeWon ? match.homeTeamId : match.awayTeamId;
  }
}
