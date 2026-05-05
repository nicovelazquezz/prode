import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '.env') });

// Force NODE_ENV=test for the jest run. The dotenv load above pulls
// `NODE_ENV=development` from the dev `.env` file, which would (a) make
// CheckoutModule bind the dev mock URL flavour and (b) break unit tests
// that assert the legacy `https://mock.local/...` URL shape. Setting it
// here, after dotenv, ensures every spec runs against the test wiring.
process.env.NODE_ENV = 'test';

// Bypass `@nestjs/throttler` in the integration suite: most specs fire many
// requests against the app and would otherwise trip the global default
// limiter. The dedicated throttler test (throttler.spec.ts) flips this off
// per-test to exercise the real guard.
process.env.THROTTLER_BYPASS_TEST = '1';
