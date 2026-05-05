// Service worker entry point used by @serwist/next.
// `swSrc: "app/sw.ts"` in `next.config.ts` causes this file to be compiled
// to `public/sw.js` during `next build` (webpack mode only — see notes below).
//
// This file is EXCLUDED from the main tsconfig and is type-checked separately
// via `tsconfig.sw.json` (webworker lib instead of dom). It is compiled by
// webpack during `next build`.
//
// IMPORTANT: Serwist hooks into webpack to inject the precache manifest.
// Next.js 16 defaults to Turbopack for `next dev` and `next build`, which
// Serwist does NOT yet support. To make the production SW build work:
//   - `package.json` build script uses `next build --webpack`
//   - `dev` keeps Turbopack (the SW is disabled in dev anyway via
//     `disable: process.env.NODE_ENV !== "production"` in next.config.ts).
//
// Track Turbopack support: https://github.com/serwist/serwist/issues/54
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
