# Prode Frontend — Plan de implementación

> **For Claude:** Use executing-plans skill to implement this plan task-by-task. Reference `docs/superpowers/specs/2026-05-05-prode-frontend-design.md` for full design detail; this plan instructs *how* to build it, the spec is the *what*.

## Remember
- Exact file paths always
- Complete code for non-obvious logic; reference spec for code that's already there
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits (1 commit per task minimum, 1 per phase mandatory)
- All paths relative to `/Users/nicolasvelazquez/Desktop/dev/prode/` unless stated otherwise
- Frontend code lives in `frontend/`; Phase 0 modifications go to `backend/`
- **Use `npm` and `npx`**, not `pnpm`/`pnpx`

## Overview

Frontend mobile-first del Prode Mundial 2026. Implementa el sistema visual FIFA WC 2026 (DESIGN.md) sobre Next.js 15 App Router, conectado al backend NestJS ya construido. Local-testable end-to-end sin MercadoPago real (mock checkout). Deploy junto al backend en Dokploy con dominio `prode.tirofederal.com`.

**Spec de referencia (autoridad):** `docs/superpowers/specs/2026-05-05-prode-frontend-design.md`

**Stack:** Next.js 15 + React 19 + TypeScript + Tailwind v4 + shadcn/ui + TanStack Query + ky + RHF/Zod + Framer Motion + Vitest + Playwright + Serwist + Sentry.

## Prerequisites

Validar que el entorno tiene:
- [ ] Node.js 22 LTS (`node -v` ≥ 20.19)
- [ ] npm 11+ (`npm -v`)
- [ ] Docker corriendo (Postgres + Redis del backend levantados)
- [ ] Backend funcionando localmente (`cd backend && npm run start:dev` levanta sin errores en puerto 3001)
- [ ] Backend con seeds aplicados (admin DNI=00000000)
- [ ] Git configurado en el repo

## Estructura del plan

11 fases. Phase 0 modifica el backend (no toca el frontend todavía); Phases 1-10 construyen el frontend.

| Fase | Nombre | Tareas | Output verificable |
|------|--------|--------|---------------------|
| 0 | Backend prerequisites | 7 | 7 endpoints/cambios disponibles, tests pasando |
| 1 | Foundation | 6 | Next.js levanta, /health responde, conecta al backend |
| 2 | Design system | 7 | Tailwind v4 + tokens FIFA WC + shadcn primitives + fonts |
| 3 | Auth + Layouts | 8 | tokenStore, refresh interceptor, AuthProvider, 3 layouts (public/app/admin) |
| 4 | Pages públicas | 7 | Landing + login + completar-registro + recovery + mock-checkout |
| 5 | App — Predicciones | 6 | /predicciones (lista+por fase), vista detalle, especiales |
| 6 | App — Leaderboard + Ligas + Perfil | 6 | Tabla global/fase/liga, mini-ligas, perfil |
| 7 | Admin panel | 8 | Dashboard, usuarios, pagos, partidos, fases, notif, audit, config |
| 8 | PWA + perf hardening | 5 | Serwist SW, manifest, optimizations, Sentry |
| 9 | E2E test suite | 5 | 5 flujos Playwright pasando contra backend local |
| 10 | Deployment | 4 | Dockerfile + Dokploy compose update + deploy a staging |

**Total estimado: ~69 tareas atómicas.**

---

# FASE 0 — Backend prerequisites (BLOQUEANTE para frontend)

**Goal:** los 7 cambios bloqueantes que el frontend asume del backend (spec frontend §1.5). Sin esto el frontend no puede consumir las APIs ni hacer auth correctamente.

**Working dir para esta fase:** `backend/` (no `frontend/` todavía).

## Task 0.1 — Cookie refresh: SameSite=Lax + Domain=.tirofederal.com

**File:** `backend/src/modules/auth/auth.controller.ts` (y donde sea que se setea la cookie de refresh)

**Acceptance:**
- Cookie `refresh_token` se emite con `sameSite: 'lax'` y `domain: '.tirofederal.com'` en producción
- En desarrollo (NODE_ENV !== 'production'), `domain` es undefined (no agregarlo) y `sameSite: 'lax'` igualmente
- Cookie `has_session=1` (no httpOnly) emitida junto con el refresh para que el frontend pueda detectar sesión sin pegar al backend en cada landing
- En logout, ambas cookies se borran

**Code change (ejemplo):**
```typescript
// donde se setea la cookie
res.cookie('refresh_token', refreshPlain, {
  httpOnly: true,
  secure: this.config.NODE_ENV === 'production',
  sameSite: 'lax',
  domain: this.config.NODE_ENV === 'production' ? '.tirofederal.com' : undefined,
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
res.cookie('has_session', '1', {
  httpOnly: false,
  secure: this.config.NODE_ENV === 'production',
  sameSite: 'lax',
  domain: this.config.NODE_ENV === 'production' ? '.tirofederal.com' : undefined,
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

// en logout
res.cookie('refresh_token', '', { ...sameOpts, maxAge: 0 });
res.cookie('has_session', '', { ...sameOpts, maxAge: 0 });
```

**Verification:**
```bash
cd backend && npm test -- --runInBand --testPathPattern=auth
# Expected: existing auth tests still pass
```

**Commit:** `feat(backend/auth): cookies SameSite=Lax + Domain + has_session hint`

---

## Task 0.2 — POST /dev/simulate-webhook (gated NODE_ENV !== prod)

**File:** `backend/src/modules/dev/dev.controller.ts` (nuevo módulo)

**Acceptance:**
- Endpoint `POST /dev/simulate-webhook`
- Body: `{ paymentId: string, status: 'approved' | 'rejected' | 'pending', payerEmail?: string }`
- Si `NODE_ENV === 'production'`: devuelve 404 (`notFound()` o `ForbiddenException`)
- Construye un payload fake estilo MP (`{ type: 'payment', data: { id: <mp_payment_id_fake> }, ... }`)
- Despacha al handler real del webhook (reutiliza `PaymentsService.handleWebhookPayment` o método análogo)
- Devuelve 200 con `{ ok: true, paymentId, status }`
- Solo se registra en `AppModule` si `NODE_ENV !== 'production'` (condicional en imports)

