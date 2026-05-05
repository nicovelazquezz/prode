# Prode Mundial 2026 — Design Doc del Frontend

**Fecha:** 2026-05-05
**Estado:** Aprobado por el cliente, listo para fase de plan de implementación
**Autor:** Brainstorming colaborativo entre cliente y asistente
**Spec del backend (referencia):** `docs/superpowers/specs/2026-05-04-prode-backend-design.md`
**Sistema de diseño (referencia):** `DESIGN.MD` — FIFA World Cup 2026 Hospitality

---

## 1. Contexto y objetivos

Frontend mobile-first del Prode Mundial 2026 para el Club Tiro Federal. Conecta al backend NestJS ya construido y deployable. El sistema visual está completamente definido en `DESIGN.MD` (FIFA WC 2026 Hospitality system). El frontend implementa ese sistema de diseño bajo Next.js 15 App Router.

**Volumen esperado:** menos de 200 usuarios concurrentes durante 39 días (11/jun a 19/jul/2026).

**Idioma:** español (Argentina), todas las UI strings en es-AR.

**Dispositivo primario:** mobile (≥75% del tráfico esperado, según patrón de Prodes argentinos similares). Desktop como soporte secundario para el panel admin.

**Lanzamiento:** completo desde el día 1, sin recortes de features. Test local sin MercadoPago primero, después producción.

## 2. Stack técnico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js (App Router, React 19) | 15+ |
| Lenguaje | TypeScript | 5.7+ |
| Estilos | Tailwind v4 (CSS-first config) | 4+ |
| Componentes base | shadcn/ui (copiados al repo) | latest |
| Iconos | Lucide React | latest |
| Tipografía display | Fwc 2026 Condensed (self-hosted .woff2) | — |
| Tipografía body | Noto Sans (Google Fonts) | — |
| State server | TanStack Query | 5+ |
| State server devtools | TanStack Query Devtools | 5+ |
| Forms | React Hook Form + Zod | 7+ / 3+ |
| HTTP client | ky | 1+ |
| Notificaciones | sonner (toasts) | 1+ |
| Animación | Framer Motion (uso restringido a celebraciones) | 11+ |
| Fechas | date-fns + date-fns-tz | 4+ / 3+ |
| Tema | next-themes (preparado para futuro dark mode) | 0+ |
| Variantes | class-variance-authority + clsx + tailwind-merge | — |
| Testing unit | Vitest + React Testing Library | 2+ / 16+ |
| Testing E2E | Playwright | 1+ |
| Mocking | MSW | 2+ |
| Observabilidad | Sentry | latest |

**Justificación de elecciones notables:**
- **`ky` en vez de axios**: 4KB, fetch nativo, hooks de retry/auth simples. Encaja con TanStack Query.
- **Vitest + RTL en vez de Jest**: más rápido, ESM nativo, tooling moderno.
- **Framer Motion solo para celebración**: el resto de animaciones son CSS puro 300ms ease-out (DESIGN.md así lo indica).
- **shadcn/ui copiado al repo (no instalado como package)**: control total del tema, customizable a la paleta FIFA WC 2026.

## 3. Arquitectura

### 3.1 Capas

```
┌────────────────────────────────────────────────┐
│  App Router (route handlers + RSC where useful)│
│  Server: solo SEO meta + initial data fetch    │
└─────────────────┬──────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────┐
│  Client Components                              │
│  Forms, interactividad, queries, mutations     │
└─────────────────┬──────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────┐
│  TanStack Query (server state)                  │
│  Cache, optimistic updates, invalidación       │
└─────────────────┬──────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────┐
│  lib/api/* (ky client + module functions)       │
│  Auth interceptor, refresh-on-401              │
└─────────────────┬──────────────────────────────┘
                  │
┌─────────────────▼──────────────────────────────┐
│  Backend NestJS (api.prode.tirofederal.com)    │
└────────────────────────────────────────────────┘
```

**Decisiones deliberadas:**
- **Mayoría client components.** RSC solo en páginas estáticas (landing, reglamento) donde aporta SEO. La app autenticada y el admin son interactivos, no se beneficia mucho de SSR.
- **No Server Actions.** Toda mutación va via `useMutation` → `ky` → REST endpoint. Más mantenible, idéntico a producción.
- **Sin estado global de cliente complejo.** Lo único "global" es el access token (variable de módulo) y el theme (next-themes). Server state vive en TanStack Query, form state en React Hook Form, UI state local en `useState`.

### 3.2 Estructura de carpetas

