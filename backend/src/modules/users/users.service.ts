import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { User } from '../../../generated/prisma/client.js';

/**
 * Thin wrapper over Prisma for `User` lookups consumed across modules.
 * More CRUD will land in later phases; for now the auth flow only needs
 * `findByDni` and `findById`.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
