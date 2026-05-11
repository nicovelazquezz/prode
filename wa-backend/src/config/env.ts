import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  WA_API_TOKEN: z.string().min(16, 'WA_API_TOKEN must be at least 16 chars'),
  WA_AUTH_DIR: z.string().default('./data/auth'),
  WA_SEND_DELAY_MS: z.coerce.number().int().min(0).default(500),
  WA_VERIFY_RECIPIENT: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  WA_RECONNECT_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Watchdog ──────────────────────────────────────────────
  // Cron interno que pinguea el /health del backend principal y
  // alerta por WhatsApp al admin si está caído. Diseñado para vivir
  // afuera del backend principal (en este service) para detectar
  // crashes que el propio backend no podría reportar.
  // Default `false` para que dev/test no arranquen un cron contra un
  // backend que no existe. En prod, el compose lo setea explícitamente
  // a `true` (y exige ADMIN_WHATSAPP_NUMBER).
  WATCHDOG_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
  BACKEND_HEALTH_URL: z
    .string()
    .url()
    .default('http://prode-backend:3001/health'),
  WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WATCHDOG_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  WATCHDOG_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  // E.164 sin "+" (ej "5491166660000"). Requerido cuando
  // WATCHDOG_ENABLED=true; el parser lo valida abajo.
  ADMIN_WHATSAPP_NUMBER: z.string().regex(/^\d{10,15}$/).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid env — ${issues}`);
  }
  // Cross-field validation: si el watchdog está habilitado, ADMIN_WHATSAPP_NUMBER
  // es obligatorio (sino no hay a quién mandar la alerta).
  if (result.data.WATCHDOG_ENABLED && !result.data.ADMIN_WHATSAPP_NUMBER) {
    throw new Error(
      'Invalid env — ADMIN_WHATSAPP_NUMBER es obligatorio cuando WATCHDOG_ENABLED=true',
    );
  }
  return result.data;
}

export const ENV_TOKEN = Symbol('ENV');

let cached: Env | null = null;
export function loadEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