```
frontend/
├── app/
│   ├── (public)/                       # layout simple sin auth
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # landing con countdown
│   │   ├── login/page.tsx
│   │   ├── completar-registro/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   ├── inscripcion/
│   │   │   ├── success/page.tsx
│   │   │   ├── failure/page.tsx
│   │   │   └── pending/page.tsx
│   │   └── reglamento/page.tsx
│   ├── (app)/                          # JWT guard + bottom nav mobile
│   │   ├── layout.tsx
│   │   ├── predicciones/
│   │   │   ├── page.tsx                # tabs por fase
│   │   │   └── [matchId]/page.tsx      # detalle del partido
│   │   ├── especiales/page.tsx
│   │   ├── leaderboard/
│   │   │   ├── page.tsx                # tabs global/fase/liga
│   │   │   └── liga/[leagueId]/page.tsx
│   │   ├── ligas/
│   │   │   ├── page.tsx
│   │   │   ├── crear/page.tsx
│   │   │   └── unirme/page.tsx
│   │   └── perfil/page.tsx
│   ├── (admin)/                        # RolesGuard ADMIN, sidebar
│   │   └── admin/
│   │       ├── layout.tsx
│   │       ├── page.tsx                # dashboard métricas
│   │       ├── usuarios/page.tsx
│   │       ├── usuarios/nuevo/page.tsx
│   │       ├── pagos/page.tsx
│   │       ├── partidos/page.tsx
│   │       ├── partidos/[id]/page.tsx
│   │       ├── fases/page.tsx
│   │       ├── notificaciones/page.tsx
│   │       ├── auditoria/page.tsx
│   │       └── configuracion/page.tsx
│   ├── dev/
│   │   └── mock-checkout/page.tsx      # solo NODE_ENV !== production
│   ├── layout.tsx                       # Root: providers, fonts, metadata
│   ├── not-found.tsx
│   └── error.tsx
├── components/
│   ├── ui/                              # shadcn primitives copiados
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── dialog.tsx
│   │   ├── sheet.tsx
│   │   ├── tabs.tsx
│   │   ├── toast.tsx
│   │   ├── table.tsx
│   │   ├── combobox.tsx
│   │   ├── dropdown-menu.tsx
│   │   └── ...
│   ├── domain/                          # específicos del Prode
│   │   ├── countdown-timer.tsx
│   │   ├── match-card.tsx
│   │   ├── prediction-input.tsx
│   │   ├── number-pad-sheet.tsx
│   │   ├── leaderboard-row.tsx
│   │   ├── leaderboard-table.tsx
│   │   ├── phase-tabs.tsx
│   │   ├── team-flag.tsx
│   │   ├── team-select-modal.tsx
│   │   ├── score-display.tsx
│   │   ├── points-celebration.tsx
│   │   └── ios-install-hint.tsx
│   └── layout/
│       ├── public-header.tsx
│       ├── app-header.tsx
│       ├── bottom-nav.tsx
│       └── admin-sidebar.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts                    # ky instance + interceptors
│   │   ├── queryKeys.ts
│   │   ├── auth.ts
│   │   ├── predictions.ts
│   │   ├── matches.ts
│   │   ├── leaderboard.ts
│   │   ├── leagues.ts
│   │   ├── payments.ts
│   │   └── admin.ts
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-countdown.ts
│   │   ├── use-mediaquery.ts
│   │   ├── use-pwa-install.ts
│   │   └── use-haptic-feedback.ts
│   ├── auth/
│   │   ├── token-store.ts
│   │   └── refresh-interceptor.ts
│   ├── utils/
│   │   ├── cn.ts
│   │   ├── date.ts
│   │   ├── score.ts
│   │   ├── pwa.ts
│   │   └── format.ts
│   └── schemas/
│       ├── auth.ts
│       ├── prediction.ts
│       ├── special-prediction.ts
│       └── league.ts
├── providers/
│   ├── query-provider.tsx
│   ├── auth-provider.tsx
│   ├── toaster-provider.tsx
│   └── theme-provider.tsx
├── public/
│   ├── fonts/
│   │   └── FWC2026-CondensedBlack.woff2
│   ├── flags/                           # SVGs (fallback flagcdn)
│   ├── manifest.json
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   └── og-image.png
├── tests/
│   ├── e2e/
│   │   ├── 01-public-registration.spec.ts
│   │   ├── 02-load-prediction.spec.ts
│   │   ├── 03-admin-finish-match.spec.ts
│   │   ├── 04-leaderboard-updates.spec.ts
│   │   └── 05-create-and-join-league.spec.ts
│   └── unit/
│       └── ...
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── package.json
├── Dockerfile
├── .env.example
├── .env.local
└── playwright.config.ts
```

## 4. Sistema visual (DESIGN.md → implementación)

### 4.1 Filosofía visual

DESIGN.md define el sistema FIFA WC 2026 Hospitality. Tres principios guían cada decisión:

1. **Typographic authority.** El display ultra-condensed Fwc 2026 a 60-80px es el héroe. Nada compite con la tipografía. El leaderboard, los countdowns, los scores — todo grita en condensed 900.
2. **Flat elevation.** Cero box-shadows. La profundidad viene de capas de color (`#05090e` near-black sobre `#ffffff` sobre `#f9fbff`) y del backdrop oscuro `rgba(5, 9, 14, 0.4)` para modales.
3. **Motion with restraint.** 300ms ease-out en hover/transición/dropdown. La única excepción son las "celebraciones" (acertaste un partido, cerraste una fase ganando un premio) donde Framer Motion hace su entrada con stagger y spring discreto.

### 4.2 Tokens (Tailwind v4 CSS-first config)