**Code:**
```typescript
// backend/src/modules/dev/dev.controller.ts
import { Controller, Post, Body, NotFoundException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ConfigService } from '@nestjs/config';

@Controller('dev')
export class DevController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('simulate-webhook')
  async simulateWebhook(@Body() dto: { paymentId: string; status: 'approved' | 'rejected' | 'pending'; payerEmail?: string }) {
    if (this.config.get('NODE_ENV') === 'production') throw new NotFoundException();

    const fakeMpId = `mock_pay_${Date.now()}`;
    const fakePayload = {
      type: 'payment',
      data: { id: fakeMpId },
      payment: {
        id: fakeMpId,
        status: dto.status,
        external_reference: dto.paymentId,
        payer: { email: dto.payerEmail ?? 'mock@test.com', first_name: 'Mock' },
        metadata: { completion_token: '<resolver>', payment_id: dto.paymentId },
      },
    };

    // Llamar al método del PaymentsService que normalmente invocaría el webhook handler.
    // Ajustar según la signature real (puede requerir simular firma válida o agregar bypass por env).
    await this.payments.processWebhook(fakePayload, { skipSignatureVerification: true });

    return { ok: true, paymentId: dto.paymentId, status: dto.status };
  }
}
```

**`PaymentsService.processWebhook` debe aceptar un opt `{ skipSignatureVerification?: boolean }` y, cuando `NODE_ENV !== 'production'`, permitirlo. NUNCA permitirlo en prod (assert).**

**`DevModule`:**
```typescript
// backend/src/modules/dev/dev.module.ts
import { Module } from '@nestjs/common';
import { DevController } from './dev.controller.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  controllers: [DevController],
})
export class DevModule {}
```

**Conditional import en `app.module.ts`:**
```typescript
const isDev = process.env.NODE_ENV !== 'production';
@Module({
  imports: [
    // ...
    ...(isDev ? [DevModule] : []),
  ],
})
```

**Test:** `backend/src/modules/dev/dev.controller.spec.ts` — integration test que llama `POST /dev/simulate-webhook` y verifica que el Payment en BD pasa a APPROVED.

**Verification:**
```bash
cd backend && npm test -- --runInBand --testPathPattern=dev
# Expected: passing
```

**Commit:** `feat(backend/dev): POST /dev/simulate-webhook for local frontend testing`

---

## Task 0.3 — GET /stats/public

**File:** `backend/src/modules/stats/stats.controller.ts` (nuevo módulo)

**Acceptance:**
- Endpoint `GET /stats/public` (público, sin auth)
- Retorna `{ enrolledUsers: number, pozoEstimate: number }`
- `enrolledUsers`: count de Users con role=USER y status=ACTIVE
- `pozoEstimate`: `enrolledUsers * inscripcionPrecio` desde AppConfig
- Cache 60s (memory-store via `@nestjs/cache-manager` o Redis)

**Code:**
```typescript
@Public()
@Get('public')
async public() {
  const [enrolledUsers, priceConfig] = await Promise.all([
    this.prisma.user.count({ where: { role: 'USER', status: 'ACTIVE' } }),
    this.prisma.appConfig.findUnique({ where: { key: 'inscripcion_precio' } }),
  ]);
  const pozoEstimate = enrolledUsers * Number(priceConfig?.value ?? 15000);
  return { enrolledUsers, pozoEstimate };
}
```

**Test integration.**

**Commit:** `feat(backend/stats): GET /stats/public for landing live counter`

---

## Task 0.4 — GET /auth/me

**File:** `backend/src/modules/auth/auth.controller.ts`

**Acceptance:**
- Endpoint `GET /auth/me` (auth required)
- Retorna `{ id, dni, firstName, lastName, whatsapp, role, status, whatsappOptIn, createdAt, lastLoginAt }`
- NO incluye passwordHash, refreshTokens, etc.
- Si JWT inválido → 401

**Code:**
```typescript
@Get('me')
async me(@CurrentUser() user: User) {
  return pick(user, ['id', 'dni', 'firstName', 'lastName', 'whatsapp', 'role', 'status', 'whatsappOptIn', 'createdAt', 'lastLoginAt']);
}
```

**Test integration.**

**Commit:** `feat(backend/auth): GET /auth/me returns current user`

---

## Task 0.5 — POST /auth/change-password

**File:** `backend/src/modules/auth/auth.controller.ts`

**Acceptance:**
- Endpoint `POST /auth/change-password` (auth required)
- DTO: `{ currentPassword: string, newPassword: string (min 8, contains digit) }`
- Valida currentPassword vs hash en BD; si no matchea → 400 "Contraseña actual incorrecta"
- Update User.passwordHash con bcrypt(newPassword, 12)
- Revoca todos los RefreshToken activos del user (forzar re-login en otros dispositivos)
- Audit log `auth.password_changed_by_user`
- Devuelve 204

**Test integration.**

**Commit:** `feat(backend/auth): POST /auth/change-password`

---

## Task 0.6 — GET /users/:id/public-profile

**File:** `backend/src/modules/users/users.controller.ts`

**Acceptance:**
- Endpoint `GET /users/:id/public-profile` (público, sin auth — para drawer del leaderboard)
- Retorna `{ id, firstName, lastName, predictionsFinished: [{ matchId, scoreHome, scoreAway, outcomeType, pointsEarned, match: {...} }] }`
- Solo predictions de matches con `status=FINISHED`
- Si user no existe o status BANNED → 404
- Cache 60s

**Test integration.**

**Commit:** `feat(backend/users): GET /users/:id/public-profile for leaderboard drilldown`

---

## Task 0.7 — Verificar CORS

**File:** `backend/src/main.ts`

**Acceptance:**
- `app.enableCors({ origin: env.FRONTEND_URL, credentials: true })` ya está presente (Phase 12 backend)
- Validar manual: con `FRONTEND_URL=http://localhost:3000` y backend levantado, curl con `Origin: http://localhost:3000` recibe `Access-Control-Allow-Origin: http://localhost:3000` y `Access-Control-Allow-Credentials: true`

**Verification:**
```bash
cd backend && curl -v -H "Origin: http://localhost:3000" http://localhost:3001/health 2>&1 | grep -E "Access-Control"
# Expected: Access-Control-Allow-Origin: http://localhost:3000
#           Access-Control-Allow-Credentials: true
```

Si falta, ajustar y commitear.

