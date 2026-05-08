import {
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { maskDni } from '../../common/utils/mask.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

class ListAdminEntriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  /** Filter by owning user id. */
  @IsOptional()
  @IsString()
  userId?: string;

  /** Filter to entries that have a non-null alias. */
  @IsOptional()
  @Type(() => Boolean)
  hasAlias?: boolean;

  /** Filter by exact entry position (1-based within user). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position?: number;
}

/**
 * Admin-only listing of all entries in the system. Used by the
 * /admin/entries page (spec §3.4) for support / audit. Returns a paged
 * `{ rows, total }` envelope.
 */
@Controller('admin/entries')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminEntriesController {
  private readonly logger = new Logger(AdminEntriesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: ListAdminEntriesDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      query.pageSize ?? DEFAULT_PAGE_SIZE,
    );
    const skip = (page - 1) * pageSize;

    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.hasAlias !== undefined
        ? query.hasAlias
          ? { alias: { not: null } }
          : { alias: null }
        : {}),
      ...(query.position !== undefined ? { position: query.position } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.entry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          paymentId: true,
          position: true,
          alias: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              dni: true,
              firstName: true,
              lastName: true,
              status: true,
            },
          },
          payment: {
            select: {
              id: true,
              method: true,
              amount: true,
              status: true,
              paidAt: true,
            },
          },
        },
      }),
      this.prisma.entry.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        ...r,
        payment: r.payment
          ? { ...r.payment, amount: Number(r.payment.amount) }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * `DELETE /admin/entries/:id` — anula un Entry. Q6=A: borra las
   * predicciones cargadas. Operación destructiva, requiere admin.
   *
   * Efecto en cascada (en una TX):
   *   - Borra Predictions del entry
   *   - Borra SpecialPrediction del entry (si existe)
   *   - Borra LeagueMembership del entry (si está en alguna liga)
   *   - Borra el Entry
   *   - Payment asociado: status → REFUNDED. NO se borra para que
   *     el audit trail histórico (quién pagó cuándo qué método) sobreviva.
   *   - Audit log destructivo con la cantidad de predicciones borradas
   *
   * Devuelve un resumen con los counts. Si el Entry no existe, 404.
   *
   * Nota sobre el leaderboard: la materialized view se refresca en el
   * próximo refresh job. Recomendamos al admin disparar el refresh
   * manual desde el dashboard cuando anula varios entries.
   */
  @Delete(':id')
  async annul(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }

    const ipAddress = req.ip ?? req.socket?.remoteAddress;
    const uaHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.entry.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, dni: true, firstName: true, lastName: true },
          },
          payment: {
            select: { id: true, method: true, amount: true, status: true },
          },
        },
      });
      if (!entry) {
        throw new NotFoundException(`Entry ${id} no encontrado`);
      }

      // Conteos pre-borrado para el audit log y la response.
      const [predictionsCount, hasSpecial, leagueMembershipsCount, phaseWinsCount] =
        await Promise.all([
          tx.prediction.count({ where: { entryId: id } }),
          tx.specialPrediction.count({ where: { entryId: id } }),
          tx.leagueMembership.count({ where: { entryId: id } }),
          tx.phaseWinner.count({ where: { entryId: id } }),
        ]);

      // Cascada manual: las FK no tienen onDelete cascade en todas las
      // tablas, así que borramos en orden seguro (hijas → padre).
      // PhaseWinner.entryId tiene ON DELETE RESTRICT — sin este delete
      // explícito, anular una entry que ganó alguna fase falla con FK
      // violation. El detalle del win queda en el audit log para
      // trazabilidad post-anulación.
      await tx.prediction.deleteMany({ where: { entryId: id } });
      await tx.specialPrediction.deleteMany({ where: { entryId: id } });
      await tx.leagueMembership.deleteMany({ where: { entryId: id } });
      await tx.phaseWinner.deleteMany({ where: { entryId: id } });
      await tx.entry.delete({ where: { id } });

      // Payment asociado: lo dejamos como REFUNDED para que el historial
      // sobreviva (auditoría del club). Si no había Payment (raro),
      // skip el update.
      if (entry.payment) {
        await tx.payment.update({
          where: { id: entry.payment.id },
          data: { status: 'REFUNDED' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'entry.annulled',
          entity: 'entry',
          entityId: id,
          changes: {
            targetUserId: entry.userId,
            targetUserDni: maskDni(entry.user.dni),
            entryPosition: entry.position,
            paymentId: entry.payment?.id ?? null,
            paymentMethod: entry.payment?.method ?? null,
            paymentAmount: entry.payment ? Number(entry.payment.amount) : null,
            deletedPredictions: predictionsCount,
            deletedSpecialPredictions: hasSpecial,
            deletedLeagueMemberships: leagueMembershipsCount,
            deletedPhaseWins: phaseWinsCount,
          },
          ipAddress,
          userAgent,
        },
      });

      this.logger.warn(
        `Entry annulled: entryId=${id} userId=${entry.userId} predictions=${predictionsCount} special=${hasSpecial} adminId=${admin.id}`,
      );

      return {
        ok: true,
        entryId: id,
        userId: entry.userId,
        deletedPredictions: predictionsCount,
        deletedSpecialPredictions: hasSpecial,
        deletedLeagueMemberships: leagueMembershipsCount,
        deletedPhaseWins: phaseWinsCount,
        paymentRefunded: entry.payment?.id ?? null,
      };
    });
  }
}