`app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Brand colors */
  --color-prode-near-black: #05090e;
  --color-prode-deep-navy: #0c1521;
  --color-prode-accent: #fe1743;
  --color-prode-bg: #ffffff;
  --color-prode-surface: #f9fbff;
  --color-prode-text-secondary: #4b5667;
  --color-prode-text-muted: #bc8fd1;
  --color-prode-border: #d0d5df;
  --color-prode-overlay: rgb(5 9 14 / 0.4);

  /* shadcn token mapping */
  --color-background: #ffffff;
  --color-foreground: #05090e;
  --color-primary: #05090e;
  --color-primary-foreground: #ffffff;
  --color-secondary: #f9fbff;
  --color-secondary-foreground: #05090e;
  --color-accent: #fe1743;
  --color-accent-foreground: #ffffff;
  --color-muted: #f9fbff;
  --color-muted-foreground: #4b5667;
  --color-border: #d0d5df;
  --color-input: #d0d5df;
  --color-ring: #05090e;
  --color-destructive: #fe1743;
  --color-destructive-foreground: #ffffff;

  /* Typography */
  --font-display: "Fwc 2026 Condensed", "Arial Narrow", sans-serif;
  --font-sans: "Noto Sans", system-ui, sans-serif;

  /* Section spacing */
  --spacing-section: 80px;
  --spacing-section-md: 64px;
  --spacing-section-sm: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-pill: 9999px;

  /* Motion */
  --transition-default: 300ms cubic-bezier(0, 0, 0.2, 1);
}

@font-face {
  font-family: 'Fwc 2026 Condensed';
  src: url('/fonts/FWC2026-CondensedBlack.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  font-display: swap;
}
```

### 4.3 Variantes de componentes (CVA)

```typescript
// components/ui/button.tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center font-sans font-medium text-sm transition-colors duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        ghost: "bg-transparent text-foreground hover:bg-secondary",
        outlined: "bg-background text-foreground border-2 border-border rounded-2xl hover:border-primary",
        accent: "bg-accent text-accent-foreground hover:opacity-90",
      },
      size: {
        default: "h-12 px-8",     // 48px touch-friendly
        sm: "h-10 px-6",
        lg: "h-14 px-10 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);
```

### 4.4 Type scale (DESIGN.md)

| Role | Family | Mobile | Desktop | Weight | Color |
|------|--------|--------|---------|--------|-------|
| Display H1 | Fwc Condensed | 64px | 80px | 900 | white sobre dark / near-black sobre light |
| H2 | Fwc Condensed | 48px | 72px | 900 | near-black |
| H3 | Fwc Condensed | 28px | 32px | 900 | near-black |
| H4 / Label | Noto Sans | 14px | 14px | 700 | text-muted-foreground |
| Body | Noto Sans | 16px | 16px | 400 | foreground |
| Body small | Noto Sans | 14px | 14px | 400 | text-secondary |
| UI Label | Noto Sans | 12-14px | 14px | 500 | varies |

Headings con positive letter-spacing (1.5px en 80px, 0.5-1px en 32px) para abrir las formas ultra-condensed.

### 4.5 Touch targets y accesibilidad

Reglas críticas (de ui-ux-pro-max):

- **Touch targets ≥44x44px**: botones default `h-12 px-8` (48px), inputs `h-12`. PredictionInput buttons en number pad `56x56px`.
- **Color contrast ≥4.5:1**: todas las combinaciones de la paleta cumplen WCAG AA. Único cuidado: `#bc8fd1` (text-muted) sobre blanco solo se usa para estados disabled/placeholder.
- **Focus states visibles**: ring `outline-2 outline-offset-2 outline-primary` en todos los interactivos.
- **`prefers-reduced-motion`**: media query que reduce duraciones a 0.01s y desactiva Framer Motion.
- **Inputs con label asociado** (`htmlFor` + `id`).
- **Iconos solo decorativos**: `aria-hidden="true"`. Iconos con función (close, etc.): `aria-label`.

## 5. Auth strategy

### 5.1 Tokens

- **Access token**: JWT firmado por backend, 15 min de vida. Vive **solo en memoria de JS** (variable de módulo en `lib/auth/token-store.ts`). NUNCA persistido a localStorage/sessionStorage.
- **Refresh token**: JWT 7 días, en cookie `httpOnly` + `Secure` + `SameSite=Lax` + `Domain=.tirofederal.com`. Backend lo emite en `/auth/login` y lo rota en `/auth/refresh`.

**Por qué SameSite=Lax (no Strict):** frontend en `prode.tirofederal.com` y backend en `api.prode.tirofederal.com` son subdominios distintos. `SameSite=Strict` no enviaría la cookie en navegaciones cross-subdomain. `Lax` cubre el caso (POST same-site, GET cross-site OK).

### 5.2 Flow

```
1. Mount app (Root layout)
   ↓
2. AuthProvider en root layout intenta POST /auth/refresh (cookie viaja automática)
   ├─ 200: tokenStore.set(accessToken), useAuth().user populated
   └─ 401: user is null
   ↓
3. Cualquier request via ky:
   - beforeRequest: agrega Authorization: Bearer ${tokenStore.get()}
   - afterResponse 401 (excepto /auth/refresh):
     - intenta refresh
     - si éxito: reintenta el request original con nuevo token
     - si refresh falla: clear token + redirect a /login
   ↓
4. Layouts (app)/(admin) tienen guards client-side:
   - (app): si !user → redirect /login
   - (admin): si !user || user.role !== 'ADMIN' → redirect /
```

### 5.3 Implementación