**Commit (si aplica):** `chore(backend): verify/update CORS for frontend dev`

**End of Phase 0 — checkpoint:**
```bash
cd backend && npm test -- --runInBand
# Expected: all tests passing (current 323 + ~6 new from Phase 0)
```

---

# FASE 1 — Foundation

**Goal:** Next.js 15 inicializado, conecta al backend, healthcheck responde.

**Working dir:** `frontend/` (vacía con `.gitkeep`).

## Task 1.1 — Inicializar Next.js 15 con TypeScript

**Files:** todos los iniciales de `npx create-next-app`

```bash
cd /Users/nicolasvelazquez/Desktop/dev/prode
npx create-next-app@latest frontend \
  --typescript --eslint --tailwind --app \
  --src-dir false --import-alias "@/*" --no-turbopack \
  --use-npm
# (responder defaults a lo que pregunte)
```

**Acceptance:**
- `frontend/package.json` existe con next 15+, react 19+
- `npm run dev` levanta en puerto 3000
- `frontend/app/page.tsx` muestra default
- `tailwind.config.ts` y `postcss.config.mjs` presentes (Tailwind 3 default — actualizamos a v4 en Task 1.4)

**Verification:**
```bash
cd frontend && cat package.json | grep '"next"'
# Expected: "next": "^15..."
```

**Commit:** `chore(frontend): init Next.js 15 with TypeScript + ESLint + Tailwind + App Router`

---

## Task 1.2 — Borrar boilerplate y setup base

**Files:** limpiar `app/page.tsx`, `app/globals.css`, borrar `app/favicon.ico` placeholder

**Action:**
- Reemplazar `app/page.tsx` con un hello world placeholder ("Prode Mundial 2026 — Frontend en construcción")
- Borrar styles de boilerplate de globals.css (dejar solo `@tailwind base/components/utilities`)
- Borrar `app/api/` si existe (no usamos route handlers de Next, todo va al backend)
- Eliminar archivos de boilerplate (`app/page.module.css` si existe)

**Acceptance:** `npm run dev` levanta y muestra el hello world.

**Commit:** `chore(frontend): clean Next.js boilerplate, hello world placeholder`

---

## Task 1.3 — Variables de entorno

**Files:** `frontend/.env.example`, `frontend/.env.local`

**`.env.example`:**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_WORLD_CUP_START=2026-06-11T18:00:00-03:00
NEXT_PUBLIC_INSCRIPCION_PRECIO=15000
NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
NEXT_PUBLIC_SENTRY_DSN=
```

**`.env.local`:** copia de `.env.example` con valores reales para dev (igual a example en este caso).

**`frontend/.gitignore`:** agregar `.env.local` (ya viene de Next).

**Verification:** `npm run dev` levanta sin errores aún sin tener todos los env (las que son `NEXT_PUBLIC_` opcionales no rompen).

**Commit:** `chore(frontend): add .env.example and .env.local`

---

## Task 1.4 — Upgrade a Tailwind v4

**Files:** `package.json`, `postcss.config.mjs`, `app/globals.css`, eliminar `tailwind.config.ts`

```bash
cd frontend
npm uninstall tailwindcss postcss autoprefixer
npm install -D tailwindcss@^4 @tailwindcss/postcss@^4
```

**`postcss.config.mjs`:**
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

**`app/globals.css`** (reemplazo total):
```css
@import "tailwindcss";

/* Tokens del DESIGN.md (FIFA WC 2026 Hospitality) */
@theme {
  --color-prode-near-black: #05090e;
  --color-prode-deep-navy: #0c1521;
  --color-prode-accent: #fe1743;
  --color-prode-bg: #ffffff;
  --color-prode-surface: #f9fbff;
  --color-prode-text-secondary: #4b5667;
  --color-prode-text-muted: #bc8fd1;
  --color-prode-border: #d0d5df;

  --font-display: "Fwc 2026 Condensed", "Arial Narrow", sans-serif;
  --font-sans: "Noto Sans", system-ui, sans-serif;

  --radius-sm: 4px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-pill: 9999px;
}

