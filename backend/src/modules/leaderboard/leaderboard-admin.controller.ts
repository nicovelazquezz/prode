import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Admin manual refresh trigger for `leaderboard_global`. Mirrors what
 * `ScoringService.finishMatchAndScore` does on the post-commit step:
 * enqueues the dedup'd `leaderboard.refresh` job, which is consumed by
 * `LeaderboardRefreshProcessor` (Phase 8) and refreshes the MV +
 * invalidates the Phase 9 cache.
 *
 * Why we delegate to `NotificationsService` instead of injecting the
 * BullMQ queue directly: the notifications module is `@Global` and
 * already owns the queue producer. Registering `BullModule.registerQueue`
 * a second time inside another module ends up exporting a competing
 * provider for the same `getQueueToken(...)` (especially when wrapped
 * in another `@Global` boundary), which clobbers the local queue
 * providers used by `ScoringModule`/`PaymentsModule` and breaks tests
 * that spy on `app.get(getQueueToken(...))`. Routing through the
 * already-global service is simpler and keeps DI tidy.
 *
 * Identical job name + dedup id as the automated path means a manual
 * refresh fired during an active scoring storm coalesces with the
 * pending refresh — no duplicate work.
 */
@Controller('admin/leaderboard')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class LeaderboardAdminController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Returns 202 Accepted (not 201) because the operation is asynchronous
   * — the queue ack is what we hand back, the actual MV refresh happens
   * in the worker. The client gets immediate confirmation that the job
   * was queued, not that it ran.
   *
   * `@Audit` records the trigger; the response body carries the BullMQ
   * job id so the admin panel can correlate with logs if needed.
   */
  @Post('refresh')
  @HttpCode(202)
  @Audit({ action: 'leaderboard.manual_refresh', entity: 'leaderboard' })
  async refresh(): Promise<{ jobId: string; status: 'queued' }> {
    const jobId = await this.notifications.enqueueLeaderboardRefresh();
    return { jobId, status: 'queued' };
  }
}
