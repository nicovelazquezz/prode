import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { User } from '../../../generated/prisma/client.js';

interface UpdateMeContext {
  ipAddress?: string;
  userAgent?: string;
}

interface UpdateMeFields {
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  whatsappOptIn?: boolean;
}

/**
 * Thin wrapper over Prisma para lookups de `User`. Incluye `updateMe`
 * (PATCH /users/me) que el user usa para editar campos editables del
 * perfil (nombre, apellido, whatsapp, opt-in).
 *
 * Campos NO editables vía updateMe (intencionalmente):
 *   - dni: identidad fiscal, requiere flow admin si hay error
 *   - status / role: solo admin via PATCH /admin/users/:id
 *   - password: flow propio en /auth/change-password
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByDni(dni: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { dni } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Updates `lastLoginAt` to now. Best-effort: returns void and never
   * throws so a DB hiccup cannot block a successful login.
   */
  async touchLastLogin(id: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      });
    } catch {
      // swallow; login response is more important
    }
  }

  /**
   * PATCH /users/me. Aplica solo los campos provistos (todos opcionales)
   * con trimming en strings. Bloqueado si user.status !== ACTIVE — un
   * user INACTIVE/BANNED no debería poder editar su propio perfil.
   *
   * Audit:
   *   - action: 'user.profile_updated'
   *   - changes.before / changes.after con solo los campos que cambiaron
   *
   * Devuelve el User actualizado (sin password). Si nada cambia respecto
   * al estado actual (ej. user manda exactamente los mismos valores), se
   * devuelve el user existente sin escribir audit.
   */
  async updateMe(
    userId: string,
    body: UpdateMeFields,
    ctx: UpdateMeContext = {},
  ): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Solo usuarios activos pueden editar su perfil',
      );
    }

    // Trim strings; un nombre con solo espacios cae al MinLength del DTO
    // pero por defensa hacemos guard adicional acá.
    const data: UpdateMeFields = {};
    if (body.firstName !== undefined) {
      const v = body.firstName.trim();
      if (v.length < 2) {
        throw new BadRequestException('firstName demasiado corto tras trim');
      }
      if (v !== existing.firstName) data.firstName = v;
    }
    if (body.lastName !== undefined) {
      const v = body.lastName.trim();
      if (v.length < 2) {
        throw new BadRequestException('lastName demasiado corto tras trim');
      }
      if (v !== existing.lastName) data.lastName = v;
    }
    if (body.whatsapp !== undefined && body.whatsapp !== existing.whatsapp) {
      data.whatsapp = body.whatsapp;
    }
    if (
      body.whatsappOptIn !== undefined &&
      body.whatsappOptIn !== existing.whatsappOptIn
    ) {
      data.whatsappOptIn = body.whatsappOptIn;
    }

    if (Object.keys(data).length === 0) {
      // No-op: nada cambió. No escribimos audit ni hacemos UPDATE.
      return existing;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    void this.audit.log({
      userId,
      action: 'user.profile_updated',
      entity: 'user',
      entityId: userId,
      changes: {
        before: pickFields(existing, data),
        after: data,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }
}

/**
 * Saca los mismos keys que `next` desde `existing` para armar el
 * `before` del audit. Evita loggear campos que no cambiaron.
 */
function pickFields(
  existing: User,
  next: UpdateMeFields,
): UpdateMeFields {
  const out: UpdateMeFields = {};
  if (next.firstName !== undefined) out.firstName = existing.firstName;
  if (next.lastName !== undefined) out.lastName = existing.lastName;
  if (next.whatsapp !== undefined) out.whatsapp = existing.whatsapp;
  if (next.whatsappOptIn !== undefined)
    out.whatsappOptIn = existing.whatsappOptIn;
  return out;
}
