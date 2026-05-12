import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { Role, UserStatus } from '../../../generated/prisma/enums.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateManualUserDto } from './dto/create-manual-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  DniAlreadyExistsException,
  WhatsappAlreadyExistsException,
} from '../../common/exceptions/domain.exceptions.js';
import { assertUnderUserCap } from '../../common/limits/user-cap.js';
import { maskDni } from '../../common/utils/mask.js';

function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

/**
 * Query DTO para `GET /admin/users`. Todos los campos opcionales; el
 * controller aplica defaults (page=1, pageSize=20, sin filtros).
 */
class ListAdminUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: keyof typeof UserStatus;

  @IsOptional()
  @IsEnum(Role)
  role?: keyof typeof Role;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/**
 * Admin-only endpoint for **manual** user registration. Used when the
 * admin collects payment offline (cash or bank transfer) — the public
 * registration flow assumes a MercadoPago round-trip, which doesn't apply
 * here.
 *
 * The endpoint creates two rows in the same transaction:
 *
 *   - `User` (role=USER, status=ACTIVE) with the same constraints as the
 *     public flow (DNI 7-8 digits, password ≥8 chars + 1 digit, etc.).
 *   - `Payment` with `method ∈ {CASH, TRANSFER}`, `status=APPROVED`,
 *     `paidAt = now`, `completedAt = now`, `userId` set, and
 *     `completionTokenHash = null` (no magic link is needed since the user
 *     is already known).
 *
 * Audit log: `user.created_manually` with the masked DNI + amount + method
 * so the trail can answer "who registered who, and how much they paid".
 *
 * `JwtAuthGuard` runs globally; `RolesGuard` enforces ADMIN locally.
 */