html { font-family: var(--font-sans); color: var(--color-prode-near-black); }
body { background: var(--color-prode-bg); }
```

Eliminar `tailwind.config.ts` (Tailwind v4 es CSS-first, no requiere).

**Acceptance:**
- `npm run dev` levanta sin errores
- Tailwind classes funcionan (`<div className="bg-red-500">` se ve rojo)

**Commit:** `chore(frontend): upgrade to Tailwind v4 with CSS-first config`

---

## Task 1.5 — TypeScript strict + path alias

**File:** `frontend/tsconfig.json`

**Cambios:**
- `"strict": true` (ya viene)
- `"strictNullChecks": true`
- `"noUncheckedIndexedAccess": true`
- `"paths": { "@/*": ["./*"] }` (ya viene)

**Verification:**
```bash
cd frontend && npx tsc --noEmit
# Expected: 0 errors
```

**Commit:** `chore(frontend): tighten TypeScript config (strict + noUncheckedIndexedAccess)`

---

## Task 1.6 — Healthcheck básico

**File:** `frontend/app/api/health/route.ts`

**Note:** este es el ÚNICO route handler que usaremos en el frontend. Sirve para Docker healthcheck.

```typescript
export const runtime = 'nodejs';
export async function GET() {
  // Opcional: verificar que el backend responde
  let backendOk = false;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { cache: 'no-store' });
    backendOk = res.ok;
  } catch {}
  return Response.json({
    status: 'ok',
    backend: backendOk,
    timestamp: new Date().toISOString(),
  });
}
```

**Verification:**
```bash
# en una terminal: cd frontend && npm run dev
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok","backend":true,...}  (asumiendo backend levantado en :3001)
```

**Commit:** `feat(frontend): /api/health endpoint with backend check`

**End of Phase 1 — checkpoint:**
```bash
cd frontend && npm run build && npx next start &
sleep 4 && curl -s localhost:3000/api/health | grep '"status":"ok"'
kill %1
```

---

# FASE 2 — Design system

**Goal:** Tipografía custom + shadcn/ui primitives + tokens completos + componentes base testeados.

## Task 2.1 — Fonts: Noto Sans + Fwc 2026 Condensed

**Files:** `frontend/app/layout.tsx`, `frontend/public/fonts/FWC2026-CondensedBlack.woff2`

**Acceptance:**
- Noto Sans cargada via `next/font/google`
- Fwc 2026 Condensed cargada via `next/font/local` desde `public/fonts/`
- Ambas fonts inyectadas en `<html>` con CSS variables
- `font-display: swap`

**Code (`app/layout.tsx`):**
```typescript
import { Noto_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const notoSans = Noto_Sans({
  subsets: ['latin'],
  variable: '--font-noto-sans',
  weight: ['400', '500', '700'],
  display: 'swap',
});

const fwc = localFont({
  src: '../public/fonts/FWC2026-CondensedBlack.woff2',
  variable: '--font-fwc',
  weight: '900',
  display: 'swap',
});

export const metadata = {
  title: 'Prode Mundial 2026 — Tiro Federal',
  description: 'Pronósticos del Mundial de Fútbol 2026 — Club Tiro Federal de Bahía Blanca',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${notoSans.variable} ${fwc.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

**Update `globals.css`** para usar las font variables de Next:
```css
@theme {
  --font-display: var(--font-fwc), "Arial Narrow", sans-serif;
  --font-sans: var(--font-noto-sans), system-ui, sans-serif;
  /* ... resto ... */
}
```

**Note:** el archivo `.woff2` puede no estar disponible (es proprietario de FIFA). Si no lo tenemos, usar fallback `'Arial Narrow Black', sans-serif` y dejar TODO en el commit message para que el cliente lo aporte. **Para esta task, asumimos que existe en `public/fonts/FWC2026-CondensedBlack.woff2`** o usamos fallback temporal.

**Verification:**
```bash
cd frontend && npm run dev
# Visitar localhost:3000 y verificar en devtools que las fonts cargan
```

**Commit:** `feat(frontend): wire fonts (Noto Sans + Fwc 2026 Condensed)`

---

## Task 2.2 — Instalar utilidades base (cn, deps)

```bash
cd frontend && npm install clsx tailwind-merge class-variance-authority lucide-react
```

**File:** `frontend/lib/utils/cn.ts`
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Test:** `frontend/lib/utils/cn.test.ts` con Vitest (instalado en Task 2.7).

**Commit:** `chore(frontend): add cn util + cva + lucide-react`

---

## Task 2.3 — Setup shadcn/ui (manual, sin CLI)

**Files:** `frontend/components/ui/button.tsx`, `frontend/components/ui/input.tsx`, `frontend/components/ui/label.tsx`

**Action:** copiar los componentes shadcn manualmente (no usamos `npx shadcn add` porque queremos control total del tema).

**`components/ui/button.tsx`:**
```typescript
'use client';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const buttonVariants = cva(
  "inline-flex items-center justify-center font-sans font-medium text-sm transition-colors duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-prode-near-black] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-[--color-prode-near-black] text-white hover:opacity-90",
        ghost: "bg-transparent text-[--color-prode-near-black] hover:bg-[--color-prode-surface]",
        outlined: "bg-white text-[--color-prode-near-black] border-2 border-[--color-prode-border] rounded-2xl hover:border-[--color-prode-near-black]",
        accent: "bg-[--color-prode-accent] text-white hover:opacity-90",
        destructive: "bg-[--color-prode-accent] text-white hover:opacity-90",
      },
      size: {
        default: "h-12 px-8",
        sm: "h-10 px-6",
        lg: "h-14 px-10 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
));
Button.displayName = 'Button';
export { buttonVariants };
```

**`components/ui/input.tsx`:**
```typescript
'use client';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "h-12 w-full bg-transparent text-[--color-prode-near-black] border-b border-[--color-prode-border] py-3 px-0 font-sans text-base transition-colors duration-300 outline-none focus:border-b-2 focus:border-[--color-prode-near-black] disabled:opacity-50 placeholder:text-[--color-prode-text-muted]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
```

**`components/ui/label.tsx`:**
```typescript
import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("font-sans text-xs font-bold uppercase tracking-wider text-[--color-prode-text-secondary]", className)} {...props} />
  )
);
Label.displayName = 'Label';
```

**Verification:** crear página de prueba `/dev/components` (ya existirá `dev/` para mock-checkout) que renderiza varios botones e inputs y verifica visualmente.

**Commit:** `feat(frontend/ui): add Button, Input, Label primitives styled with FIFA WC tokens`

---

## Task 2.4 — Más primitives shadcn: Dialog, Sheet, Tabs, Toast (sonner), DropdownMenu, Combobox

```bash
cd frontend && npm install \
  @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-dropdown-menu \
  @radix-ui/react-label @radix-ui/react-slot \
  cmdk sonner vaul
```

Copiar de la documentación oficial de shadcn (manualmente):
- `components/ui/dialog.tsx`
- `components/ui/sheet.tsx` (usa `vaul` para bottom sheets en mobile)
- `components/ui/tabs.tsx`
- `components/ui/dropdown-menu.tsx`
- `components/ui/toast.tsx` (o usar sonner directamente como `<Toaster />`)
- `components/ui/combobox.tsx` (basado en cmdk)

Customizar cada uno con la paleta FIFA WC y radius (`rounded-md = 16px`).

**Verification:** todos compilan sin errores.

**Commit:** `feat(frontend/ui): add Dialog, Sheet, Tabs, DropdownMenu, Toast, Combobox`

---

## Task 2.5 — Layout components base: PublicHeader, AppHeader, BottomNav, AdminSidebar

**Files:** `frontend/components/layout/public-header.tsx`, `app-header.tsx`, `bottom-nav.tsx`, `admin-sidebar.tsx`

Todos como esqueletos client components con la estructura definida en spec §2 y §6.11. La lógica de auth queda hardcoded por ahora (Phase 3 la conecta).

**Acceptance:**
- Cada componente compila y renderiza
- Mobile responsive correcto

**Commit:** `feat(frontend/layout): add header + bottom-nav + admin-sidebar skeletons`

---

## Task 2.6 — Domain components base: TeamFlag, ScoreDisplay, CountdownTimer

**Files:** `frontend/components/domain/team-flag.tsx`, `score-display.tsx`, `countdown-timer.tsx`

**TeamFlag:**
```typescript
'use client';
import Image from 'next/image';

export function TeamFlag({ fifaCode, size = 32, className }: { fifaCode: string; size?: number; className?: string }) {
  const iso = fifaCode.toLowerCase().slice(0, 2);
  return (
    <Image
      src={`https://flagcdn.com/${iso}.svg`}
      alt={`Bandera ${fifaCode}`}
      width={size}
      height={size}
      className={className}
      unoptimized
    />
  );
}
```

**CountdownTimer:** SSR-safe (placeholder "—:—:—:—" en server, real value cuando hidrata). Usa hook `useCountdown(targetIso)`.

**ScoreDisplay:** muestra score finalizado en monospace condensed.

**Commit:** `feat(frontend/domain): add TeamFlag, ScoreDisplay, CountdownTimer`

---

## Task 2.7 — Setup Vitest + RTL

```bash
cd frontend && npm install -D \
  vitest @vitest/ui jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @vitejs/plugin-react
```

**Files:** `frontend/vitest.config.ts`, `frontend/test/setup.ts`

**`vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    css: true,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './') } },
});
```

**`test/setup.ts`:**
```typescript
import '@testing-library/jest-dom/vitest';
```

**`package.json` scripts:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

**Verification:** un test trivial:
```typescript
// frontend/lib/utils/cn.test.ts
import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges classnames', () => {
    expect(cn('a', 'b')).toBe('a b');
    expect(cn('p-4', 'p-8')).toBe('p-8'); // tailwind-merge
  });
});
```

```bash
cd frontend && npm test
# Expected: 1 passing
```

**Commit:** `chore(frontend): setup Vitest + RTL`

**End of Phase 2.** Commit: `feat(frontend): phase 2 — design system ready`

---

# FASE 3 — Auth + Layouts

**Goal:** sistema de auth completo (tokenStore, refresh, AuthProvider), 3 layouts (public/app/admin) con guards.

## Task 3.1 — Instalar deps de auth + state

```bash
cd frontend && npm install \
  @tanstack/react-query @tanstack/react-query-devtools \
  ky \
  client-only \
  zod \
  react-hook-form @hookform/resolvers \
  date-fns date-fns-tz \
  framer-motion \
  next-themes