```typescript
// lib/auth/token-store.ts
let accessToken: string | null = null;
export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => { accessToken = t; },
  clear: () => { accessToken = null; },
};

// lib/api/client.ts
import ky from 'ky';
import { tokenStore } from '../auth/token-store';
import { refreshAccessToken } from './auth';

export const api = ky.create({
  prefixUrl: process.env.NEXT_PUBLIC_API_URL,
  credentials: 'include',
  hooks: {
    beforeRequest: [(request) => {
      const token = tokenStore.get();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
    }],
    afterResponse: [
      async (request, options, response) => {
        if (response.status === 401 && !request.url.includes('/auth/refresh')) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            request.headers.set('Authorization', `Bearer ${refreshed}`);
            return ky(request);
          }
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
        return response;
      },
    ],
  },
});
```

## 6. Páginas y UX patterns

### 6.1 Landing pública (`/`)

**Mobile-first wireframe:**

```
[Header: logo + Login] (sticky, h-14, white bg, border-b)

HERO (full bleed dark #0c1521, min-h 100svh)
  ├─ "PRODE MUNDIAL 2026" (display 64px white, en 3 líneas mobile)
  ├─ Imagen split (banderas + camiseta) decorativa
  ├─ "Club Tiro Federal de Bahía Blanca" (Noto Sans 14px tracked uppercase)
  ├─ Stats bar live: "187 inscriptos • Pozo $2.345.000"
  └─ Countdown timer
       ├─ "FALTAN PARA EL KICKOFF" (label 12px tracked)
       └─ Days Hrs Min Sec (display 56px mobile / 72px desktop)

CTA SECTION (white bg)
  ├─ "SUMATE AL PRODE" (display 32px)
  ├─ "$15.000" (display 48px en accent #fe1743)
  ├─ [PAGAR CON MERCADOPAGO →] (primary CTA, h-14, full-width mobile)
  └─ [ESCRIBINOS POR WHATSAPP →] (outlined CTA, abre wa.me/...)

CÓMO FUNCIONA
  ├─ "CÓMO FUNCIONA" (H2 display 48px)
  └─ 3 cards horizontal scroll snap (mobile) / grid (desktop)
       ├─ "01 REGISTRATE" — bg cyan #4bd7e6, número display gigante
       ├─ "02 PREDECÍ LOS 104 PARTIDOS" — bg accent variant
       └─ "03 GANÁ" — bg dark

PREMIOS
  ├─ "PREMIOS" (H2 display 48px)
  └─ Tabla simple: 1° / 2° / 3° / Mejor de cada fase, con montos en display 24px

FOOTER (dark)
  ├─ Reglamento (modal full-screen)
  ├─ Contacto
  └─ Logo del club
```

**Decisiones específicas:**
- Countdown computed client-side, SSR muestra placeholder "—:—:—:—" para evitar hydration mismatch.
- Stats bar polling `GET /stats/public` cada 30s (endpoint público, retorna `{ enrolledUsers, pozoEstimate }`).
- Cards "cómo funciona" con `snap-x snap-mandatory` en mobile, `grid grid-cols-3 gap-6` en desktop.
- Hero background: `#0c1521` con SVG layer geometry sutil (líneas finas blancas 4% opacity).

### 6.2 Login (`/login`)

```
[Back button]

INGRESÁ (display 48px)

DNI
[input border-bottom only, h-14, inputmode="numeric"]

CONTRASEÑA
[input border-bottom only, h-14, eye toggle]

[INGRESAR →] (primary CTA full-width)

Olvidé mi contraseña (ghost link)
```

**Inputs estilo DESIGN.md:** sin background, `border-bottom: 1px solid #d0d5df`, focus → border-bottom 2px `#05090e`.

### 6.3 Completar registro (`/completar-registro`)

Llega vía `?token=plainToken` después del pago (real o mock). Flujo:

1. Frontend llama `GET /payments/by-token/:token` para validar.
   - Si token expirado/usado → muestra error con link al admin.
   - Si OK → muestra form.
2. Form con DNI, nombre, apellido, WhatsApp, password.
   - Mobile: 3 steps (DNI+nombre / WhatsApp / password). Desktop: single page con secciones.
   - WhatsApp con prefijo visual fijo `+54 9` y normalización a `5492914xxxxxxx` antes de enviar.
3. Submit → `POST /auth/complete-registration` → backend devuelve accessToken + user.
4. tokenStore.set(accessToken), redirect a `/predicciones`.

### 6.4 Mis predicciones (`/predicciones`)

**Wireframe mobile:**

```
[App header: "Hola, Juan"  Logout]
[PhaseTabs sticky: Próx | Grupos | 16avos | Oct | Cuart | Semis | F]

Hoy, jueves 11 de junio  (group label tracked uppercase 12px)
─────────────────────

MatchCard (rounded-md, border)
  ├─ Meta: "GRUPO A • 18:00 ART • Hoy" (uppercase 11px tracked)
  ├─ Home row:
  │    ├─ 🇲🇽 32px flag
  │    ├─ "MEXICO" (display 18px)
  │    └─ PredictionInput [ 2 ] (56x56 button, monospace 32px)
  ├─ Away row: idem
  ├─ Footer:
  │    ├─ "⏱ Cierra en 5h 23min" (live countdown)
  │    └─ "✓ Guardado" / "Cargá tu predicción" (state badge)

(repeat per match en orden de kickoff)

[Bottom nav mobile: Predic | Tabla | Ligas | Perfil]
```