@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /admin/users — listado paginado con filtros básicos para que la
   * página `/admin/usuarios` del panel pueda buscar / filtrar / paginar.
   *
   * Query params (todos opcionales):
   *   - page (default 1)
   *   - pageSize (default 20, max 100)
   *   - status: ACTIVE | INACTIVE | BANNED
   *   - role: USER | ADMIN
   *   - search: matchea contra firstName, lastName y dni (case-insensitive)
   *
   * Response: `{ page, pageSize, total, data: AdminUser[] }`. Cada user
   * trae su `paidAt` (timestamp del Payment APPROVED más reciente, o null)
   * para que el admin pueda ordenar por "quién pagó cuándo" sin un join
   * extra del lado del frontend.
   */
  @Get()
  async list(@Query() query: ListAdminUsersDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const skip = (page - 1) * pageSize;

    const search = query.search?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { dni: { contains: search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          dni: true,
          firstName: true,
          lastName: true,
          whatsapp: true,
          whatsappOptIn: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          payments: {
            where: { status: 'APPROVED' },
            orderBy: { paidAt: 'desc' },
            take: 1,
            select: { paidAt: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = rows.map((u) => ({
      id: u.id,
      dni: u.dni,
      firstName: u.firstName,
      lastName: u.lastName,
      whatsapp: u.whatsapp,
      whatsappOptIn: u.whatsappOptIn,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      paidAt: u.payments[0]?.paidAt ?? null,
    }));

    return { page, pageSize, total, data };
  }

  @Post()
  async createManual(
    @Body() dto: CreateManualUserDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      // Belt-and-suspenders — JwtAuthGuard already rejects anonymous calls.
      throw new UnauthorizedException('Authenticated admin required');
    }
    const ctx = getRequestContext(req);

    // Pre-checks for clearer error mapping. The DB unique constraints on
    // `dni` and `whatsapp` are the actual race-safe guards; these just
    // give a better 409 in the common case.
    const dupDni = await this.prisma.user.findUnique({
      where: { dni: dto.dni },
    });
    if (dupDni) throw new DniAlreadyExistsException();

    const dupWa = await this.prisma.user.findUnique({
      where: { whatsapp: dto.whatsapp },
    });
    if (dupWa) throw new WhatsappAlreadyExistsException();

    // Hash the password OUTSIDE the TX — bcrypt is CPU-bound and we don't
    // want to hold a pooled DB connection while it spins.
    const passwordHash = await this.authService.hashPassword(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      // Cap global: el admin manual también gasta slots del max_users.
      await assertUnderUserCap(tx);

      const user = await tx.user.create({
        data: {
          dni: dto.dni,
          firstName: dto.firstName,
          lastName: dto.lastName,
          whatsapp: dto.whatsapp,
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          userId: user.id,
          amount: dto.amount,
          method: dto.paymentMethod,
          status: 'APPROVED',
          paidAt: now,
          completedAt: now,
          // No magic-link token: the user already exists; the link is
          // only meaningful for the post-payment public-registration form.
          completionTokenHash: null,
          tokenExpiresAt: null,
          receivedBy: dto.receivedBy ?? null,
          notes: dto.notes ?? null,
        },
      });

      // Multi-prode: every paying user gets Entry #1 inline. Same shape
      // as the public flow's complete-registration, just using the
      // CASH/TRANSFER payment as paymentId.
      const entry = await tx.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'user.created_manually',
          entity: 'user',
          entityId: user.id,
          changes: {
            dni: maskDni(dto.dni),
            paymentId: payment.id,
            entryId: entry.id,
            paymentMethod: dto.paymentMethod,
            amount: dto.amount,
          },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'entry.created',
          entity: 'entry',
          entityId: entry.id,
          changes: {
            paymentId: payment.id,
            position: 1,
            source: 'admin_manual',
            ownerUserId: user.id,
          },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      return { user, payment, entry };
    });

    this.logger.log(
      `Manual user creation by admin=${admin.id}: user=${result.user.id} payment=${result.payment.id} method=${dto.paymentMethod}`,
    );

    return {
      user: {
        id: result.user.id,
        dni: result.user.dni,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        whatsapp: result.user.whatsapp,
        role: result.user.role,
        status: result.user.status,
      },
      payment: {
        id: result.payment.id,
        amount: Number(result.payment.amount),
        method: result.payment.method,
        status: result.payment.status,
      },
      entry: {
        id: result.entry.id,
        position: result.entry.position,
        status: result.entry.status,
      },
    };
  }

  /**
   * Edita campos seleccionados de un user existente: nombre/apellido,
   * whatsapp, status (ACTIVE/INACTIVE/BANNED), role (USER/ADMIN).
   *
   * No incluye dni (rompería identidad/audit trail) ni password (endpoint
   * dedicado abajo). Audita un diff de los campos modificados.
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }
    const ctx = getRequestContext(req);

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }

    // Lockout-prevention: el admin no puede demoteerse a USER en una
    // sola request (queda sin admins). Para casos legítimos (cambio de
    // ownership), el admin entrante hace el cambio en una request aparte.
    if (admin.id === id && dto.role === 'USER') {
      throw new BadRequestException(
        'No podés demotearte a USER en la misma request. Pedile a otro admin que lo haga.',
      );
    }

    // WhatsApp unique check sólo si cambió.
    if (dto.whatsapp && dto.whatsapp !== existing.whatsapp) {
      const dupWa = await this.prisma.user.findUnique({
        where: { whatsapp: dto.whatsapp },
      });
      if (dupWa && dupWa.id !== id) throw new WhatsappAlreadyExistsException();
    }

    // Construir el diff: sólo campos efectivamente cambiados, para que
    // el audit log no espamee con noops cuando el frontend manda toda la
    // forma sin tocar.
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const data: {
      firstName?: string;
      lastName?: string;
      whatsapp?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'BANNED';
      role?: 'USER' | 'ADMIN';
    } = {};
    if (dto.firstName !== undefined && dto.firstName !== existing.firstName) {
      diff.firstName = { from: existing.firstName, to: dto.firstName };
      data.firstName = dto.firstName;
    }
    if (dto.lastName !== undefined && dto.lastName !== existing.lastName) {
      diff.lastName = { from: existing.lastName, to: dto.lastName };
      data.lastName = dto.lastName;
    }
    if (dto.whatsapp !== undefined && dto.whatsapp !== existing.whatsapp) {
      diff.whatsapp = { from: existing.whatsapp, to: dto.whatsapp };
      data.whatsapp = dto.whatsapp;
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      diff.status = { from: existing.status, to: dto.status };
      data.status = dto.status;
    }
    if (dto.role !== undefined && dto.role !== existing.role) {
      diff.role = { from: existing.role, to: dto.role };
      data.role = dto.role;
    }

    if (Object.keys(diff).length === 0) {
      // No-op: devolvemos el shape igual sin tocar DB ni auditar.
      return this.toPublicUser(existing);
    }

    const updated = await this.prisma.user.update({ where: { id }, data });

    void this.audit.log({
      action: 'user.updated_by_admin',
      entity: 'user',
      entityId: id,
      changes: diff,
      userId: admin.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    this.logger.log(
      `Admin ${admin.id} updated user ${id} fields=${Object.keys(diff).join(',')}`,
    );
    return this.toPublicUser(updated);
  }

  /**
   * Genera una password nueva para el user, la persiste hasheada con
   * bcrypt y revoca todos los refresh tokens activos. Devuelve la
   * password en plano una vez para que el admin se la comunique al user
   * por WhatsApp/voz. El user puede después usar el flow estándar de
   * `/forgot-password` para cambiarla a una de su elección.
   *
   * 12 hex chars = 48 bits de entropía: suficiente para un one-time
   * compartido offline. Cumple `min 8 chars + 1 digit` del schema (hex
   * tiene 0-9).
   */
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }
    const ctx = getRequestContext(req);

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const newPassword = randomBytes(6).toString('hex');
    const passwordHash = await this.authService.hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      // Echar a todas las sesiones activas — si la password se filtró,
      // queremos que el atacante pierda acceso aunque haya un access
      // token vivo (que vence en minutos de todos modos).
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    void this.audit.log({
      action: 'user.password_reset_by_admin',
      entity: 'user',
      entityId: id,
      // No persistir el plaintext en el audit log — sólo la traza.
      changes: { rotatedAt: new Date().toISOString() },
      userId: admin.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    this.logger.log(`Admin ${admin.id} reset password for user ${id}`);
    return { password: newPassword };
  }

  /**
   * `GET /admin/users/:id/deletion-impact` — read-only summary que el
   * frontend usa para mostrar el warning antes de borrar.
   *
   * Devuelve cuántas filas se van a borrar en cascada (entries +
   * predictions), cuántas quedarán huérfanas con `userId=null`
   * (payments, notifications, audit logs) y cuántas leagues bloquean
   * el delete porque el user es owner.
   *
   * `canDelete` solo refleja blockers estructurales (leagues owned).
   * Los guards self-delete y last-admin se chequean en el momento del
   * DELETE porque dependen del caller.
   */
  @Get(':id/deletion-impact')
  async deletionImpact(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser | undefined,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, dni: true, firstName: true, lastName: true },
    });
    if (!target) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const [entriesCount, predictionsCount, paymentsCount, leaguesOwned] =
      await Promise.all([
        this.prisma.entry.count({ where: { userId: id } }),
        this.prisma.prediction.count({ where: { entry: { userId: id } } }),
        this.prisma.payment.count({ where: { userId: id } }),
        this.prisma.league.findMany({
          where: { ownerId: id },
          select: { id: true, name: true },
        }),
      ]);

    const blockers: string[] = [];
    if (leaguesOwned.length > 0) {
      blockers.push(
        `Es owner de ${leaguesOwned.length} liga(s). Transferí el ownership o borrá la liga antes.`,
      );
    }

    return {
      entriesCount,
      predictionsCount,
      paymentsCount,
      leaguesOwnedCount: leaguesOwned.length,
      leaguesOwned,
      canDelete: blockers.length === 0,
      blockers,
    };
  }

  /**
   * `DELETE /admin/users/:id` — hard delete con guards de seguridad.
   *
   * Cascadea: entries (→ predictions, special_predictions), refresh
   * tokens, password resets.
   * SetNull: payments.userId, audit_logs.userId, notifications.userId
   * (preservados para auditoría contable y de log).
   * Restrict: leagues.ownerId — bloquea el delete; el admin tiene que
   * transferir o borrar la liga primero.
   *
   * Audit + delete corren en una sola TX. Si la audit insert falla,
   * el delete revierte — no queremos un user borrado sin rastro.
   *
   * Idempotencia: si dos requests llegan a la vez, la primera borra y
   * la segunda recibe 404 (Prisma P2025) que el frontend traduce a
   * "ya fue eliminado".
   */
  @Delete(':id')
  @HttpCode(200)
  async delete(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }
    const ctx = getRequestContext(req);

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        dni: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
    if (!target) {
      throw new NotFoundException(`User ${id} not found`);
    }

    if (admin.id === id) {
      throw new BadRequestException(
        'No podés borrarte a vos mismo. Pedile a otro admin que lo haga.',
      );
    }

    if (target.role === 'ADMIN') {
      const remainingAdmins = await this.prisma.user.count({
        where: { role: 'ADMIN', id: { not: id } },
      });
      if (remainingAdmins === 0) {
        throw new BadRequestException(
          'Tiene que quedar al menos un admin. No se puede borrar al último.',
        );
      }
    }

    const ownedLeagues = await this.prisma.league.findMany({
      where: { ownerId: id },
      select: { id: true, name: true },
    });
    if (ownedLeagues.length > 0) {
      throw new ConflictException({
        message: 'El usuario es owner de ligas. Transferí o borrá esas ligas primero.',
        leaguesOwned: ownedLeagues,
      });
    }

    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Snapshot dentro de la TX para que los counts no driften.
      const [entriesCount, paymentsCount] = await Promise.all([
        tx.entry.count({ where: { userId: id } }),
        tx.payment.count({ where: { userId: id } }),
      ]);

      await tx.user.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'admin.user_deleted',
          entity: 'user',
          entityId: id,
          changes: {
            targetDni: target.dni,
            targetFirstName: target.firstName,
            targetLastName: target.lastName,
            entriesCount,
            paymentsCount,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });

    this.logger.log(
      `Admin ${admin.id} hard-deleted user ${id} (dni=${maskDni(target.dni)})`,
    );

    return { id, dni: target.dni, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Shape público del User para los responses de PATCH/POST de este
   * controller. Match con `User` del frontend (lib/api/types.ts) sin
   * passwordHash ni timestamps internos.
   */
  private toPublicUser(u: {
    id: string;
    dni: string;
    firstName: string;
    lastName: string;
    whatsapp: string;
    role: 'USER' | 'ADMIN';
    status: 'ACTIVE' | 'INACTIVE' | 'BANNED';
  }) {
    return {
      id: u.id,
      dni: u.dni,
      firstName: u.firstName,
      lastName: u.lastName,
      whatsapp: u.whatsapp,
      role: u.role,
      status: u.status,
    };
  }
}
