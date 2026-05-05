import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { loadEnv, type Env } from '../../config/env.js';

/**
 * Match-reminder cron. Fires every 15 min, finds matches that kick off in
 * the next ~2 hours and that are still SCHEDULED (i.e. not LOCKED yet),
 * then enqueues a WhatsApp nudge to every active opted-in user that has
 * NOT yet loaded a prediction for that match.
 *
 * The dedup key (`match-reminder:${userId}:${matchId}`) is the load-bearing
 * piece here. Across the ~8 ticks that fall inside the 2h window before
 * any single kickoff, the upsert in `NotificationsService.persist` keeps
 * the row unique by dedupKey, and BullMQ's `jobId` derived from the same
 * key blocks duplicate jobs. So even though the cron re-evaluates the
 * eligibility set every 15 min, each (user, match) pair is messaged at
 * most once.
 *
 * The cron does NOT block on the WhatsApp send — it only enqueues the
 * Notification row + BullMQ job. The shared `NotificationsProcessor`
 * worker drains those asynchronously (with retries + status tracking).
 */
@Injectable()
export class MatchRemindersCron {
  private readonly logger = new Logger(MatchRemindersCron.name);
  private readonly env: Env;

  /** 2 hours, in ms — the lookahead window for "kicks off soon". */
  private static readonly LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    this.env = loadEnv();
  }

  /**
   * Returns the count of Notification rows enqueued (or already-existing
   * rows that the dedupKey absorbed). Public so the integration test can
   * drive it directly without waiting for the scheduler tick.
   */
  @Cron('*/15 * * * *')
  async sendReminders(): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + MatchRemindersCron.LOOKAHEAD_MS);

    // Pull every SCHEDULED match whose kickoff is inside the 2h window.
    // We deliberately keep the team relations here so we can format
    // "Argentina vs Brasil" without a follow-up query per match.
    //
    // Matches with null teams (round-of-16+ before the bracket fills)
    // are filtered out below: there's no pretty label to put in the
    // WhatsApp text and predictions can't have been made anyway.
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gte: now, lte: horizon },
      },
      select: {
        id: true,
        kickoffAt: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        homeTeamLabel: true,
        awayTeamLabel: true,
      },
    });

    if (matches.length === 0) return 0;

    let totalEnqueued = 0;

    for (const match of matches) {
      // If teams aren't set yet (placeholder labels only), the match
      // shouldn't be predictable yet — bail out for this match. The
      // bracket-progression service fills these in once the previous
      // round resolves.
      const homeName = match.homeTeam?.name ?? null;
      const awayName = match.awayTeam?.name ?? null;
      if (!homeName || !awayName) {
        continue;
      }

      // Multi-prode: predictions live on entries. We send a single
      // reminder per user when at least ONE of their ACTIVE entries
      // hasn't predicted this match — the entry-level granularity
      // would be spammy in chat ("you haven't predicted with prode #2"
      // ×3). The dedup key stays user-keyed.
      const entriesWithPrediction = await this.prisma.prediction.findMany({
        where: { matchId: match.id },
        select: { entryId: true },
      });
      const predictedEntryIds = entriesWithPrediction.map((p) => p.entryId);

      // ACTIVE entries that did NOT predict this match.
      const missingEntries = await this.prisma.entry.findMany({
        where: {
          status: 'ACTIVE',
          ...(predictedEntryIds.length > 0
            ? { id: { notIn: predictedEntryIds } }
            : {}),
          user: { status: 'ACTIVE', whatsappOptIn: true },
        },
        select: {
          userId: true,
          user: { select: { whatsapp: true } },
        },
      });

      // De-dup by user — one reminder per person regardless of how
      // many entries are missing.
      const eligibleUsersMap = new Map<string, { id: string; whatsapp: string }>();
      for (const e of missingEntries) {
        if (!eligibleUsersMap.has(e.userId)) {
          eligibleUsersMap.set(e.userId, {
            id: e.userId,
            whatsapp: e.user.whatsapp,
          });
        }
      }
      const eligibleUsers = Array.from(eligibleUsersMap.values());

      for (const user of eligibleUsers) {
        const dedupKey = `match-reminder:${user.id}:${match.id}`;
        const message =
          `⏰ Faltan 2 horas para ${homeName} vs ${awayName} y todavía ` +
          `no cargaste tu pronóstico. Cargalo en ${this.env.FRONTEND_URL}`;

        try {
          await this.notifications.enqueue({
            userId: user.id,
            toAddress: user.whatsapp,
            type: 'MATCH_REMINDER',
            title: 'Recordatorio Prode',
            message,
            channel: 'WHATSAPP',
            dedupKey,
          });
          totalEnqueued += 1;
        } catch (err) {
          // Don't let one bad row halt the rest of the batch — log and
          // continue. The next tick (15 min later) will pick this up
          // again because the row was never persisted.
          this.logger.warn(
            `Failed to enqueue match-reminder for user=${user.id} match=${match.id}: ${
              (err as Error).message
            }`,
          );
        }
      }
    }

    if (totalEnqueued > 0) {
      this.logger.log(
        `Match reminders: enqueued ${totalEnqueued} WhatsApp(s) across ${matches.length} match(es).`,
      );
    }

    return totalEnqueued;
  }
}