**Estados visuales del MatchCard:**
- Sin cargar: `border 1px solid border-color`, badge "PENDIENTE" gris
- Cargado abierto: `border 2px solid foreground`, badge "✓ GUARDADO"
- Locked sin resultado: `opacity-60`, badge "CERRADO" + lock icon, inputs disabled
- Finalizado: muestra resultado real + tu predicción + puntos. Si `pointsEarned > 0` → border accent + animación `<PointsCelebration>` (Framer Motion: scale 0.95 → 1.05 → 1 con stagger en los puntos)

### 6.5 PredictionInput component

No es un `<input type="number">`. Es:

- **Mobile**: botón touch-friendly que abre **bottom sheet** con number pad grande (3x4 grid de buttons 56x56px, 0-9 + clear/confirm). Haptic feedback (`navigator.vibrate(10)`) en cada tap.
- **Desktop**: input nativo con `inputmode="numeric"` y validación 0-99.

Auto-save con `useMutation` + debounce 1s. Optimistic update.

### 6.6 Vista por partido (`/predicciones/[matchId]`)

- Hero compacto: banderas grandes + nombres + sede + fase + kickoff
- Tu predicción (editable si pre-lock)
- Stats: "Ya predijeron N usuarios" (cache 60s)
- Si finalizado: tu resultado vs el real + puntos con desglose ("Acertaste el ganador y la diferencia × multiplicador 1x grupos = 3 pts")
- Stats anecdóticas: "El 38% predijo Argentina, 12% empate, 50% Brasil"

### 6.7 Predicciones especiales (`/especiales`)

Pantalla única, accesible solo si `lockedAt === null` en `GET /predictions/special/me`.

Cards verticales para: Campeón, Subcampeón, Tercer puesto, Goleador, Total goles.

- **TeamSelect**: Modal full-screen mobile con grid 4 cols (banderas + códigos), search arriba. Bloquea selección de teams ya elegidos en otros 3 campos.
- **Combobox goleador**: shadcn `<Combobox>` con `cmdk`, fuzzy search sobre lista de Players. Permite text libre como fallback (`topScorerName`).
- **Confirmación final**: Modal "¿Estás seguro? Estas son tus elecciones..." con resumen.

Banner permanente: "⚠ Una vez confirmadas, no podrás modificarlas después del 11/06" (accent bg).

### 6.8 Leaderboard (`/leaderboard`)

3 tabs: **GLOBAL | POR FASE | MIS LIGAS**.

**Hero arriba (sticky):**
```
POSICIÓN #12 DE 187    (display 80px, accent color en el "12")
152 PTS                (display 32px)
```

**Tabla:**
- Rows con `position` (display 18px) + nombre + puntos (display 18px)
- Top 3: borde sutil dorado/plata/bronce (`border-b-4`)
- Row "VOS": `bg-accent/10`, sticky cuando hace scroll fuera de viewport
- Click en row → drawer/sheet con perfil público (predicciones de partidos finalizados)

**Refresh:**
- TanStack Query `refetchInterval: 30_000`
- Indicador sutil pulse dot top-right cuando refresca
- Pull-to-refresh en mobile (con `framer-motion` drag)

**Por fase:** dropdown selector arriba (GROUPS, ROUND_32, etc.).

**Mis ligas:** card por liga con count miembros, click navega a `/leaderboard/liga/[id]`.

### 6.9 Mini-ligas (`/ligas`, `/ligas/crear`, `/ligas/unirme`)

- **`/ligas`**: lista de ligas del user. Card por liga con name, member count, "Ver tabla" CTA.
- **`/ligas/crear`**: form (name, description opcional, isPublic, maxMembers). Submit → modal con código en display 80px + CTA "Compartir por WhatsApp" (link `wa.me/?text=...`).
- **`/ligas/unirme`**: input de 6 chars estilo OTP (cada char en su propio cuadro), uppercase auto, validate regex `[A-Z0-9]{6}`. Submit → `POST /leagues/join`.

### 6.10 Perfil (`/perfil`)

- Datos read-only: DNI, nombre, apellido
- Editable: WhatsApp (con confirmación)
- Cambiar contraseña
- Toggle WhatsApp opt-in
- `<IosInstallHint>` permanente
- Logout

### 6.11 Admin (resumen)

Layout: sidebar collapsable izquierda con 9 items, header con admin info + logout, breadcrumbs.

**Patrones recurrentes:**
- **Tablas**: shadcn `<Table>` + `@tanstack/react-table` para sort/filter/pagination. Acciones en menú "..." al final del row.
- **Forms admin**: drawer right-side para editar (mobile: full-screen sheet). RHF + Zod.
- **Métricas dashboard**: stat cards con números en display 48px, sparklines pequeñas (recharts).
- **Carga de resultado**: modal con dos PredictionInputs gigantes idénticos a los del usuario, botón "CONFIRMAR Y CALCULAR PUNTOS" rojo accent. Confirmación doble.
- **Cierre de fase**: botón habilitado solo si todos los matches FINISHED. Modal mostrando ganador propuesto + monto del premio + nota.
- **Auditoría**: tabla con filtros (entity, action, userId, date range), expandable row mostrando `changes: { before, after }` JSON formateado.

## 7. Inventario de componentes clave