```

**Commit:** `chore(frontend): add TanStack Query + ky + RHF + Zod + framer-motion`

---

## Task 3.2 — tokenStore + refresh-interceptor (singleton)

**Files:** `frontend/lib/auth/token-store.ts`, `frontend/lib/auth/refresh-interceptor.ts`

**`token-store.ts`:** código del spec §5.1 (con `import "client-only"`).

**`refresh-interceptor.ts`:** código del spec §5.2 (singleton dedupe).

**Test:** unit test del singleton: 3 llamadas concurrentes → 1 sola promesa pendiente.

**Commit:** `feat(frontend/auth): tokenStore + singleton refresh interceptor`

---

## Task 3.3 — API client (ky con interceptors)

**File:** `frontend/lib/api/client.ts`

Código del spec §5.3 (con `X-Retried` guard).

**Test:** mock fetch con MSW, simular 401 → refresh → retry. Si refresh falla, redirect.

**Commit:** `feat(frontend/api): ky client with refresh-on-401 interceptor`

---

## Task 3.4 — API modules: auth, predictions, matches, leaderboard, leagues, payments, admin, stats

**Files:** `frontend/lib/api/{auth,predictions,matches,leaderboard,leagues,payments,admin,stats}.ts`

Cada uno expone funciones tipadas que llaman al backend via `api` client.

Ejemplo `auth.ts`:
```typescript
import { api } from './client';
import { tokenStore } from '../auth/token-store';

export interface User { id: string; dni: string; firstName: string; /* ... */ }

