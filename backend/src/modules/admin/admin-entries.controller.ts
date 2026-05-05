import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

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
}