| Componente | Responsabilidad | Notable |
|------------|-----------------|---------|
| `<CountdownTimer>` | Cuenta regresiva al kickoff | SSR-safe (placeholder), cleanup interval |
| `<MatchCard>` | Card de un partido en lista | 4 estados visuales |
| `<PredictionInput>` | Input numérico touch-friendly | Bottom sheet en mobile, input en desktop |
| `<NumberPadSheet>` | Number pad grande para mobile | Haptic feedback |
| `<LeaderboardTable>` | Tabla con highlight de "vos" | Sticky row, scroll into view |
| `<PhaseTabs>` | Navegación entre fases | Sticky bajo header, scroll-x mobile |
| `<TeamFlag>` | Bandera + código FIFA | Fallback flagcdn si SVG falta |
| `<TeamSelectModal>` | Grid de banderas + search | Bloquea ya-seleccionados |
| `<ScoreDisplay>` | Display de score finalizado | Animación on-mount si recién evaluado |
| `<PointsCelebration>` | Animación cuando acertás | Framer Motion stagger + spring |
| `<IosInstallHint>` | Tooltip "Agregar a inicio" iOS | Detecta `isIOS && !isStandalone` |
| `<PublicHeader>` / `<AppHeader>` / `<AdminSidebar>` | Layouts de cada zona | Sticky, mobile drawer |
| `<BottomNav>` | Nav mobile bottom (app) | 4 items con icons Lucide + labels |

## 8. Data flow & state management

### 8.1 Defaults TanStack Query

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (error?.status === 401 || error?.status === 404) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      onError: (err) => toast.error(err?.message ?? 'Algo salió mal'),
    },
  },
});
```

### 8.2 staleTime por recurso

| Recurso | staleTime | Justificación |
|---------|-----------|---------------|
| `/leaderboard/global` | 30s | Cambia post-cada-resultado |
| `/leaderboard/me/around` | 30s | Idem |
| `/leagues/:id/leaderboard` | 30s | Idem |
| `/predictions/me` | 5 min | Cambia solo cuando user edita |
| `/matches` | 10 min | Casi estáticos |
| `/matches/upcoming` | 60s | Refresca para nuevos kickoffs |
| `/auth/me` | 30 min | Cambia rara vez |
| `/predictions/me/match/:id` | 5 min | Igual que /me |

### 8.3 Query keys convention

```typescript
export const queryKeys = {
  auth: { me: () => ['auth', 'me'] as const },
  matches: {
    all: () => ['matches'] as const,
    list: (filters?: MatchFilters) => ['matches', filters] as const,
    upcoming: () => ['matches', 'upcoming'] as const,
    byPhase: (phase: Phase) => ['matches', 'phase', phase] as const,
    detail: (id: string) => ['matches', id] as const,
  },
  predictions: {
    me: () => ['predictions', 'me'] as const,
    forMatch: (matchId: string) => ['predictions', 'me', 'match', matchId] as const,
    special: () => ['predictions', 'special', 'me'] as const,
  },
  leaderboard: {
    global: (page: number) => ['leaderboard', 'global', page] as const,
    phase: (phase: Phase, page: number) => ['leaderboard', 'phase', phase, page] as const,
    around: () => ['leaderboard', 'me', 'around'] as const,
    league: (id: string, page: number) => ['leaderboard', 'league', id, page] as const,
  },
  leagues: {
    me: () => ['leagues', 'me'] as const,
    detail: (id: string) => ['leagues', id] as const,
  },
  admin: {
    users: { list: (filters: any) => ['admin', 'users', filters] as const, detail: (id: string) => ['admin', 'users', id] as const },
    payments: { list: (filters: any) => ['admin', 'payments', filters] as const },
    matches: { detail: (id: string) => ['admin', 'matches', id] as const },
    metrics: () => ['admin', 'metrics'] as const,
    audit: (filters: any) => ['admin', 'audit', filters] as const,
  },
};
```

### 8.4 Optimistic update — predicción

```typescript
const upsertPrediction = useMutation({
  mutationFn: (vars: { matchId: string; scoreHome: number; scoreAway: number }) =>
    api.post(`predictions/match/${vars.matchId}`, { json: vars }).json(),
  onMutate: async (vars) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.predictions.forMatch(vars.matchId) });
    const prev = queryClient.getQueryData(queryKeys.predictions.forMatch(vars.matchId));
    queryClient.setQueryData(queryKeys.predictions.forMatch(vars.matchId), {
      ...prev,
      scoreHome: vars.scoreHome,
      scoreAway: vars.scoreAway,
      _optimistic: true,
    });
    return { prev };
  },
  onError: (err, vars, ctx) => {
    queryClient.setQueryData(queryKeys.predictions.forMatch(vars.matchId), ctx?.prev);
    toast.error(err?.message ?? 'No se pudo guardar la predicción');
  },
  onSettled: (_, __, vars) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.predictions.forMatch(vars.matchId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.predictions.me() });
  },
});
```

## 9. Local development experience

### 9.1 Variables de entorno

`.env.local`:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_WORLD_CUP_START=2026-06-11T18:00:00-03:00
NEXT_PUBLIC_INSCRIPCION_PRECIO=15000
NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

`.env.production`:
```bash
NEXT_PUBLIC_API_URL=https://api.prode.tirofederal.com
NEXT_PUBLIC_FRONTEND_URL=https://prode.tirofederal.com
NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT=false
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x...
NEXT_PUBLIC_SENTRY_DSN=https://...
```

### 9.2 Mock checkout flow end-to-end

```
1. Usuario en / (landing)
2. Click "Pagar con MercadoPago"
3. POST /payments/init al backend (NODE_ENV=development → MockCheckoutProvider activo)
4. Backend devuelve initPoint = "http://localhost:3000/dev/mock-checkout?paymentId=xxx&token=plainToken"
5. Frontend redirige a /dev/mock-checkout
6. Página /dev/mock-checkout muestra:
   ├─ Banner amarillo "MODO DESARROLLO — pago simulado"
   ├─ Resumen: monto $15.000, paymentId
   ├─ Input email del comprador (persiste en localStorage)
   ├─ [APROBAR PAGO] (verde)
   ├─ [RECHAZAR PAGO] (rojo)
   └─ [DEJAR PENDIENTE] (gris, cierra sin acción)