export async function login(dto: { dni: string; password: string }): Promise<{ accessToken: string; user: User }> {
  const data = await api.post('auth/login', { json: dto }).json<{ accessToken: string; user: User }>();
  tokenStore.set(data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  try { await api.post('auth/logout'); } catch {}
  tokenStore.clear();
}

export async function getMe(): Promise<User> {
  return api.get('auth/me').json<User>();
}

export async function completeRegistration(dto: { token: string; dni: string; firstName: string; lastName: string; whatsapp: string; password: string }): Promise<{ accessToken: string; user: User }> {
  const data = await api.post('auth/complete-registration', { json: dto }).json<{ accessToken: string; user: User }>();
  tokenStore.set(data.accessToken);
  return data;
}

// ... forgotPassword, resetPassword, changePassword, refresh
```

Repetir para los demás módulos (predictions, matches, etc.).

**Test:** integration con MSW mockeando el backend.

**Commit:** `feat(frontend/api): typed modules for all backend endpoints`

---

## Task 3.5 — Query provider + queryKeys

**Files:** `frontend/providers/query-provider.tsx`, `frontend/lib/api/queryKeys.ts`

Código del spec §8.1 y §8.3.

**Commit:** `feat(frontend/providers): TanStack Query provider + query key registry`

---

## Task 3.6 — AuthProvider + useAuth hook

**Files:** `frontend/providers/auth-provider.tsx`, `frontend/lib/hooks/use-auth.ts`

`AuthProvider` (client component):
1. En mount, lee cookie `has_session` (via `document.cookie`).
2. Si presente: llama `refreshAccessToken()` + `getMe()`. Si éxito → setea user. Si falla → user null.
3. Si ausente: user null directamente (no pega al backend).
4. Provee `{ user, isLoading, login, logout, refresh }` via Context.

**Test:** unit con MSW.

**Commit:** `feat(frontend/auth): AuthProvider + useAuth hook with has_session cookie hint`

---

## Task 3.7 — Root layout: providers + Toaster + theme

**File:** `frontend/app/layout.tsx`

Wrap children con QueryProvider + AuthProvider + ThemeProvider (next-themes) + `<Toaster />` (sonner).

**Commit:** `feat(frontend): root layout with all providers`

---

## Task 3.8 — Layouts (public) / (app) / (admin) con guards

**Files:**
- `frontend/app/(public)/layout.tsx`: header simple + footer
- `frontend/app/(app)/layout.tsx`: client guard (si !user → redirect /login), AppHeader + BottomNav mobile
- `frontend/app/(admin)/layout.tsx`: client guard (si !user || role !== ADMIN → redirect /), AdminSidebar + header

Usar `useAuth()` para guards. Mientras `isLoading`: skeleton de la layout.

**Commit:** `feat(frontend): three route group layouts with auth guards`

**End of Phase 3.** Commit: `feat(frontend): phase 3 — auth + layouts complete`

---

# FASE 4 — Pages públicas

**Goal:** landing, login, completar-registro, forgot/reset password, mock-checkout dev.

## Task 4.1 — Landing page

**Files:** `frontend/app/(public)/page.tsx`, `frontend/components/domain/cta-card.tsx`, `frontend/components/domain/how-it-works.tsx`, etc.

Implementar wireframe del spec §6.1:
- Hero con countdown
- Stats live bar (`useQuery` `/stats/public` polling 30s)
- CTAs Pagar/WhatsApp
- Cards "cómo funciona" con horizontal scroll mobile
- Premios
- Footer

**Test E2E** se cubre en Phase 9.

**Commit:** `feat(frontend/public): landing page with countdown + live stats + CTAs`

---

## Task 4.2 — Login page

**File:** `frontend/app/(public)/login/page.tsx`

Form con DNI + password. RHF + Zod schema. Submit → `login()` → redirect `/predicciones` (si role USER) o `/admin` (si role ADMIN).

**Commit:** `feat(frontend/public): login page`

---

## Task 4.3 — Completar registro page

**File:** `frontend/app/(public)/completar-registro/page.tsx`

Lee `?token=xxx` del query param. Llama `getPaymentByToken(token)` para validar. Si OK, muestra form (3 steps mobile / single page desktop). Submit → `completeRegistration()` → redirect `/predicciones`.

**Commit:** `feat(frontend/public): completar-registro page with token validation`

---

## Task 4.4 — Forgot password + Reset password

**Files:** `frontend/app/(public)/forgot-password/page.tsx`, `frontend/app/(public)/reset-password/page.tsx`

Forms simples. Reset lee token del query param.

**Commit:** `feat(frontend/public): forgot-password + reset-password pages`

---

## Task 4.5 — Inscripción success/failure/pending

**Files:** `frontend/app/(public)/inscripcion/{success,failure,pending}/page.tsx`

Pantallas estáticas estilizadas. `success` lee `?token=xxx` y redirige automáticamente a `/completar-registro?token=xxx` después de 1s con un mensaje "Pago confirmado, te llevamos a completar tu registro...".

**Commit:** `feat(frontend/public): inscripcion success/failure/pending pages`

---

## Task 4.6 — Mock checkout (dev only)

**File:** `frontend/app/dev/mock-checkout/page.tsx`

Spec §9.2. Gated con `notFound()` si `NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT !== 'true'`.

UI con tres botones: APROBAR (verde), RECHAZAR (rojo), PENDING (gris). Click llama `POST /dev/simulate-webhook` con el status correspondiente.

**Commit:** `feat(frontend/dev): mock-checkout page (gated by env)`

---

## Task 4.7 — Reglamento page

**File:** `frontend/app/(public)/reglamento/page.tsx`

Página estática con el reglamento del Prode (texto markdown renderizado).

**Commit:** `feat(frontend/public): reglamento page`

**End of Phase 4.** Commit: `feat(frontend): phase 4 — public pages complete`

---

# FASE 5 — App pages: Predicciones

**Goal:** flujo completo de carga de predicciones (matches + especiales).

## Task 5.1 — PredictionInput + NumberPadSheet components

**Files:** `frontend/components/domain/prediction-input.tsx`, `frontend/components/domain/number-pad-sheet.tsx`

Spec §6.5. PredictionInput = button mobile + input desktop. NumberPadSheet usa shadcn `<Sheet>` (vaul).

**Tests unit/component** con RTL.

**Commit:** `feat(frontend/domain): PredictionInput + NumberPadSheet`

---

## Task 5.2 — MatchCard component (5 estados)

**File:** `frontend/components/domain/match-card.tsx`

Spec §6.4. Renderiza el card con los 5 estados visuales.

**Commit:** `feat(frontend/domain): MatchCard with 5 visual states`

---

## Task 5.3 — PhaseTabs component

**File:** `frontend/components/domain/phase-tabs.tsx`

Tabs scrollable horizontal (mobile) / fit (desktop) para Próx/Grupos/16avos/Oct/Cuart/Semis/Final.

**Commit:** `feat(frontend/domain): PhaseTabs component`

---

## Task 5.4 — /predicciones page

**File:** `frontend/app/(app)/predicciones/page.tsx`

Spec §6.4. Lista de matches agrupada por día/fase con MatchCard. Auto-save de prediction con `useMutation` + optimistic update.

**Commit:** `feat(frontend/app): /predicciones page with phase tabs and match list`

---

## Task 5.5 — /predicciones/[matchId] page

**File:** `frontend/app/(app)/predicciones/[matchId]/page.tsx`

Spec §6.6. Detalle de un partido con tu predicción + stats + (si finalizado) puntos con desglose.

**Commit:** `feat(frontend/app): /predicciones/[matchId] detail page`

---

## Task 5.6 — /especiales page

**File:** `frontend/app/(app)/especiales/page.tsx`

Spec §6.7. Form con TeamSelectModal + Combobox goleador + total goles. Bloqueado si `lockedAt !== null`.

**Component:** `frontend/components/domain/team-select-modal.tsx` (modal full-screen mobile / dialog desktop con grid de banderas + search).

**Commit:** `feat(frontend/app): /especiales page with TeamSelect + topScorer combobox`

**End of Phase 5.**

---

# FASE 6 — App: Leaderboard + Ligas + Perfil

**Goal:** tabla de posiciones, mini-ligas, perfil del usuario.

## Task 6.1 — LeaderboardTable + LeaderboardRow components

**Files:** `frontend/components/domain/leaderboard-table.tsx`, `frontend/components/domain/leaderboard-row.tsx`

Spec §6.8. Highlight de "VOS" sticky.

**Commit:** `feat(frontend/domain): LeaderboardTable + LeaderboardRow`

---

## Task 6.2 — /leaderboard page (3 tabs)

**File:** `frontend/app/(app)/leaderboard/page.tsx`

Tabs Global / Por Fase / Mis Ligas. Polling 30s. Hero "Mi posición". Click en row → drawer con perfil público.

**Commit:** `feat(frontend/app): /leaderboard page with global/phase/league tabs`

---

## Task 6.3 — /leaderboard/liga/[leagueId] page

**File:** `frontend/app/(app)/leaderboard/liga/[leagueId]/page.tsx`

Tabla filtrada a miembros de la liga.

**Commit:** `feat(frontend/app): /leaderboard/liga/[id] page`

---

## Task 6.4 — /ligas pages (lista + crear + unirme)

**Files:** `frontend/app/(app)/ligas/page.tsx`, `frontend/app/(app)/ligas/crear/page.tsx`, `frontend/app/(app)/ligas/unirme/page.tsx`

Spec §6.9. Crear → modal con código compartible. Unirme → input OTP de 6 chars.

**Commit:** `feat(frontend/app): /ligas pages (list + create + join)`

---

## Task 6.5 — /perfil page

**File:** `frontend/app/(app)/perfil/page.tsx`

Spec §6.10. Datos read-only/editable. Cambiar password. Toggle WhatsApp opt-in. IosInstallHint. Logout.

**Component:** `frontend/components/domain/ios-install-hint.tsx`.

**Commit:** `feat(frontend/app): /perfil page + IosInstallHint`

---

## Task 6.6 — PointsCelebration component (Framer Motion)

**File:** `frontend/components/domain/points-celebration.tsx`

Animación celebratoria cuando una prediction recién evaluada acertó. Usado en MatchCard cuando `pointsEarned > 0` y `evaluatedAt > N segundos atrás`.

```typescript
'use client';
import { motion } from 'framer-motion';

export function PointsCelebration({ points }: { points: number }) {
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: [0.95, 1.05, 1], opacity: 1 }}
      transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
      className="font-display text-3xl text-[--color-prode-accent]"
    >
      +{points} pts
    </motion.div>
  );
}
```

**Commit:** `feat(frontend/domain): PointsCelebration animation`

**End of Phase 6.**

---

# FASE 7 — Admin panel

**Goal:** panel admin completo con dashboard + gestión.

## Task 7.1 — Admin dashboard

**File:** `frontend/app/(admin)/admin/page.tsx`

Métricas: total usuarios, recaudación, predictions cargadas, próximo partido. Stat cards con números display 48px. Sparklines opcionales (recharts).

```bash
cd frontend && npm install recharts
```

**Commit:** `feat(frontend/admin): dashboard with metrics`

---

## Task 7.2 — /admin/usuarios (lista + crear manual)

**Files:** `frontend/app/(admin)/admin/usuarios/page.tsx`, `frontend/app/(admin)/admin/usuarios/nuevo/page.tsx`

Tabla con `@tanstack/react-table` + filtros. Crear manual = form + modal con password generada (spec §6.11).

```bash
cd frontend && npm install @tanstack/react-table
```

**Commit:** `feat(frontend/admin): usuarios list + manual create with password modal`

---

## Task 7.3 — /admin/pagos

**File:** `frontend/app/(admin)/admin/pagos/page.tsx`

Tabla de pagos con filtros (status, method, fecha). Detail drawer con `mpRawData` JSON formateado.

**Commit:** `feat(frontend/admin): pagos list with details drawer`

---

## Task 7.4 — /admin/partidos (lista + detail)

**Files:** `frontend/app/(admin)/admin/partidos/page.tsx`, `frontend/app/(admin)/admin/partidos/[id]/page.tsx`

Lista con tabs por fase. Detail con form para asignar teams + cargar resultado (modal con PredictionInputs gigantes + confirmación doble).

**Commit:** `feat(frontend/admin): partidos list + detail with score loading`

---

## Task 7.5 — /admin/fases

**File:** `frontend/app/(admin)/admin/fases/page.tsx`

Vista por fase con count de matches finalizados/totales. Botón "Cerrar fase" habilitado si todos FINISHED.

**Commit:** `feat(frontend/admin): fases page with close-phase action`

---

## Task 7.6 — /admin/notificaciones + /admin/auditoria

**Files:** `frontend/app/(admin)/admin/notificaciones/page.tsx`, `frontend/app/(admin)/admin/auditoria/page.tsx`

Notificaciones: tabs Mensajes/Broadcast/Plantillas/Historial. Broadcast manual.
Auditoría: tabla con filtros, expandable rows mostrando `changes: { before, after }` JSON.

**Commit:** `feat(frontend/admin): notificaciones + auditoria pages`

---

## Task 7.7 — /admin/configuracion

**File:** `frontend/app/(admin)/admin/configuracion/page.tsx`

Editor de ScoringRule, PhaseMultiplier, SpecialPrizeRule, AppConfig (precio, fechas, distribución pozo). Cambios auditados.

**Commit:** `feat(frontend/admin): configuracion page (scoring rules + app config)`

---

## Task 7.8 — Admin: stats + export reports

**File:** `frontend/app/(admin)/admin/page.tsx` extra cards o sub-page

Botón "Exportar pagos a CSV", "Exportar tabla final PDF" — los endpoints backend pueden no existir aún, marcar como TODO si no existen y sino implementar el download.

**Commit:** `feat(frontend/admin): export stubs (CSV/PDF when backend supports)`

**End of Phase 7.**

---

# FASE 8 — PWA + perf hardening

**Goal:** PWA con Serwist, manifest, optimizaciones, Sentry.

## Task 8.1 — Setup Serwist

```bash
cd frontend && npm install @serwist/next serwist
```

Spec §11.2. Crear `app/sw.ts` y configurar `next.config.ts`.

**Commit:** `feat(frontend/pwa): setup Serwist for service worker`

---

## Task 8.2 — Manifest + iOS meta tags

**Files:** `frontend/public/manifest.json`, `frontend/app/layout.tsx` (metadata + meta tags iOS), `frontend/public/icon-{192,512,512-maskable}.png`, `frontend/public/apple-touch-icon.png`

Spec §11.3. Generar iconos (puede usar template + script o herramienta online).

**Commit:** `feat(frontend/pwa): manifest + iOS meta tags + icons`

---

## Task 8.3 — Performance optimizations

**Files:** `frontend/next.config.ts`, lazy loads en componentes pesados

Spec §11.4. `next.config.ts` con `output: 'standalone'`, `optimizePackageImports`, `images.remotePatterns`. Lazy load TeamSelectModal, NumberPadSheet via `next/dynamic` desde client wrappers.

**Commit:** `feat(frontend/perf): next config + lazy loads`

---

## Task 8.4 — Sentry init

```bash
cd frontend && npx @sentry/wizard@latest -i nextjs
```

(O manual: `npm install @sentry/nextjs` + setup files).

**Commit:** `feat(frontend/observability): Sentry setup for prod errors`

---

## Task 8.5 — Headers de seguridad

**File:** `frontend/next.config.ts`

Agregar `headers()` en config con CSP, X-Frame-Options, Referrer-Policy.

**Commit:** `feat(frontend/security): security headers via next.config`

**End of Phase 8.**

---

# FASE 9 — E2E test suite

**Goal:** 5 flujos críticos cubiertos con Playwright contra backend local.

## Task 9.1 — Setup Playwright

```bash
cd frontend && npm init playwright@latest -- --browser=chromium --no-install
npx playwright install chromium
```

**File:** `frontend/playwright.config.ts`

Configurar baseURL `http://localhost:3000`, timeouts, screenshots on failure.

