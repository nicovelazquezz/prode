import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsInt, IsNumber, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutcomeType, Phase } from '../../../generated/prisma/enums.js';

class UpdateAppConfigDto {
  @IsString()
  value!: string;
}

class UpdateScoringRuleDto {
  @IsInt()
  @Min(0)
  basePoints!: number;
}

class UpdatePhaseMultiplierDto {
  @IsNumber()
  @Min(0)
  multiplier!: number;
}

class UpdateSpecialPrizeRuleDto {
  @IsInt()
  @Min(0)
  points!: number;
}

class OutcomeTypeParam {
  @IsEnum(OutcomeType)
  outcomeType!: OutcomeType;
}

class PhaseParam {
  @IsEnum(Phase)
  phase!: Phase;
}

/**
 * Endpoints CRUD para `/admin/configuracion`. Cubre 4 entidades de
 * config del sistema:
 *
 *   - AppConfig         (max_users, inscripcion_precio, pozo_dist_*, ...)
 *   - ScoringRule       (5 outcome types con basePoints)
 *   - PhaseMultiplier   (7 fases con multiplier)
 *   - SpecialPrizeRule  (campeón, subcampeón, etc.)
 *
 * Sólo edit (PUT). No CREATE/DELETE: las filas se siembran via
 * `seed-config.ts` y agregar nuevas implica cambios de código backend.
 *
 * Cada PUT setea `updatedBy = adminId` y dispara audit log
 * `config.updated_by_admin` con el diff. Los cambios mid-Mundial
 * pueden afectar la leaderboard — el admin debe correr
 * `POST /admin/leaderboard/refresh` después si quiere recálculo.
 *
 * Nota: las keys de SpecialPrizeRule en la DB son camelCase
 * (champion, runnerUp, totalGoalsExact, ...) — el frontend de
 * /admin/configuracion tiene un labelMap UPPER_SNAKE_CASE que no
 * matchea. Cleanup en Wave 4 (T14).
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── AppConfig ──────────────────────────────────────────────────────

  @Get('config')
  async listConfig() {
    return this.prisma.appConfig.findMany({
      orderBy: { key: 'asc' },
    });
  }

  @Put('config/:key')
  async updateConfig(
    @Param('key') key: string,
    @Body() dto: UpdateAppConfigDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) throw new UnauthorizedException();
    const existing = await this.prisma.appConfig.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`AppConfig key '${key}' no existe`);
    }
    if (existing.value === dto.value) return existing;

    const updated = await this.prisma.appConfig.update({
      where: { key },
      data: { value: dto.value, updatedBy: admin.id },
    });
    await this.audit.log({
      action: 'config.app_updated',
      entity: 'app_config',
      entityId: key,
      changes: { from: existing.value, to: dto.value },
      userId: admin.id,
    });
    return updated;
  }

  // ── ScoringRule ────────────────────────────────────────────────────

  @Get('scoring-rules')
  async listScoringRules() {
    return this.prisma.scoringRule.findMany({
      orderBy: { basePoints: 'desc' },
    });
  }

  @Put('scoring-rules/:outcomeType')
  async updateScoringRule(
    @Param() params: OutcomeTypeParam,
    @Body() dto: UpdateScoringRuleDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) throw new UnauthorizedException();
    const existing = await this.prisma.scoringRule.findUnique({
      where: { outcomeType: params.outcomeType },
    });
    if (!existing) {
      throw new NotFoundException(
        `ScoringRule outcomeType=${params.outcomeType} no existe`,
      );
    }
    if (existing.basePoints === dto.basePoints) return existing;

    const updated = await this.prisma.scoringRule.update({
      where: { outcomeType: params.outcomeType },
      data: { basePoints: dto.basePoints, updatedBy: admin.id },
    });
    await this.audit.log({
      action: 'config.scoring_rule_updated',
      entity: 'scoring_rule',
      entityId: params.outcomeType,
      changes: { from: existing.basePoints, to: dto.basePoints },
      userId: admin.id,
    });
    return updated;
  }

  // ── PhaseMultiplier ────────────────────────────────────────────────

  @Get('phase-multipliers')
  async listPhaseMultipliers() {
    const rows = await this.prisma.phaseMultiplier.findMany({
      orderBy: { multiplier: 'asc' },
    });
    return rows.map((r) => ({ ...r, multiplier: Number(r.multiplier) }));
  }

  @Put('phase-multipliers/:phase')
  async updatePhaseMultiplier(
    @Param() params: PhaseParam,
    @Body() dto: UpdatePhaseMultiplierDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) throw new UnauthorizedException();
    const existing = await this.prisma.phaseMultiplier.findUnique({
      where: { phase: params.phase },
    });
    if (!existing) {
      throw new NotFoundException(
        `PhaseMultiplier phase=${params.phase} no existe`,
      );
    }
    if (Number(existing.multiplier) === dto.multiplier) {
      return { ...existing, multiplier: Number(existing.multiplier) };
    }

    const updated = await this.prisma.phaseMultiplier.update({
      where: { phase: params.phase },
      data: { multiplier: dto.multiplier, updatedBy: admin.id },
    });
    await this.audit.log({
      action: 'config.phase_multiplier_updated',
      entity: 'phase_multiplier',
      entityId: params.phase,
      changes: { from: Number(existing.multiplier), to: dto.multiplier },
      userId: admin.id,
    });
    return { ...updated, multiplier: Number(updated.multiplier) };
  }

  // ── SpecialPrizeRule ───────────────────────────────────────────────

  @Get('special-prize-rules')
  async listSpecialPrizeRules() {
    return this.prisma.specialPrizeRule.findMany({
      orderBy: { points: 'desc' },
    });
  }

  @Put('special-prize-rules/:key')
  async updateSpecialPrizeRule(
    @Param('key') key: string,
    @Body() dto: UpdateSpecialPrizeRuleDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) throw new UnauthorizedException();
    const existing = await this.prisma.specialPrizeRule.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new NotFoundException(`SpecialPrizeRule key='${key}' no existe`);
    }
    if (existing.points === dto.points) return existing;

    const updated = await this.prisma.specialPrizeRule.update({
      where: { key },
      data: { points: dto.points, updatedBy: admin.id },
    });
    await this.audit.log({
      action: 'config.special_prize_rule_updated',
      entity: 'special_prize_rule',
      entityId: key,
      changes: { from: existing.points, to: dto.points },
      userId: admin.id,
    });
    return updated;
  }
}
