import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
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
import { PaymentsService } from '../payments/payments.service.js';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
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
}
