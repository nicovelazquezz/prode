// Test factories for the multi-prode era. Every paying user has at
// least Entry #1 (created automatically by complete-registration in
// production); these helpers mirror the same shape for unit / integration
// tests so a `prisma.user.create + prisma.prediction.create({ entryId })`
// pattern stays one call away.

import * as bcrypt from 'bcrypt';
import type {
  Entry,
  Payment,
  User,
} from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';

interface UserOverrides {
  dni?: string;
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  password?: string;
  role?: 'USER' | 'ADMIN';
  status?: 'ACTIVE' | 'INACTIVE' | 'BANNED';
  whatsappOptIn?: boolean;
}

interface UserWithEntry {
  user: User;
  payment: Payment;
  entry: Entry;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

function uniqueDni(): string {
  // 8-digit DNI seeded outside the admin (00000000) and dev-user
  // (1xxxxxxx-5xxxxxxx) ranges. Random but loose — collisions across
  // tests aren't a problem because cleanDb truncates between cases.
  const seed = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 80_000_000;
  return String(60_000_000 + (seed % 19_999_999)).padStart(8, '0');
}

function uniqueWhatsapp(): string {
  const tail = String((Date.now() + counter) % 1_000_000_000).padStart(9, '0');
  return `549291${tail.slice(0, 7)}`;
}

/**
 * Creates a User + APPROVED Payment + Entry #1 in one TX. Returns all
 * three so tests can pin predictions to the entry directly. Mirrors
 * the production path that runs in `/auth/complete-registration` and
 * `/admin/users` — both emit the exact same row trio.
 */
export async function createUserWithEntry(
  prisma: PrismaService,
  overrides: UserOverrides = {},
): Promise<UserWithEntry> {
  const dni = overrides.dni ?? uniqueDni();
  const whatsapp = overrides.whatsapp ?? uniqueWhatsapp();
  const passwordHash = await bcrypt.hash(overrides.password ?? 'prode2026', 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        dni,
        firstName: overrides.firstName ?? `Test${nextId().slice(-4)}`,
        lastName: overrides.lastName ?? 'User',
        whatsapp,
        passwordHash,
        role: overrides.role ?? 'USER',
        status: overrides.status ?? 'ACTIVE',
        whatsappOptIn: overrides.whatsappOptIn ?? true,
      },
    });
    const payment = await tx.payment.create({
      data: {
        userId: user.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    const entry = await tx.entry.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    return { user, payment, entry };
  });
}

/**
 * Creates a User with N entries (each backed by its own APPROVED
 * Payment). Useful for multi-prode-specific tests (cap, switching,
 * leaderboard rendering, etc.).
 */
export async function createUserWithMultipleEntries(
  prisma: PrismaService,
  count: number,
  overrides: UserOverrides = {},
): Promise<{
  user: User;
  payments: Payment[];
  entries: Entry[];
}> {
  if (count < 1) throw new Error('count must be >= 1');

  const first = await createUserWithEntry(prisma, overrides);
  const payments: Payment[] = [first.payment];
  const entries: Entry[] = [first.entry];

  for (let pos = 2; pos <= count; pos += 1) {
    const payment = await prisma.payment.create({
      data: {
        userId: first.user.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    const entry = await prisma.entry.create({
      data: {
        userId: first.user.id,
        paymentId: payment.id,
        position: pos,
        status: 'ACTIVE',
      },
    });
    payments.push(payment);
    entries.push(entry);
  }

  return { user: first.user, payments, entries };
}

/**
 * Convenience for tests that want a user without an entry — e.g. to
 * exercise the "no active entry for user" 404 paths. Most tests should
 * prefer {@link createUserWithEntry}.
 */
export async function createUserWithoutEntry(
  prisma: PrismaService,
  overrides: UserOverrides = {},
): Promise<User> {
  const dni = overrides.dni ?? uniqueDni();
  const whatsapp = overrides.whatsapp ?? uniqueWhatsapp();
  const passwordHash = await bcrypt.hash(overrides.password ?? 'prode2026', 10);
  return prisma.user.create({
    data: {
      dni,
      firstName: overrides.firstName ?? `Test${nextId().slice(-4)}`,
      lastName: overrides.lastName ?? 'User',
      whatsapp,
      passwordHash,
      role: overrides.role ?? 'USER',
      status: overrides.status ?? 'ACTIVE',
      whatsappOptIn: overrides.whatsappOptIn ?? true,
    },
  });
}
