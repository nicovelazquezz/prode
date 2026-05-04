import {
  Body,
  Controller,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ScoringService } from './scoring.service.js';
import { FinishMatchDto } from './dto/finish-match.dto.js';

/**
 * Admin-only scoring endpoints. Lives next to `AdminMatchesController`
 * (Phase 6) but is its own controller because the responsibility is
 * orthogonal: the matches controller mutates pre-kickoff state (kickoff,
 * teams, postpone), and this one mutates post-kickoff state (final score
 * + scoring side-effects).
 *
 * `JwtAuthGuard` runs globally; `RolesGuard` is registered locally so we
 * can require ADMIN explicitly without affecting other routes.
 */
@Controller('admin/matches')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  /**
   * Finish a match and score every prediction in one go. The bulk of the
   * work is delegated to `ScoringService.finishMatchAndScore` — this
   * handler only sources `adminUserId` from the JWT and returns the
   * updated match for the panel to re-render.
   *
   * Surfacing 4xx:
   *   - 400 MatchAlreadyFinishedException — match is already FINISHED
   *   - 409 PhaseAlreadyPaidException     — phase prize already paid out
   */
  @Post(':id/finish')
  async finish(
    @Param('id') id: string,
    @Body() dto: FinishMatchDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // The global JwtAuthGuard already rejects unauthenticated calls; this
    // belt-and-suspenders check guards against a misconfigured guard
    // chain — `adminUserId` MUST be a real id for the audit trail.
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }
    return this.scoringService.finishMatchAndScore(
      id,
      dto.scoreHome,
      dto.scoreAway,
      user.id,
    );
  }
}