7. Click APROBAR:
   ├─ POST a backend /dev/simulate-webhook (endpoint solo activo NODE_ENV !== prod)
   │   body: { paymentId, status: 'approved', payerEmail }
   ├─ Backend ejecuta el handler de webhook completo (idéntico a producción)
   └─ Frontend redirige a /completar-registro?token=plainToken
8. Usuario completa el form normal
```

**Nuevo endpoint backend requerido:** `POST /dev/simulate-webhook`. Solo activo en `NODE_ENV !== 'production'`. Bypass de firma MP, construye un body fake, despacha al handler real. Esto es trabajo del **Plan de implementación frontend Phase 0** (pre-frontend), agregar al backend.

### 9.3 Seed de usuarios para dev

`backend/prisma/seed-dev-users.ts` (separado del seed principal, ya existe el patrón):
- Crea 5 usuarios USER con DNIs `11111111` a `55555555`, password `prode2026`
- Cada uno con WhatsApp ficticio
- Lista los DNIs en consola para copy/paste fácil
- Solo se corre con `npm run seed:dev`

Esto permite al developer logear como usuario sin pasar por flujo de pago/registro.

### 9.4 Storybook — NO

Decisión deliberada: **no Storybook para esta etapa**. Volumen chico, bajaría velocidad. Componentes se desarrollan directamente en páginas con vista previa en `next dev`. Si post-MVP queremos design system aislado, se agrega.

## 10. Testing strategy

| Capa | Herramienta | Cobertura |
|------|-------------|-----------|
| Unit (utils, hooks, schemas) | Vitest | Funciones puras: parsers, formatters, Zod schemas, useCountdown |
| Component | Vitest + RTL | Componentes con lógica: PredictionInput, TeamSelect, MatchCard, LeaderboardRow |
| E2E | Playwright | 5 flujos críticos contra dev local |

### 10.1 E2E flows mínimos

```
01-public-registration.spec.ts
  → / → click "Pagar" → /dev/mock-checkout → APROBAR → /completar-registro → completar form → /predicciones

02-load-prediction.spec.ts
  → login user del seed-dev → /predicciones → tap matchcard → bottom sheet → guardar → verifica state

03-admin-finish-match.spec.ts
  → login admin → /admin/partidos/:id → cargar resultado → confirmar → verifica audit log + leaderboard refresh

04-leaderboard-updates.spec.ts
  → user predice → admin finish → wait 3s → verifica /leaderboard refleja puntos

05-create-and-join-league.spec.ts
  → user A crea liga → comparte código → user B unirse → user B ve ranking de la liga
```

Sin **visual regression tests** — overhead alto, ROI bajo en este contexto.

### 10.2 Lighthouse / Web Vitals

- **CI step**: Lighthouse CI corre en cada PR contra preview deploy (futuro — post-MVP)
- **Budgets**: LCP < 2.5s, CLS < 0.1, INP < 200ms, total JS < 250KB en pages críticos (landing, predicciones)
- **Performance hooks**: imágenes con `next/image`, fonts self-hosted con `font-display: swap`, code splitting por route group

## 11. Performance & PWA

### 11.1 Next.js config

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'flagcdn.com' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};
```

### 11.2 PWA

- `public/manifest.json`:
  ```json
  {
    "name": "Prode Mundial 2026",
    "short_name": "Prode",
    "description": "Pronósticos del Mundial 2026 — Club Tiro Federal",
    "start_url": "/predicciones",
    "display": "standalone",
    "orientation": "portrait",
    "theme_color": "#05090e",
    "background_color": "#ffffff",
    "icons": [
      { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
      { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
    ]
  }
  ```
- iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`.
- Service worker minimalista (registra cache de assets estáticos, no offline avanzado).
- `<IosInstallHint>` que detecta `isIOS && !isStandalone` y muestra tooltip "Agregar a pantalla de inicio".

### 11.3 Optimizaciones específicas

- **Code splitting** automático por route group de App Router.
- **Lazy load** de componentes pesados: `<TeamSelectModal>`, `<NumberPadSheet>` con `dynamic()`.
- **Imágenes**: banderas como SVG inline cuando posible (livianas), `next/image` con `priority` solo en hero.
- **Fonts**: `font-display: swap`, preload del .woff2 display.
- **TanStack Query devtools**: solo en development, lazy loaded.

## 12. Deployment con Dokploy

### 12.1 Container

`frontend/Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Argentina/Buenos_Aires
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### 12.2 Compose update

