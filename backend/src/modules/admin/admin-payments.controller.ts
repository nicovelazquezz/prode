import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { maskDni } from '../../common/utils/mask.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto.js';

/** Default cap fallback si AppConfig.max_entries_per_user no está. */
const DEFAULT_MAX_ENTRIES = 5;
/** Default precio fallback si AppConfig.inscripcion_precio no está. */
const DEFAULT_PRICE = 15000;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

class ListAdminPaymentsDto {
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

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /** ISO 8601; filtra `createdAt >= fromDate`. */
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  /** ISO 8601; filtra `createdAt <= toDate`. */
  @IsOptional()
  @IsDateString()
  toDate?: string;
}

/**
 * Listing paginado de pagos para el panel `/admin/pagos`. Incluye datos
 * del user asociado (cuando existe) y `mpRawData` para que el admin pueda
 * inspeccionar la respuesta cruda de MercadoPago en casos raros.
 *
 * Filtra opcionalmente por status / method / rango de fechas. La query
 * usa los índices `payments(status)` y `payments(userId)` ya definidos
 * en schema.prisma.
 */
@Controller('admin/payments')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminPaymentsController {
  private readonly logger = new Logger(AdminPaymentsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() query: ListAdminPaymentsDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      query.pageSize ?? DEFAULT_PAGE_SIZE,
    );
    const skip = (page - 1) * pageSize;

    const createdAtFilter =
      query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
              ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
            },
          }
        : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...createdAtFilter,
    };

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              dni: true,
              firstName: true,
              lastName: true,
            },
          },
          // Entry asociado al payment (relación 1:1 inversa). Lo
          // necesitamos en el frontend para ofrecer la acción "Anular
          // prode" — sólo aparece si el payment está APPROVED y tiene
          // entry. Si el payment es REFUNDED o no tiene entry, el
          // botón se oculta.
          entry: {
            select: {
              id: true,
              position: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: rows.map((p) => ({
        ...p,
        // Decimal → number para JSON (el frontend ya tipa amount como number).
        amount: Number(p.amount),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Aprobación manual de un Payment PENDING. "Último recurso" cuando MP
   * no replicó por algún motivo (webhook caído, HMAC inválido, etc.) y
   * el admin confirmó offline que el cobro existe.
   *
   * Sólo opera sobre logged-in flows (Payment con `userId` asignado). Para
   * pagos públicos anónimos, devuelve 400 con la indicación de usar
   * `POST /admin/users` (que crea User + Payment APPROVED en una TX).
   *
   * Aplica el mismo cap-check + creación de Entry que el webhook MP.
   * Audita `payment.admin_approved` con el id del admin.
   */
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) {
      // Belt-and-suspenders — JwtAuthGuard ya rechaza anónimos antes.
      throw new UnauthorizedException('Authenticated admin required');
    }
    return this.paymentsService.adminApprove(id, admin.id);
  }

  /**
   * `POST /admin/payments/manual` — registra un pago manual (CASH o
   * TRANSFER) para un User EXISTENTE. Path A del flow operacional:
   * el user pagó por fuera del sistema (transferencia o efectivo) y
   * avisó al admin por WhatsApp; el admin lo registra acá.
   *
   * Diferencia con endpoints existentes:
   *   - `POST /admin/users` crea User NUEVO + Entry #1 (registración inicial)
   *   - `POST /admin/payments/:id/approve` confirma un Payment ya creado
   *     por el user vía init-payment (cuando MP no replicó el webhook)
   *   - **Este** endpoint suma un Entry adicional a un user que ya existe
   *
   * Precondiciones:
   *   - User existe y está ACTIVE (404 / 403 si no)
   *   - Inscripción NO cerrada (`AppConfig.inscripcion_cierre`) → 410 Gone
   *   - User bajo el cap (`AppConfig.max_entries_per_user`) → 409 si no
   *
   * Transacción:
   *   - SELECT FOR UPDATE de los entries del user (race-safe)
   *   - Re-check del cap dentro de TX
   *   - Crea Payment APPROVED con method/notes/receivedBy
   *   - Crea Entry con position = max(positions actuales) + 1
   *
   * Audit log: `payment.created_manually` con method + notes + amount +
   * adminId. Trazabilidad completa para el club.
   */
  @Post('manual')
  async createManual(
    @Body() dto: CreateManualPaymentDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} no encontrado`);
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        `User ${user.id} no está ACTIVE (status: ${user.status}); no se le pueden agregar prodes.`,
      );
    }

    const config = await this.loadConfig();

    // Cierre de inscripción: hard limit (Q8=A). Ni siquiera el admin
    // puede agregar prodes después del cierre.
    if (config.registrationClose) {
      const close = new Date(config.registrationClose);
      if (!Number.isNaN(close.getTime()) && Date.now() > close.getTime()) {
        throw new ConflictException({
          code: 'REGISTRATION_CLOSED',
          message: `Inscripción cerrada el ${close.toISOString()}; no se aceptan pagos manuales nuevos.`,
        });
      }
    }

    const ipAddress = req.ip ?? req.socket?.remoteAddress;
    const uaHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;

    return this.prisma.$transaction(async (tx) => {
      // Race-safe cap check: bloqueamos los entries del user durante
      // la TX para evitar que un init-payment concurrente los cree.
      const lockedEntries = await tx.$queryRaw<
        Array<{ id: string; position: number }>
      >`
        SELECT id, position
        FROM entries
        WHERE "userId" = ${user.id}
        FOR UPDATE
      `;
      if (lockedEntries.length >= config.maxEntriesPerUser) {
        throw new ConflictException({
          code: 'ENTRY_CAP_REACHED',
          current: lockedEntries.length,
          cap: config.maxEntriesPerUser,
          message: `User llegó al cap de ${config.maxEntriesPerUser} prodes. Para agregar más, subí el cap en /admin/configuracion.`,
        });
      }

      const nextPosition =
        lockedEntries.length === 0
          ? 1
          : Math.max(...lockedEntries.map((e) => e.position)) + 1;

      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          userId: user.id,
          amount: config.price,
          method: dto.method,
          status: 'APPROVED',
          paidAt: now,
          completedAt: now,
          completionTokenHash: null,
          tokenExpiresAt: null,
          receivedBy: admin.id,
          notes: dto.notes ?? null,
        },
      });

      const entry = await tx.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: nextPosition,
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'payment.created_manually',
          entity: 'payment',
          entityId: payment.id,
          changes: {
            targetUserId: user.id,
            targetUserDni: maskDni(user.dni),
            method: dto.method,
            amount: Number(payment.amount),
            notes: dto.notes ?? null,
            entryId: entry.id,
            entryPosition: nextPosition,
          },
          ipAddress,
          userAgent,
        },
      });

      this.logger.log(
        `Manual payment created: paymentId=${payment.id} userId=${user.id} method=${dto.method} amount=${payment.amount} adminId=${admin.id}`,
      );

      return {
        payment: {
          id: payment.id,
          userId: payment.userId,
          amount: Number(payment.amount),
          method: payment.method,
          status: payment.status,
          notes: payment.notes,
          createdAt: payment.createdAt,
        },
        entry: {
          id: entry.id,
          userId: entry.userId,
          position: entry.position,
          status: entry.status,
          createdAt: entry.createdAt,
        },
      };
    });
  }

  /**
   * Lee `inscripcion_precio`, `inscripcion_cierre` y
   * `max_entries_per_user` de AppConfig en una sola query. Si alguna
   * key falta (raro), aplica defaults del spec.
   */
  private async loadConfig(): Promise<{
    price: number;
    registrationClose: string | null;
    maxEntriesPerUser: number;
  }> {
    const rows = await this.prisma.appConfig.findMany({
      where: {
        key: {
          in: [
            'inscripcion_precio',
            'inscripcion_cierre',
            'max_entries_per_user',
          ],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const priceRaw = map.get('inscripcion_precio');
    const price = priceRaw ? Number(priceRaw) : DEFAULT_PRICE;
    const capRaw = map.get('max_entries_per_user');
    const cap = capRaw ? Number(capRaw) : DEFAULT_MAX_ENTRIES;
    return {
      price: Number.isFinite(price) && price > 0 ? price : DEFAULT_PRICE,
      registrationClose: map.get('inscripcion_cierre') ?? null,
      maxEntriesPerUser:
        Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_ENTRIES,
    };
  }
}
