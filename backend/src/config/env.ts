import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
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

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid env vars:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
