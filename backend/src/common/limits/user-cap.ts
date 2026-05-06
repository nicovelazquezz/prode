import { Logger } from '@nestjs/common';
import { MaxUsersReachedException } from '../exceptions/domain.exceptions.js';

/**
 * Default usado cuando el row `AppConfig.max_users` no existe o es
 * inválido. Coincide con `seed-config.ts` y con la decisión del cliente
 * "no creo que crezca más de 500".
 */
const DEFAULT_MAX_USERS = 500;

const logger = new Logger('UserCap');

/** Cliente Prisma o cliente TX — sólo necesitamos appConfig + user. */
type CapClient = {
  appConfig: { findUnique(args: { where: { key: string } }): Promise<{ value: string } | null> };
  user: { count(args: { where: Record<string, unknown> }): Promise<number> };
};

/**
 * Lee `AppConfig.max_users`. Falla cerrado al default si la fila no
 * existe / valor inválido — preferimos negarle el slot a alguien que
 * dejar el sistema sin cap.
 */
async function getMaxUsers(client: CapClient): Promise<number> {
  const row = await client.appConfig.findUnique({ where: { key: 'max_users' } });
  if (!row) return DEFAULT_MAX_USERS;
  const parsed = Number.parseInt(row.value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn(
      `AppConfig.max_users no es número válido (${row.value}); fallback ${DEFAULT_MAX_USERS}`,
    );
    return DEFAULT_MAX_USERS;
  }
  // Hard ceiling: 5000 — más allá no escala el flujo manual del admin
  // y es señal probable de typo. Cliente confirmó volumen <500.
  return Math.min(5000, parsed);
}

/**
 * Tira `MaxUsersReachedException` (409) si el sistema llegó al cap.
 * Se llama dentro del TX que crea el User para que el conteo sea
 * consistente al menos hasta el commit.
 *
 * Race-condition asumida: PostgreSQL no permite `SELECT COUNT FOR UPDATE`,
 * así que en alta concurrencia podrían colarse 1-2 users por encima del
 * cap. Para 200-500 users con tasa de signup baja (manual + webhook MP),
 * el riesgo es despreciable. Si pasara, el admin demote vía PATCH.
 */
export async function assertUnderUserCap(client: CapClient): Promise<void> {
  const cap = await getMaxUsers(client);
  const count = await client.user.count({ where: { role: 'USER' } });
  if (count >= cap) {
    throw new MaxUsersReachedException(cap);
  }
}
