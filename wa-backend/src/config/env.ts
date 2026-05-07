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
  return result.data;
}

export const ENV_TOKEN = Symbol('ENV');

let cached: Env | null = null;
export function loadEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
