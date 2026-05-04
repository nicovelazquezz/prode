import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `JwtAuthGuard` to skip authentication on
 * handlers/controllers explicitly marked as public.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or an entire controller) as not requiring auth.
 * The global `JwtAuthGuard` reads this metadata via `Reflector` and short
 * circuits authorization when present.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
