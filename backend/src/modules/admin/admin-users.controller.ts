import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
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
import {
  DniAlreadyExistsException,
  WhatsappAlreadyExistsException,
} from '../../common/exceptions/domain.exceptions.js';

function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

function maskDni(dni: string): string {
  if (dni.length <= 5) return '***';
  return `${dni.slice(0, 2)}***${dni.slice(-3)}`;
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

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: 'user.created_manually',
          entity: 'user',
          entityId: user.id,
          changes: {
            dni: maskDni(dto.dni),
            paymentId: payment.id,
            paymentMethod: dto.paymentMethod,
            amount: dto.amount,
          },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      return { user, payment };
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
    };
  }
}
