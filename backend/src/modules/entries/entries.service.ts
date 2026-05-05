import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LeaderboardRepository } from '../leaderboard/leaderboard.repository.js';
import {
  CHECKOUT_PROVIDER,
  type CheckoutProvider,
} from '../../shared/checkout/checkout.provider.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import {
  EntryCapReachedException,
  SpecialPredictionLockedException,
} from '../../common/exceptions/domain.exceptions.js';
import { loadEnv, type Env } from '../../config/env.js';

/** Default cap when AppConfig.max_entries_per_user is missing. Spec §1. */
const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_AMOUNT_ARS = 10_000;
/** TTL of the recovery completion token. Spec 6.5 — same as public flow. */
const COMPLETION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface EntrySummary {
  id: string;
  position: number;
  alias: string | null;
  status: 'ACTIVE' | 'ANNULLED';
  createdAt: Date;
  updatedAt: Date;
  stats: {
    predictionsCount: number;
    totalPoints: number;
    rank: number | null;
    specialPredictionLocked: boolean;
  };
}

export interface InitEntryPaymentResult {
  paymentId: string;
  initPoint: string;
}

/**
 * Service backing the multi-prode entry endpoints. Owns:
 *
 *   - `initPayment`  — logged-in flow that creates a PENDING Payment +
 *                      MP preference for "agregar otro prode". Cap is
 *                      enforced under SELECT FOR UPDATE so two
 *                      concurrent calls of the same user can't both pass.
 *   - `listForUser`  — entry list with stats (predictionsCount,
 *                      totalPoints, rank, specialPredictionLocked).
 *   - `findOne`      — single entry detail (ownership-checked at the
 *                      controller).
 *   - `updateAlias`  — rename pre-kickoff; locked once the inaugural
 *                      match starts.
 *   - `getMaxEntriesPerUser` — config read used by webhook re-checks
 *                              and the cap exception.
 */