**Commit:** `chore(frontend/e2e): setup Playwright`

---

## Task 9.2 — E2E flujo 1: registro público

**File:** `frontend/tests/e2e/01-public-registration.spec.ts`

Spec §10.1. Init payment → mock-checkout → APROBAR → completar registro → predicciones.

**Commit:** `test(frontend/e2e): public registration flow`

---

## Task 9.3 — E2E flujo 2: load prediction

**File:** `frontend/tests/e2e/02-load-prediction.spec.ts`

Login user del seed-dev → /predicciones → tap card → number pad → guardar → verifica state.

**Pre-requisito:** seed-dev-users debe correr en backend antes del test (se puede meter en `globalSetup` de Playwright).

**Commit:** `test(frontend/e2e): load prediction flow`

---

## Task 9.4 — E2E flujo 3: admin finish match

**File:** `frontend/tests/e2e/03-admin-finish-match.spec.ts`

Login admin → /admin/partidos/:id → cargar resultado → confirmar → verifica leaderboard refresh.

**Commit:** `test(frontend/e2e): admin finish match flow`

---

## Task 9.5 — E2E flujos 4 + 5: leaderboard updates + create league

**Files:** `frontend/tests/e2e/04-leaderboard-updates.spec.ts`, `frontend/tests/e2e/05-create-and-join-league.spec.ts`