Agregar a `dokploy/docker-compose.yml`:

```yaml
prode-frontend:
  image: prode-frontend:latest
  build:
    context: ./frontend
    dockerfile: Dockerfile
  ports:
    - '3000:3000'
  environment:
    NODE_ENV: production
    TZ: America/Argentina/Buenos_Aires
    NEXT_PUBLIC_API_URL: https://api.prode.tirofederal.com
    NEXT_PUBLIC_FRONTEND_URL: https://prode.tirofederal.com
    NEXT_PUBLIC_WORLD_CUP_START: '2026-06-11T18:00:00-03:00'
    NEXT_PUBLIC_INSCRIPCION_PRECIO: '15000'
    NEXT_PUBLIC_ENABLE_MOCK_CHECKOUT: 'false'
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: ${TURNSTILE_SITE_KEY}
    NEXT_PUBLIC_SENTRY_DSN: ${SENTRY_DSN_FRONTEND}
  depends_on:
    - prode-backend
  restart: unless-stopped
```

### 12.3 Dominio + cookies

- Dominio: `prode.tirofederal.com` con Let's Encrypt automático en Dokploy.
- Backend update menor: cookies refresh con `SameSite=Lax` y `Domain=.tirofederal.com` para que viajen entre `prode.*` y `api.prode.*`.

## 13. Decisiones explícitas tomadas durante el brainstorming

1. **Next.js 15 App Router** + React 19 confirmado.
2. **Tailwind v4** con CSS-first config (`@theme` directive).
3. **shadcn/ui copiado al repo**, no instalado como package — control total del tema.
4. **`ky` en vez de axios** para HTTP client.
5. **Vitest + RTL** en vez de Jest.
6. **No Storybook** en esta etapa.
7. **No Server Actions** — todo via REST.
8. **JWT access en memoria + refresh httpOnly cookie SameSite=Lax + Domain=.tirofederal.com**.
9. **3 grupos de rutas con layouts independientes**: `(public)`, `(app)`, `(admin)`.
10. **PWA sí desde el día 1**, con `<IosInstallHint>` para Safari iOS.
11. **Mock checkout local-only**: backend devuelve initPoint apuntando a `/dev/mock-checkout`, frontend simula la UX completa, backend tiene endpoint `/dev/simulate-webhook` solo activo en `NODE_ENV !== 'production'`.
12. **Seed de usuarios dev** separado (`seed-dev-users.ts`) para test sin flujo de pago.
13. **Light mode only** (DESIGN.md no menciona dark; `next-themes` instalado por si se agrega post-MVP).
14. **i18n**: solo es-AR.
15. **PredictionInput como bottom sheet en mobile** + input nativo en desktop.
16. **Auto-save con optimistic update + 1s debounce** en predicciones.
17. **Leaderboard con refresh polling 30s** + indicador de live.
18. **Animaciones Framer Motion solo en celebraciones** (acertaste un partido), resto CSS puro 300ms ease-out.
19. **Despliegue Dokploy mismo VPS** que el backend, container separado.

## 14. Edge cases cubiertos

| Caso | Cómo se maneja |
|------|----------------|
| Refresh page → access token perdido | AuthProvider intenta `/auth/refresh` en mount, recovers automatic |
| 401 en cualquier request | Interceptor refresh + retry; si falla refresh, redirect a /login |
| User edita predicción justo en el lock | Server-side validation devolverá 400, optimistic rollback + toast |
| Usuario sin conexión carga predicción | TanStack Query persistirá la mutación si está habilitado, sino toast "sin conexión" |
| Hydration mismatch del countdown | SSR muestra placeholder "—:—:—:—", client toma over |
| iOS no muestra prompt PWA | `<IosInstallHint>` con instrucción manual |
| Modal se abre con scroll en background | shadcn `<Dialog>` ya hace `body { overflow: hidden }` |
| Token plain del magic link en URL queda en historial | Acceptable (token tiene TTL 7 días + se invalida al usar). Documentado. |
| Number pad mobile interfiere con input nativo | PredictionInput detecta isMobile, abre sheet en lugar de input |
| Polling leaderboard en background tab | TanStack Query pausa con `refetchOnWindowFocus`, reanuda al focus |
| Frontend desplegado pero backend down | UI muestra estados de error claros, retry buttons donde corresponde |
| Admin pierde sesión mid-acción | 401 redirect, perdería el form actual — acceptable, raro |

## 15. Lo que queda fuera (futuro / post-MVP)

- Dark mode (preparado vía next-themes, sin theme dark definido)
- Storybook
- Visual regression tests
- Internacionalización a otros idiomas
- App nativa con Expo
- Server Components para más páginas (potencial optimización futura)
- Push notifications nativas (usamos WhatsApp del backend)
- Comparación cabeza a cabeza entre usuarios
- Chat / muro entre usuarios
- Gamificación con badges

## 16. Próximos pasos

1. ✅ Design doc aprobado por el cliente
2. → Spec review loop con `spec-document-reviewer` subagent
3. → Plan de implementación detallado vía skill `writing-plans`
4. → Ejecución del plan: setup repo, design system, layout públicos, layout app, layout admin, deploy
