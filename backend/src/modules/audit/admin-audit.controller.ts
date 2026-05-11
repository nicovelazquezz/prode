import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

class ListAuditDto {
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
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  userId?: string;

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
 * Listing paginado de `audit_logs` para el panel `/admin/auditoria`.
 *
 * Filtros opcionales por entity, action, userId, rango de fechas. Todos
 * usan los índices ya definidos en `schema.prisma` (action, entity+entityId,
 * userId, createdAt).
 *
 * Shape `{ data, total, page, pageSize }` matchea `Paginated<AuditEntry>`
 * del frontend. No incluye join al user para mantener el payload chico —
 * la página renderiza `entry.userId` raw cuando hace falta.
 */
@Controller('admin/audit')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: ListAuditDto) {
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
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...createdAtFilter,
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          action: true,
          entity: true,
          entityId: true,
          changes: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: rows, total, page, pageSize };
  }
}