**Commit:** `test(frontend/e2e): leaderboard updates + league creation flows`

**End of Phase 9.**

---

# FASE 10 — Deployment

**Goal:** containerizar, deploy a staging via Dokploy.

## Task 10.1 — Dockerfile multi-stage

**File:** `frontend/Dockerfile`

Spec §12.1.

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_PUBLIC_API_URL=http://placeholder
RUN npm run build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Argentina/Buenos_Aires
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1))"
CMD ["node", "server.js"]
```

**Acceptance:**
- `docker build -t prode-frontend frontend/` builds OK
- `docker run --rm -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://host.docker.internal:3001 prode-frontend` levanta
- `curl localhost:3000/api/health` responde

**Commit:** `feat(frontend): production Dockerfile`

---

## Task 10.2 — .dockerignore

**File:** `frontend/.dockerignore`

```
node_modules
.next
out
.env
.env.local
.env.*
!.env.example
.git
.gitignore
README.md
tests
playwright-report
test-results
*.log
```

**Commit:** `chore(frontend): add .dockerignore`

---

## Task 10.3 — Update Dokploy compose

**File:** `dokploy/docker-compose.yml` (ya existe del backend Phase 14)

Agregar el service `prode-frontend` (spec §12.2).

**Commit:** `chore(deploy): add prode-frontend to Dokploy compose`

---

## Task 10.4 — Documentación deploy frontend

**File:** `docs/deployment.md` (ya existe del backend; agregar sección frontend)

Pasos para configurar dominio `prode.tirofederal.com`, env vars del panel Dokploy, primer deploy, smoke test.

**Verification (manual, post-deploy):**
```bash
curl -s https://prode.tirofederal.com/api/health
# Expected: {"status":"ok","backend":true,...}
```

**Commit:** `docs(deploy): add frontend deployment notes`

**End of Phase 10.**

---

# Integration Tests (post-implementación)

```bash
cd frontend && npm test                  # vitest unit/component
cd frontend && npx playwright test       # E2E (requires backend running)
```

# Manual Verification (post-deploy)

1. Visitar `https://prode.tirofederal.com` → ver landing con countdown live
2. Click "Pagar con MercadoPago" → flujo MP real (pago de prueba con TC test) → completar registro → login
3. Cargar predicción de un match → admin marca FINISHED → verificar puntos en leaderboard
4. Admin crea usuario manual → user logea con password generada → carga predicción
5. Crear mini-liga → unirse desde otro user → verifica ranking de la liga

# Rollback Plan

Si algo crítico se rompe en frontend producción:

```bash
cd /Users/nicolasvelazquez/Desktop/dev/prode
git log --oneline -5         # identificar commit a revertir
git revert <hash>            # crea commit reverso
git push origin main         # Dokploy redeploy automático del frontend
```

Para fallar gracefully:
- Si frontend cae, usuarios siguen pudiendo loggear vía `/login` (página chica, alta probabilidad de funcionar)
- Si backend cae, frontend muestra error message + retry button
- Sentry alerta admin via WhatsApp (backend AdminAlertsService)

# Notas finales

- **Phase 0 es bloqueante.** Sin esos 7 cambios al backend, frontend no funciona end-to-end.
- **Coordinación frontend ↔ backend:** desde Phase 4 en adelante, cualquier endpoint nuevo del backend debe agregarse a `frontend/lib/api/`. Si un endpoint cambia signature, ambos lados se actualizan.
- **Mobile-first siempre:** desarrollar viewing mobile (Chrome DevTools 375px) primero. Ajustar a desktop después.
- **Touch targets ≥44px** en todos los flujos user-facing. Size sm de Button SOLO en admin desktop.
- **Local sin MercadoPago:** flujo completo via mock-checkout + simulate-webhook. NO probar el flujo MP real hasta deploy en staging con credenciales TEST.
- **Cuando llegue el momento de probar MP real (post Phase 10):** crear cuenta MP de testing, configurar webhook URL `https://api.prode.tirofederal.com/payments/webhook` en panel MP, hacer pago de prueba con tarjeta de test (4509 9535 6623 3704, CVV 123, exp 11/25, titular APRO).
