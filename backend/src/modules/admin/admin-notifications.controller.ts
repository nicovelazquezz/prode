import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { maskDni } from '../../common/utils/mask.js';

class SendDirectNotificationDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsIn(['WHATSAPP'])
  // Email queda fuera del scope de v1 (decisión KISS) — el contrato del
  // frontend admite EMAIL pero acá solo aceptamos WHATSAPP. Si en algún
  // momento se reactiva email, agregar 'EMAIL' al IsIn.
  channel!: 'WHATSAPP';
}

/**
 * `POST /admin/notifications/direct` — admin manda un mensaje
 * 1-a-1 a un user vía WhatsApp. Casos de uso:
 *   - "Tu pago quedó pendiente, ¿necesitás ayuda?"
 *   - "Avisame por WA si vas a pagar el premio en efectivo o por
 *     transferencia, mandame el CBU"
 *   - Cualquier comunicación puntual del admin durante el torneo.
 *
 * Reusa la pipeline existente de `NotificationsService.enqueue`
 * (escribe Notification PENDING + encola BullMQ → procesa el worker →
 * dispatcher contra el WhatsApp gateway). Si el gateway está caído
 * cuando se llama, la notif queda PENDING y la levanta el cron de
 * safety net.
 *
 * Audit log automático con la masking del DNI del destinatario.
 */
@Controller('admin/notifications')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Post('direct')
  async sendDirect(
    @Body() dto: SendDirectNotificationDto,
    @CurrentUser() admin: AuthenticatedUser | undefined,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    if (!admin?.id) {
      throw new UnauthorizedException('Authenticated admin required');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: {
        id: true,
        dni: true,
        firstName: true,
        whatsapp: true,
        whatsappOptIn: true,
        status: true,
      },
    });
    if (!target) {
      throw new NotFoundException('User no encontrado');
    }
    if (target.status !== 'ACTIVE') {
      throw new BadRequestException(
        'No se puede enviar a usuarios INACTIVE/BANNED',
      );
    }
    if (!target.whatsapp) {
      throw new BadRequestException('El usuario no tiene WhatsApp registrado');
    }

    const notif = await this.notifications.enqueue({
      userId: target.id,
      toAddress: target.whatsapp,
      type: 'ADMIN_BROADCAST',
      title: dto.title,
      message: dto.message,
      channel: 'WHATSAPP',
    });

    const ipAddress = req.ip ?? req.socket?.remoteAddress;
    const uaHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
    void this.audit.log({
      userId: admin.id,
      action: 'admin.notification_sent_direct',
      entity: 'notification',
      entityId: notif.id,
      changes: {
        targetUserId: target.id,
        targetUserDni: maskDni(target.dni),
        title: dto.title,
        channel: 'WHATSAPP',
      },
      ipAddress,
      userAgent,
    });

    return { id: notif.id };
  }
}
