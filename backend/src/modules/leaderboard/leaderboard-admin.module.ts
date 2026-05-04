import { Module } from '@nestjs/common';
import { LeaderboardAdminController } from './leaderboard-admin.controller.js';

/**
 * Non-global sub-module that hosts the admin manual-refresh endpoint.
 *
 * Why split out: `LeaderboardModule` is `@Global()` (so the worker can
 * be injected into `NotificationsProcessor` without re-import). This
 * sub-module deliberately stays non-global so future additions
 * (extra admin-only providers, BullMQ queue registrations, etc.)
 * don't accidentally leak through the parent's global boundary and
 * clobber competing providers in other modules.
 *
 * No queue registration here — the controller delegates to the
 * already-global `NotificationsService` for the BullMQ enqueue
 * (see comments in `LeaderboardAdminController`).
 */
@Module({
  imports: [],
  controllers: [LeaderboardAdminController],
})
export class LeaderboardAdminModule {}
