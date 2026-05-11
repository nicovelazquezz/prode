import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  MP_ACCESS_TOKEN: z.string().min(1),
  MP_PUBLIC_KEY: z.string().min(1),
  MP_WEBHOOK_SECRET: z.string().min(1),

  WHATSAPP_API_URL: z.string().url(),
  WHATSAPP_API_TOKEN: z.string().min(1),
  ADMIN_WHATSAPP_NUMBER: z.string().regex(/^\d{10,15}$/),

  EMAIL_FROM: z.string().email(),
  RESEND_API_KEY: z.string().min(1).optional(),

  FRONTEND_URL: z.string().url(),
  API_URL: z.string().url(),

  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),

  // Admin bootstrap (consumed by seed-config.ts only). Optional at runtime.
  ADMIN_DEFAULT_DNI: z.string().regex(/^\d{7,9}$/).optional(),
  ADMIN_DEFAULT_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Sustrings que delatan valores de dev/test que NO pueden vivir en
 * `NODE_ENV=production`. La idea es defensiva: si el operador clona un
 * `.env` de dev a prod (un error humano frecuente), el bootstrap explota
 * con un mensaje claro en vez de levantarse con secretos predecibles.
 *
 * Heurística pragmática — ninguna substring es prueba de inseguridad,
 * pero todas son señales de que el valor NO se rotó para prod.
 */
const FORBIDDEN_PROD_TOKENS = [
  'dev_only',
  'ChangeMe',
  'changeme',
  'test-secret',
  'your-secret-here',
  'placeholder',
];

const SECRET_FIELDS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'MP_WEBHOOK_SECRET',
  'WHATSAPP_API_TOKEN',
  'ADMIN_DEFAULT_PASSWORD',
] as const;

/**
 * Variables que el schema Zod marca opcionales (porque dev/test no las
 * requiere), pero en NODE_ENV=production su ausencia es un blocker:
 *   - ADMIN_DEFAULT_PASSWORD: sin esto, seed-config skipea la creación
 *     del admin y no hay panel.
 *
 * `TURNSTILE_SECRET_KEY` y `SENTRY_DSN` no están en esta lista para la
 * beta cerrada: el throttle por IP defiende suficiente y los 5xx se
 * miran por logs de Dokploy. Agregalos cuando la app esté pública.
 */
const REQUIRED_IN_PROD = ['ADMIN_DEFAULT_PASSWORD'] as const;

/**
 * Hard-guard que corre **después** de la validación Zod cuando
 * `NODE_ENV=production`. Aborta el bootstrap si:
 *   - `THROTTLER_BYPASS_TEST` está definida (no debe existir en prod).
 *   - Algún secreto contiene un token prohibido (dev_only, ChangeMe, etc.).
 *   - `ADMIN_DEFAULT_PASSWORD === 'ChangeMe_DevOnly!'` (default literal).
 *
 * No imprime los valores — solo el nombre del campo y la razón. Mantener
 * el password real fuera de los logs es parte del contrato.
 */
function assertProductionEnvSafety(env: Env): void {
  if (env.NODE_ENV !== 'production') return;

  const violations: string[] = [];

  if (process.env.THROTTLER_BYPASS_TEST !== undefined) {
    violations.push(
      'THROTTLER_BYPASS_TEST está definida en NODE_ENV=production — borrala del .env de prod (deshabilitaría todos los rate limits).',
    );
  }

  for (const field of REQUIRED_IN_PROD) {
    const value = (env as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.length === 0) {
      violations.push(
        `${field} es obligatoria cuando NODE_ENV=production. Cargala en el panel de Dokploy antes de bootear.`,
      );
    }
  }

  for (const field of SECRET_FIELDS) {
    const value = (env as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    const offending = FORBIDDEN_PROD_TOKENS.find((tok) =>
      value.toLowerCase().includes(tok.toLowerCase()),
    );
    if (offending) {
      violations.push(
        `${field} contiene el sustring prohibido "${offending}" — rotá el secreto antes de bootear prod.`,
      );
    }
  }

  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      '\nFATAL: configuración de producción insegura.\n' +
        violations.map((v) => `  • ${v}`).join('\n') +
        '\n',
    );
    process.exit(1);
  }
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid env vars:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  assertProductionEnvSafety(parsed.data);
  return parsed.data;
}
