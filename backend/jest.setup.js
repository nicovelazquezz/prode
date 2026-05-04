import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '.env') });

// Bypass `@nestjs/throttler` in the integration suite: most specs fire many
// requests against the app and would otherwise trip the global default
// limiter. The dedicated throttler test (throttler.spec.ts) flips this off
// per-test to exercise the real guard.
process.env.THROTTLER_BYPASS_TEST = '1';