@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);
  private readonly env: Env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly leaderboard: LeaderboardRepository,
    @Inject(CHECKOUT_PROVIDER)
    private readonly checkoutProvider: CheckoutProvider,
    // unused by EntriesService directly but pulled in for symmetry with
    // PaymentsService — keeps the future post-commit jobs (orphan-alert
    // for OVER_CAP payments) easy to wire in. ESLint allows the unused
    // injection because reflect-metadata reads it at module init.
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {
    this.env = loadEnv();
    void this.notificationsQueue;
  }

  /**
   * Resolves `AppConfig.max_entries_per_user`. Falls back to the spec
   * default if the row is missing or malformed. Range-clamps to [1, 20]
   * defensively so an admin typo (e.g. 99999) doesn't make the cap a
   * no-op.
   */
  async getMaxEntriesPerUser(): Promise<number> {
    const row = await this.prisma.appConfig.findUnique({
      where: { key: 'max_entries_per_user' },
    });
    const raw = row?.value ?? String(DEFAULT_MAX_ENTRIES);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(
        `max_entries_per_user is not a positive integer: ${raw}; falling back to ${DEFAULT_MAX_ENTRIES}`,
      );
      return DEFAULT_MAX_ENTRIES;
    }
    return Math.min(20, parsed);
  }

  /**
   * Reads inscription_precio with the same parsing rules as
   * `PaymentsService.resolveAmount`. Duplicated to keep modules
   * decoupled — both modules read the same key but neither depends on
   * the other.
   */
  private async resolveAmount(): Promise<number> {
    const row = await this.prisma.appConfig.findUnique({
      where: { key: 'inscripcion_precio' },
    });
    if (!row) return DEFAULT_AMOUNT_ARS;
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_AMOUNT_ARS;
    }
    return parsed;
  }

  /**
   * Creates a PENDING Payment for the logged-in user under
   * SELECT FOR UPDATE on their entries. Two concurrent requests of the
   * same user serialise; one passes the cap check and one gets 409.
   *
   * The MP preference is created OUTSIDE the TX (network call would
   * block the row lock too long). The race window between TX commit and
   * the preference call only matters if `createPreference` throws — we
   * leave the PENDING Payment behind in that case (status PENDING) and
   * the orphan-payment cleanup cron eventually marks it ORPHANED.
   */
  async initPayment(
    userId: string,
    alias: string | undefined,
    ctx: AuditContext = {},
  ): Promise<InitEntryPaymentResult> {
    const cap = await this.getMaxEntriesPerUser();
    const tokenPlain = this.authService.generatePlainToken();
    const tokenHash = this.authService.hashToken(tokenPlain);
    const amount = await this.resolveAmount();

    const payment = await this.prisma.$transaction(async (tx) => {
      // SELECT FOR UPDATE on the caller's entries — the only rows we
      // need to lock to make the cap check serialisable. A concurrent
      // call of the same user blocks here until our TX commits.
      const lockedRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM entries
        WHERE "userId" = ${userId}
        FOR UPDATE
      `;
      const current = Number(lockedRows[0]?.count ?? 0);
      if (current >= cap) {
        throw new EntryCapReachedException(current, cap);
      }
      return tx.payment.create({
        data: {
          userId,
          amount,
          method: 'MERCADOPAGO',
          status: 'PENDING',
          completionTokenHash: tokenHash,
          tokenExpiresAt: null,
          entryAlias: alias ?? null,
        },
      });
    });

    const { preferenceId, initPoint } =
      await this.checkoutProvider.createPreference({
        paymentId: payment.id,
        amount,
        completionTokenPlain: tokenPlain,
      });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { mpPreferenceId: preferenceId },
    });

    void this.audit.log({
      userId,
      action: 'entry.init_payment',
      entity: 'payment',
      entityId: payment.id,
      changes: { amount, mpPreferenceId: preferenceId, alias: alias ?? null },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { paymentId: payment.id, initPoint };
  }

  /**
   * Lists every ACTIVE entry of the user with per-entry stats. Stats
   * are aggregated in a single SQL pass so the controller stays fast
   * even when a user has many entries.
   */
  async listForUser(userId: string): Promise<EntrySummary[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        position: number;
        alias: string | null;
        status: 'ACTIVE' | 'ANNULLED';
        createdAt: Date;
        updatedAt: Date;
        predictions_count: bigint;
        prediction_points: bigint;
        special_points: number | null;
        special_locked: boolean;
      }>
    >`
      SELECT
        e.id,
        e.position,
        e.alias,
        e.status,
        e."createdAt",
        e."updatedAt",
        COALESCE(pred.predictions_count, 0)::bigint AS predictions_count,
        COALESCE(pred.prediction_points, 0)::bigint AS prediction_points,
        sp."totalPoints" AS special_points,
        (sp."lockedAt" IS NOT NULL) AS special_locked
      FROM entries e
      LEFT JOIN (
        SELECT "entryId",
               COUNT(*)::bigint AS predictions_count,
               COALESCE(SUM("pointsEarned"), 0)::bigint AS prediction_points
        FROM predictions
        GROUP BY "entryId"
      ) pred ON pred."entryId" = e.id
      LEFT JOIN special_predictions sp ON sp."entryId" = e.id
      WHERE e."userId" = ${userId} AND e.status = 'ACTIVE'
      ORDER BY e.position ASC
    `;

    if (rows.length === 0) return [];

    // Per-entry rank from the MV (best-effort — null if MV missed).
    const rankByEntry = new Map<string, number>();
    try {
      const ranks = await this.prisma.$queryRaw<
        Array<{ entry_id: string; rank: bigint }>
      >`
        WITH ranked AS (
          SELECT entry_id,
                 ROW_NUMBER() OVER (
                   ORDER BY total_points DESC, exact_count DESC, hits_count DESC
                 ) AS rank
          FROM leaderboard_global
        )
        SELECT entry_id, rank FROM ranked
        WHERE entry_id = ANY (${rows.map((r) => r.id)}::text[])
      `;
      for (const r of ranks) {
        rankByEntry.set(r.entry_id, Number(r.rank));
      }
    } catch (err) {
      this.logger.warn(
        `entries.listForUser: rank lookup failed: ${(err as Error).message}`,
      );
    }

    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      alias: r.alias,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      stats: {
        predictionsCount: Number(r.predictions_count),
        totalPoints:
          Number(r.prediction_points) + Number(r.special_points ?? 0),
        rank: rankByEntry.get(r.id) ?? null,
        specialPredictionLocked: Boolean(r.special_locked),
      },
    }));
  }

  /**
   * Single-entry detail with stats. Throws 404 if missing, 403 if
   * not owned by the caller.
   */
  async findOne(userId: string, entryId: string): Promise<EntrySummary> {
    const entry = await this.prisma.entry.findUnique({
      where: { id: entryId },
      select: { userId: true },
    });
    if (!entry) {
      throw new NotFoundException(`Entry ${entryId} not found`);
    }
    if (entry.userId !== userId) {
      throw new ForbiddenException('Entry does not belong to user');
    }
    const list = await this.listForUser(userId);
    const found = list.find((e) => e.id === entryId);
    if (!found) {
      // Edge: ANNULLED entries don't appear in listForUser, but the
      // ownership check above already passed, so re-fetch standalone.
      const fallback = await this.prisma.entry.findUnique({
        where: { id: entryId },
      });
      if (!fallback) throw new NotFoundException(`Entry ${entryId} not found`);
      return {
        id: fallback.id,
        position: fallback.position,
        alias: fallback.alias,
        status: fallback.status,
        createdAt: fallback.createdAt,
        updatedAt: fallback.updatedAt,
        stats: {
          predictionsCount: 0,
          totalPoints: 0,
          rank: null,
          specialPredictionLocked: false,
        },
      };
    }
    return found;
  }

  /**
   * Renames an entry. Allowed until the SpecialPrediction has been
   * locked (kickoff inaugural). Spec §3.1.
   */
  async updateAlias(
    userId: string,
    entryId: string,
    alias: string | null,
    ctx: AuditContext = {},
  ): Promise<EntrySummary> {
    const entry = await this.prisma.entry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        userId: true,
        alias: true,
        specialPrediction: { select: { lockedAt: true } },
      },
    });
    if (!entry) throw new NotFoundException(`Entry ${entryId} not found`);
    if (entry.userId !== userId) {
      throw new ForbiddenException('Entry does not belong to user');
    }
    if (entry.specialPrediction?.lockedAt) {
      throw new SpecialPredictionLockedException(
        'No se puede cambiar el alias después del kickoff inaugural',
      );
    }

    const updated = await this.prisma.entry.update({
      where: { id: entryId },
      data: { alias },
    });

    void this.audit.log({
      userId,
      action: 'entry.alias_updated',
      entity: 'entry',
      entityId: entry.id,
      changes: { before: entry.alias, after: alias },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // Re-fetch with stats so the response shape stays consistent.
    return this.findOne(userId, updated.id);
  }

  // referenced for symmetry — not currently used but expected by 5.2
  // webhook re-check + admin alerts.
  static readonly COMPLETION_TOKEN_TTL_MS = COMPLETION_TOKEN_TTL_MS;
}
