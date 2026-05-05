import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Default inscription price (ARS) used when `AppConfig.inscripcion_precio`
 * is missing or unparseable. Mirrors `PaymentsService.DEFAULT_AMOUNT_ARS`
 * so a stat counter and a real init() agree on what a single signup is
 * worth.
 */
const DEFAULT_PRICE_ARS = 15_000;

export interface PublicStats {
  /** Active, role=USER signups (the ones that contribute to the pozo). */
  enrolledUsers: number;
  /** `enrolledUsers * inscripcion_precio` in ARS. */
  pozoEstimate: number;
}

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lightweight counter used by the landing page. The two queries run in
   * parallel — both touch tiny indexed columns. Caching is the
   * controller's job (60s TTL) since the controller is also where a
   * future Redis-backed cache would plug in.
   */
  async getPublicStats(): Promise<PublicStats> {
    const [enrolledUsers, priceRow] = await Promise.all([
      this.prisma.user.count({
        where: { role: 'USER', status: 'ACTIVE' },
      }),
      this.prisma.appConfig.findUnique({
        where: { key: 'inscripcion_precio' },
      }),
    ]);

    const parsedPrice = priceRow ? Number(priceRow.value) : NaN;
    const price = Number.isFinite(parsedPrice) && parsedPrice > 0
      ? parsedPrice
      : DEFAULT_PRICE_ARS;

    if (priceRow && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      this.logger.warn(
        `inscripcion_precio is not a positive number: ${priceRow.value}; using ${DEFAULT_PRICE_ARS}`,
      );
    }

    return {
      enrolledUsers,
      pozoEstimate: enrolledUsers * price,
    };
  }
}
