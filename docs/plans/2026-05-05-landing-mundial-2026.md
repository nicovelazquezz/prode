# Plan · Landing Mundial 2026

> **For Claude:** Use executing-plans skill to implement this plan task-by-task.
> **Spec base:** `docs/09-landing-design.md`
> **Mockup HTML aprobado:** `.superpowers/brainstorm/85758-1777986640/09-landing-v3.html` (con grain ON)

## Remember
- Exact file paths always.
- Mantener todo copy en `lib/landing/content.ts` — JSX nunca tiene strings hard-coded.
- Tokens nuevos no rompen otras páginas (login, inscripción, leaderboard) — usar prefix `--landing-*`.
- DRY, YAGNI, frequent commits (un commit por task).
- **Antes de tocar código de Next.js:** leer `frontend/node_modules/next/dist/docs/` (per `frontend/AGENTS.md` — Next 16 tiene breaking changes vs el conocido).
- Reusar `useCountdown` de `lib/hooks/use-countdown.ts` (ya existe).

## Overview

Implementar la landing pública del Prode Mundial 2026 en `app/page.tsx`. Estética Stadium / Broadcast con paleta WC2026 apagada, branding agnóstico (club al footer), causa solidaria explícita (handball Tiro Federal → Nacional C en Comodoro), inscripción $10.000 abierta desde día 1.

## Prerequisites

- [ ] `frontend/` con dependencias instaladas (`npm install` corrido).
- [ ] Backend del prode corriendo localmente (`/inscripcion` y `/login` deben responder).
- [ ] `useCountdown` existente en `lib/hooks/use-countdown.ts` revisado.
- [ ] Decisiones del cliente confirmadas: precio $10.000, fecha cierre 2026-06-11, causa handball.

---

## Tasks

### Task 1 · Fonts: Anton + DM Mono

**File:** `frontend/app/layout.tsx`

Agregar imports de `Anton` y `DM_Mono` desde `next/font/google`, exponer como CSS variables `--font-display-condensed` y `--font-mono-data`.

**Diff completo de la sección de fonts en `app/layout.tsx`:**

```tsx
import { Noto_Sans, Anton, DM_Mono } from "next/font/google";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "500", "700"],
  display: "swap",
});

const anton = Anton({
  subsets: ["latin"],
  variable: "--font-display-condensed",
  weight: "400",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono-data",
  weight: ["400", "500"],
  display: "swap",
});
```

En el `<html>`, agregar las variables al className:

```tsx
className={`${notoSans.variable} ${anton.variable} ${dmMono.variable} ${fwcFallbackVariable.className} h-full antialiased`}
```

**Verificación:**
```bash
cd frontend && npm run build
# Expected: build succeeds, no font import errors
```

**Commit:** `feat(landing): add Anton + DM Mono fonts via next/font`

---

### Task 2 · Design tokens + grain texture en globals.css

**File:** `frontend/app/globals.css`

Agregar tokens nuevos (con prefix `--landing-*`) y la animación de grain. **No tocar los tokens `--color-prode-*` existentes** — pueden seguir usándose en login/inscripción.

**Append al final del archivo:**

```css
/* ============================================== */
/* LANDING — Mundial 2026                          */
/* ============================================== */
@theme {
  --color-landing-bg: #0E1426;
  --color-landing-surface: #161D32;
  --color-landing-surface-2: #1B2238;
  --color-landing-text: #F1ECE0;
  --color-landing-text-muted: #8A92A8;
  --color-landing-blue: #3E5489;
  --color-landing-red: #A33D3D;
  --color-landing-red-hover: #B74545;
  --color-landing-green: #5C7847;
  --color-landing-gold: #C8A053;
  --color-landing-line: rgba(241, 236, 224, 0.08);
  --color-landing-line-strong: rgba(241, 236, 224, 0.14);

  --font-landing-display: var(--font-display-condensed), "Arial Narrow Black", sans-serif;
  --font-landing-mono: var(--font-mono-data), "Menlo", monospace;
}

/* Grain texture overlay aplicado a .landing-root */
.landing-root {
  position: relative;
  isolation: isolate;
}
.landing-root::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  opacity: 0.32;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.landing-root > * {
  position: relative;
  z-index: 2;
}

/* Eyebrow live dot pulse */
@keyframes landing-pulse {
  50% {
    opacity: 0.35;
  }
}
.landing-pulse {
  animation: landing-pulse 1.4s infinite;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .landing-pulse {
    animation: none;
  }
  .landing-root *,
  .landing-root *::before,
  .landing-root *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Verificación:**
```bash
cd frontend && npm run build
# Expected: build succeeds, css compiles
```

**Commit:** `feat(landing): add design tokens + grain overlay in globals.css`

---

### Task 3 · Content layer: copy y data

**File:** `frontend/lib/landing/content.ts` (crear directorio `landing/`)

Copy y datos de la landing en un solo lugar editable.

```ts
export const LANDING = {
  // Strip top
  strip: {
    parts: ["MUNDIAL FIFA 2026", "11 JUN — 19 JUL", "USA / MEXICO / CANADÁ"],
    countdownLabel: "DÍAS PARA KICKOFF",
  },

  // Topbar
  topbar: {
    brand: "PRODE MUNDIAL 2026 · BAHÍA BLANCA",
    loginCta: "Iniciar sesión",
    loginHref: "/login",
  },

  // Hero
  hero: {
    eyebrowPrefix: "INSCRIPCIÓN ABIERTA · MUNDIAL 2026 · ARRANCA EN",
    eyebrowSuffix: "DÍAS",
    h1Lines: ["JUGÁ EL PRODE.", "BANCÁ EL VIAJE."],
    underlineSecondLine: true,
    lede:
      "Pronosticá los partidos del Mundial fase por fase. Sumás puntos, escalás el ranking, ganás premios. Cada inscripción banca al equipo de **handball del Tiro Federal** que viaja al **Nacional C en Comodoro Rivadavia**.",
    primaryCta: "Inscribirme · $10.000",
    primaryHref: "/inscripcion",
    secondaryCta: "Cómo funciona",
    secondaryHref: "#como-funciona",
    miniMeta: "CIERRA 11/JUN/26 · MERCADOPAGO · TRANSFERENCIA · EFECTIVO EN EL CLUB",
  },

  // Stats lower-third
  stats: [
    { n: "8", l: "Semanas de juego", color: "default" },
    { n: "48", l: "Selecciones", color: "green" },
    { n: "7", l: "Fases", color: "blue" },
    { n: "1", l: "Causa", color: "red" },
  ] as const,

  // Countdown
  countdown: {
    targetIso: "2026-06-11T12:00:00-03:00", // kickoff Mundial
    eyebrow: "Cierre de inscripción",
    titleA: "11 de junio.",
    titleB: "No más.",
  },

  // Cómo funciona
  how: {
    eyebrow: "Tres pasos",
    title: "Cómo se juega.",
    steps: [
      {
        n: "01",
        h: "Te inscribís",
        body: "DNI + WhatsApp. Pagás online o en el club. Listo, ya sos parte.",
      },
      {
        n: "02",
        h: "Cargás predicciones",
        body: "Las **especiales** (campeón, goleador, total de goles) se tiran antes del 11 de junio. Los **partidos** se habilitan fase por fase: primero grupos, después 16avos, octavos, y así.",
      },
      {
        n: "03",
        h: "Sumás y ganás",
        body: "Después de cada partido se actualiza el ranking. Mejor tiro, más premio.",
      },
    ],
  },

  // Sistema de puntos
  points: {
    eyebrow: "Sistema de puntos",
    title: "Cuánto vale cada acierto.",
    rules: [
      { label: "Resultado exacto", small: "2-1 dijiste, 2-1 fue.", pts: 5, accent: "green" },
      { label: "Ganador + diferencia exacta", small: "Acertaste el ganador y la diferencia.", pts: 3, accent: "blue" },
      { label: "Empate acertado, marcador distinto", small: "Dijiste 1-1, fue 2-2.", pts: 2, accent: "blue" },
      { label: "Solo el ganador", small: "Acertaste quién, no por cuánto.", pts: 1, accent: "red" },
    ] as const,
    note:
      "Los puntos se multiplican según la fase: **x1 grupos · x1.5 dieciseisavos · x2 octavos · x3 cuartos · x4 semis · x5 final**. Acertar la final exacta vale 25 puntos.",
    noteCta: "Reglamento completo →",
    noteCtaHref: "/reglamento",
  },

  // Especiales
  specials: {
    eyebrow: "Predicciones especiales",
    title: "Las que se juegan al inicio.",
    cards: [
      { pts: "25", label: "puntos", desc: "Campeón" },
      { pts: "15", label: "puntos", desc: "Goleador" },
      { pts: "10", label: "puntos", desc: "Total goles" },
    ],
    note:
      "Subcampeón (12 pts), tercer puesto (8 pts) y aproximación al total de goles (5 pts) también suman.",
  },

  // Premios
  prizes: {
    eyebrow: "Premios",
    title: "Hay para todos.",
    categories: [
      {
        icon: "🏆",
        accent: "gold",
        title: ["Tabla", "general"],
        items: ["1er puesto", "2do puesto", "3er puesto"],
      },
      {
        icon: "🥇",
        accent: "blue",
        title: ["Mejor de", "cada bloque"],
        items: ["Grupos + 16avos", "Octavos + Cuartos", "Semis + Final"],
      },
      {
        icon: "⭐",
        accent: "red",
        title: ["Aciertos", "especiales"],
        items: ["Campeón del Mundial", "Goleador del torneo", "Total de goles"],
      },
    ] as const,
    note:
      "Un mismo participante puede llevarse varios premios. **Los montos exactos se anuncian antes del cierre de inscripción.**",
  },

  // Solidario
  solidario: {
    eyebrow: "POR QUÉ JUGAR",
    titleA: "El handball del Tiro Federal va al Nacional C.",
    titleB: "Esta es la nafta para llegar.",
    underlineFirst: true,
    body: [
      "El equipo de handball del Club Tiro Federal de Bahía Blanca clasificó al **Nacional C de Clubes** que se juega en **Comodoro Rivadavia**. Hay que pagar viaje, hospedaje, viáticos, indumentaria.",
      "Cada inscripción al prode banca ese fondo. **Jugás vos, viajan ellos.**",
    ],
    bodyMuted:
      "No hace falta ser socio del club ni de Bahía Blanca. La causa es la causa, el prode es para todos.",
  },

  // FAQ
  faq: {
    eyebrow: "Preguntas frecuentes",
    title: "FAQ.",
    items: [
      {
        q: "¿Cuándo se cargan las predicciones?",
        a: "Las especiales (campeón, goleador, total de goles) se cargan hasta el 11 de junio a las 12:00. Los partidos se habilitan fase por fase: primero grupos, después 16avos, octavos, y así. Cada partido se cierra 1 hora antes del kickoff.",
      },
      {
        q: "¿Puedo crear una mini-liga con mis amigos?",
        a: "Sí. Una vez inscripto, podés crear o sumarte a mini-ligas privadas con código de invitación.",
      },
      {
        q: "¿Cómo y cuándo se pagan los premios?",
        a: "Por transferencia, dentro de los 7 días posteriores a la final del Mundial (19 de julio).",
      },
      {
        q: "¿Qué pasa si me olvido de cargar un partido?",
        a: "Suma 0 puntos en ese partido, pero podés seguir cargando los siguientes.",
      },
      {
        q: "¿Necesito ser socio del club?",
        a: "No. Cualquiera puede jugar. La causa es la causa, el prode es para todos.",
      },
      {
        q: "¿Cómo me contactan?",
        a: "Por WhatsApp al número que cargues en la inscripción.",
      },
    ],
  },

  // Final CTA
  final: {
    titleA: "Estás a un click",
    titleB: "de jugar.",
    sub:
      "Inscripción $10.000 · MercadoPago, transferencia o efectivo en el club. La carga abre apenas pagás.",
    cta: "Quiero jugar",
    href: "/inscripcion",
  },

  // Footer
  footer: {
    columns: [
      {
        title: "Organiza",
        body: "Club Tiro Federal · Bahía Blanca · 2026",
        muted: "Iniciativa solidaria del equipo de handball del club. Abierta a todo el que quiera jugar.",
      },
      {
        title: "Contacto",
        links: [
          { label: "WhatsApp +54 9 ...", href: "#" },
          { label: "Instagram @clubtirofederal", href: "#" },
          { label: "contacto@...", href: "#" },
        ],
      },
      {
        title: "Prode",
        links: [
          { label: "Reglamento", href: "/reglamento" },
          { label: "Términos", href: "#" },
          { label: "Política de privacidad", href: "#" },
        ],
      },
      {
        title: "Cuenta",
        links: [
          { label: "Inscribirme", href: "/inscripcion" },
          { label: "Iniciar sesión", href: "/login" },
        ],
      },
    ],
    barLeft: "© 2026 · Club Tiro Federal · Bahía Blanca",
    barRight: "Hecho con cariño en Bahía",
  },
};
```

**Verificación:**
```bash
cd frontend && npx tsc --noEmit
# Expected: no type errors
```

**Commit:** `feat(landing): add content layer with all copy/data`

---

### Task 4 · Helper para markdown-bold inline

**File:** `frontend/lib/landing/inline-bold.tsx`
**Test:** `frontend/lib/landing/inline-bold.test.tsx`

El copy contiene `**texto**` para resaltar palabras. Necesitamos un helper que convierta a `<strong>` sin meter regex en el JSX.

**Test primero (RED):**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { inlineBold } from "./inline-bold";

describe("inlineBold", () => {
  it("renders plain text without bold markers", () => {
    render(<>{inlineBold("hola mundo")}</>);
    expect(screen.getByText("hola mundo")).toBeInTheDocument();
  });

  it("wraps text between ** in <strong>", () => {
    render(<div>{inlineBold("hola **mundo** chau")}</div>);
    const strong = screen.getByText("mundo");
    expect(strong.tagName).toBe("STRONG");
  });

  it("handles multiple bold sections", () => {
    render(<div>{inlineBold("**uno** y **dos**")}</div>);
    expect(screen.getByText("uno").tagName).toBe("STRONG");
    expect(screen.getByText("dos").tagName).toBe("STRONG");
  });
});
```

**Implementación (GREEN):**

```tsx
import { Fragment, type ReactNode } from "react";

/**
 * Convierte `**foo**` → `<strong>foo</strong>` inline.
 * No interpreta otros tokens markdown — solo bold.
 */
export function inlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/);
    if (match) return <strong key={i}>{match[1]}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
```

**Verificación:**
```bash
cd frontend && npm test -- inline-bold
# Expected: 3 passing
```

**Commit:** `feat(landing): add inlineBold helper for copy with **bold** markers`

---

### Task 5 · Chrome: StripTop, Topbar, Footer

**Files:**
- `frontend/components/landing/strip-top.tsx`
- `frontend/components/landing/landing-topbar.tsx`
- `frontend/components/landing/landing-footer.tsx`

Componentes de chrome (ningún estado complejo). Cada uno lee de `LANDING` y renderiza con clases utilitarias.

**`strip-top.tsx`:**

```tsx
import { LANDING } from "@/lib/landing/content";

interface StripTopProps {
  daysToKickoff: number;
}

export function StripTop({ daysToKickoff }: StripTopProps) {
  const parts = [...LANDING.strip.parts, `${daysToKickoff} ${LANDING.strip.countdownLabel}`];
  return (
    <div className="border-b border-[var(--color-landing-line)] bg-black/25 px-8 py-2 text-center font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">·</span>}
          {i === parts.length - 1 ? <strong className="text-[var(--color-landing-text)]">{p}</strong> : p}
        </span>
      ))}
    </div>
  );
}
```

**`landing-topbar.tsx`:**

```tsx
import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

export function LandingTopbar() {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-landing-line)] px-8 py-3.5 font-[family-name:var(--font-landing-mono)] text-xs tracking-wider text-[var(--color-landing-text-muted)]">
      <div className="font-medium tracking-[0.12em] text-[var(--color-landing-text)]">
        <span className="landing-pulse mr-2.5 inline-block h-[7px] w-[7px] rounded-full bg-[var(--color-landing-red)] shadow-[0_0_10px_var(--color-landing-red)]" />
        {LANDING.topbar.brand}
      </div>
      <Link
        href={LANDING.topbar.loginHref}
        className="rounded-sm border border-[var(--color-landing-line-strong)] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {LANDING.topbar.loginCta}
      </Link>
    </div>
  );
}
```

**`landing-footer.tsx`:**

```tsx
import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--color-landing-line)] bg-black/30 px-8 pb-6 pt-10">
      <div className="mb-7 grid grid-cols-1 gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
        {LANDING.footer.columns.map((col) => (
          <div key={col.title}>
            <h5 className="mb-3.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {col.title}
            </h5>
            {"body" in col && col.body && (
              <p className="mb-2 text-sm leading-relaxed text-[var(--color-landing-text)]">{col.body}</p>
            )}
            {"muted" in col && col.muted && (
              <p className="mb-2 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">{col.muted}</p>
            )}
            {"links" in col &&
              col.links?.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="block text-sm leading-loose text-[var(--color-landing-text)] transition-colors hover:text-[var(--color-landing-gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
                >
                  {link.label}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-2 border-t border-[var(--color-landing-line)] pt-4 font-[family-name:var(--font-landing-mono)] text-[10px] tracking-wider text-[var(--color-landing-text-muted)] md:flex-row">
        <span className="text-[var(--color-landing-text)]">{LANDING.footer.barLeft}</span>
        <span>{LANDING.footer.barRight}</span>
      </div>
    </footer>
  );
}
```

**Verificación:**
```bash
cd frontend && npx tsc --noEmit
```

**Commit:** `feat(landing): chrome — StripTop, Topbar, Footer`

---

### Task 6 · Hero + StatsBar

**Files:**
- `frontend/components/landing/hero.tsx`
- `frontend/components/landing/stats-bar.tsx`

**`hero.tsx`:**

```tsx
import Link from "next/link";
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

interface HeroProps {
  daysToKickoff: number;
}

export function Hero({ daysToKickoff }: HeroProps) {
  const { hero } = LANDING;
  return (
    <section
      className="px-8 pb-12 pt-[70px]"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(62,84,137,0.18) 0%, transparent 60%)",
      }}
    >
      <div className="mb-6 flex items-center gap-3 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-red)]">
        <span className="landing-pulse h-[7px] w-[7px] rounded-full bg-[var(--color-landing-red)] shadow-[0_0_12px_var(--color-landing-red)]" />
        {hero.eyebrowPrefix} {daysToKickoff} {hero.eyebrowSuffix}
      </div>
      <h1 className="mb-5 font-[family-name:var(--font-landing-display)] text-[64px] uppercase leading-[0.85] tracking-[-0.025em] md:text-[96px]">
        {hero.h1Lines[0]}
        <br />
        {hero.underlineSecondLine ? (
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            {hero.h1Lines[1]}
          </span>
        ) : (
          hero.h1Lines[1]
        )}
      </h1>
      <p className="mb-7 max-w-[540px] text-base leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(hero.lede)}
      </p>
      <div className="mb-3.5 flex flex-wrap gap-3">
        <Link
          href={hero.primaryHref}
          className="rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {hero.primaryCta}
        </Link>
        <Link
          href={hero.secondaryHref}
          className="rounded-sm border border-[var(--color-landing-line-strong)] px-7 py-[18px] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:border-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          {hero.secondaryCta}
        </Link>
      </div>
      <div className="mt-4 font-[family-name:var(--font-landing-mono)] text-[11px] tracking-[0.1em] text-[var(--color-landing-text-muted)]">
        {hero.miniMeta.split(" · ").map((part, i, arr) => (
          <span key={i}>
            {part.includes("11/JUN") ? <strong className="text-[var(--color-landing-gold)]">{part}</strong> : part}
            {i < arr.length - 1 && " · "}
          </span>
        ))}
      </div>
    </section>
  );
}
```

**`stats-bar.tsx`:**

```tsx
import { LANDING } from "@/lib/landing/content";

const COLOR_CLASS: Record<string, string> = {
  default: "text-[var(--color-landing-text)]",
  green: "text-[var(--color-landing-green)]",
  blue: "text-[var(--color-landing-blue)]",
  red: "text-[var(--color-landing-red)]",
};

export function StatsBar() {
  return (
    <div className="grid grid-cols-2 gap-px border-y border-[var(--color-landing-line-strong)] bg-[var(--color-landing-line)] md:grid-cols-4">
      {LANDING.stats.map((s) => (
        <div key={s.l} className="bg-[var(--color-landing-bg)] px-6 py-7">
          <span
            className={`block font-[family-name:var(--font-landing-display)] text-[56px] leading-none ${COLOR_CLASS[s.color] ?? COLOR_CLASS.default}`}
          >
            {s.n}
          </span>
          <span className="mt-2 block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
            {s.l}
          </span>
        </div>
      ))}
    </div>
  );
}
```

**Verificación:**
```bash
cd frontend && npx tsc --noEmit
```

**Commit:** `feat(landing): Hero + StatsBar components`

---

### Task 7 · LandingCountdown (client component)

**File:** `frontend/components/landing/landing-countdown.tsx`

Reutiliza `useCountdown` existente. Renderiza 4 cells (Días/Horas/Min/Seg) en grid. `aria-live` polite.

```tsx
"use client";

import { useCountdown } from "@/lib/hooks/use-countdown";
import { LANDING } from "@/lib/landing/content";

function pad(n: number | undefined) {
  return (n ?? 0).toString().padStart(2, "0");
}

export function LandingCountdown() {
  const parts = useCountdown(LANDING.countdown.targetIso);
  const cells = [
    { n: pad(parts?.days), l: "Días" },
    { n: pad(parts?.hours), l: "Horas" },
    { n: pad(parts?.minutes), l: "Min" },
    { n: pad(parts?.seconds), l: "Seg" },
  ];

  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {LANDING.countdown.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {LANDING.countdown.titleA}{" "}
        <span className="text-[var(--color-landing-text-muted)]">{LANDING.countdown.titleB}</span>
      </h2>
      <div
        className="grid grid-cols-4 gap-3"
        aria-live="polite"
        aria-atomic="true"
        aria-label={
          parts && !parts.finished
            ? `Faltan ${parts.days} días, ${parts.hours} horas, ${parts.minutes} minutos`
            : "Calculando tiempo restante"
        }
      >
        {cells.map((c) => (
          <div
            key={c.l}
            className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center"
          >
            <span className="block font-[family-name:var(--font-landing-display)] text-5xl leading-none tabular-nums md:text-6xl">
              {c.n}
            </span>
            <span className="mt-3 block font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)]">
              {c.l}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

**Verificación:** smoke test render.

**Test:** `frontend/components/landing/landing-countdown.test.tsx`

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingCountdown } from "./landing-countdown";

describe("LandingCountdown", () => {
  it("renders the four time unit labels", () => {
    render(<LandingCountdown />);
    expect(screen.getByText("Días")).toBeInTheDocument();
    expect(screen.getByText("Horas")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
  });

  it("has aria-live polite for screen readers", () => {
    const { container } = render(<LandingCountdown />);
    const grid = container.querySelector("[aria-live='polite']");
    expect(grid).toBeInTheDocument();
  });
});
```

**Verificación:**
```bash
cd frontend && npm test -- landing-countdown
# Expected: 2 passing
```

**Commit:** `feat(landing): LandingCountdown with aria-live`

---

### Task 8 · Secciones data-driven (HowItWorks, PointSystem, SpecialBets, Prizes)

**Files:**
- `frontend/components/landing/how-it-works.tsx` (NOTA: hay un how-it-works.tsx en domain/, este es nuevo en landing/)
- `frontend/components/landing/point-system.tsx`
- `frontend/components/landing/special-bets.tsx`
- `frontend/components/landing/prizes.tsx`

Cada uno renderiza una sección leyendo de `LANDING`. Patrón común: section padding + eyebrow + title + grid.

**`how-it-works.tsx`** (CON id `como-funciona` para el anchor):

```tsx
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

export function HowItWorks() {
  const { how } = LANDING;
  return (
    <section id="como-funciona" className="border-b border-[var(--color-landing-line)]">
      <div className="px-8 pt-16">
        <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          {how.eyebrow}
        </div>
        <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
          <span className="inline-block border-b-4 border-[var(--color-landing-green)] pb-0.5">{how.title}</span>
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-px bg-[var(--color-landing-line)] md:grid-cols-3">
        {how.steps.map((step) => (
          <div key={step.n} className="bg-[var(--color-landing-bg)] px-7 py-8">
            <span className="mb-4 block font-[family-name:var(--font-landing-display)] text-[56px] leading-none text-[var(--color-landing-green)]">
              {step.n}
            </span>
            <h4 className="mb-2 text-lg font-extrabold">{step.h}</h4>
            <p className="text-sm leading-relaxed text-[var(--color-landing-text-muted)]">{inlineBold(step.body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

**`point-system.tsx`:**

```tsx
import Link from "next/link";
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

const ACCENT: Record<string, string> = {
  green: "border-l-[var(--color-landing-green)]",
  blue: "border-l-[var(--color-landing-blue)]",
  red: "border-l-[var(--color-landing-red)]",
};

export function PointSystem() {
  const { points } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {points.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {points.title}
      </h2>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {points.rules.map((rule) => (
          <div
            key={rule.label}
            className={`flex items-center justify-between rounded-sm border border-l-[3px] border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-5 py-4 ${ACCENT[rule.accent]}`}
          >
            <div className="text-sm leading-tight">
              {rule.label}
              <small className="mt-1 block font-[family-name:var(--font-landing-mono)] text-[11px] text-[var(--color-landing-text-muted)]">
                {rule.small}
              </small>
            </div>
            <div className="ml-5 shrink-0 font-[family-name:var(--font-landing-display)] text-4xl leading-none">
              {rule.pts}
            </div>
          </div>
        ))}
      </div>
      <div className="border-l-2 border-[var(--color-landing-green)] bg-[var(--color-landing-green)]/5 px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(points.note)}{" "}
        <Link href={points.noteCtaHref} className="text-[var(--color-landing-text)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]">
          {points.noteCta}
        </Link>
      </div>
    </section>
  );
}
```

**`special-bets.tsx`:**

```tsx
import { LANDING } from "@/lib/landing/content";

export function SpecialBets() {
  const { specials } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {specials.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {specials.title}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {specials.cards.map((c) => (
          <div key={c.desc} className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-6 text-center">
            <div className="font-[family-name:var(--font-landing-display)] text-[56px] leading-none text-[var(--color-landing-gold)]">{c.pts}</div>
            <div className="mt-1.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-landing-text-muted)]">
              {c.label}
            </div>
            <div className="mt-3.5 text-sm font-semibold">{c.desc}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-l-2 border-[var(--color-landing-green)] bg-[var(--color-landing-green)]/5 px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {specials.note}
      </div>
    </section>
  );
}
```

**`prizes.tsx`:**

```tsx
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

const TOP_BORDER: Record<string, string> = {
  gold: "border-t-[var(--color-landing-gold)]",
  blue: "border-t-[var(--color-landing-blue)]",
  red: "border-t-[var(--color-landing-red)]",
};

export function Prizes() {
  const { prizes } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {prizes.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {prizes.title}
      </h2>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {prizes.categories.map((cat) => (
          <div
            key={cat.title.join(" ")}
            className={`rounded-sm border border-[var(--color-landing-line-strong)] border-t-[3px] bg-[var(--color-landing-surface)] p-6 ${TOP_BORDER[cat.accent]}`}
          >
            <span className="mb-3 block text-2xl">{cat.icon}</span>
            <div className="mb-3.5 font-[family-name:var(--font-landing-display)] text-[22px] uppercase leading-tight tracking-tight">
              {cat.title.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < cat.title.length - 1 && <br />}
                </span>
              ))}
            </div>
            <ul className="space-y-1 text-sm">
              {cat.items.map((item) => (
                <li key={item} className="relative pl-3.5 before:absolute before:left-0 before:font-bold before:text-[var(--color-landing-text-muted)] before:content-['·']">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 border-l-2 border-[var(--color-landing-green)] bg-[var(--color-landing-green)]/5 px-4 py-3.5 font-[family-name:var(--font-landing-mono)] text-[11px] leading-relaxed text-[var(--color-landing-text-muted)]">
        {inlineBold(prizes.note)}
      </div>
    </section>
  );
}
```

**Verificación:**
```bash
cd frontend && npx tsc --noEmit
```

**Commit:** `feat(landing): HowItWorks, PointSystem, SpecialBets, Prizes`

---

### Task 9 · SolidarityBlock + FinalCTA

**Files:**
- `frontend/components/landing/solidarity-block.tsx`
- `frontend/components/landing/final-cta.tsx`

**`solidarity-block.tsx`:**

```tsx
import { LANDING } from "@/lib/landing/content";
import { inlineBold } from "@/lib/landing/inline-bold";

export function SolidarityBlock() {
  const { solidario } = LANDING;
  return (
    <section
      className="border-b border-[var(--color-landing-line)] px-8 py-20"
      style={{
        background:
          "linear-gradient(180deg, transparent 0%, rgba(92,120,71,0.05) 100%), var(--color-landing-bg)",
      }}
    >
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-green)]">
        {solidario.eyebrow}
      </div>
      <h2 className="mb-6 max-w-[720px] font-[family-name:var(--font-landing-display)] text-[64px] uppercase leading-tight tracking-tight">
        {solidario.underlineFirst ? (
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-0.5">
            {solidario.titleA}
          </span>
        ) : (
          solidario.titleA
        )}{" "}
        <span className="text-[var(--color-landing-green)]">{solidario.titleB}</span>
      </h2>
      {solidario.body.map((p, i) => (
        <p key={i} className="mb-3.5 max-w-[600px] text-base leading-relaxed text-[var(--color-landing-text)]">
          {inlineBold(p)}
        </p>
      ))}
      <p className="max-w-[600px] text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        {solidario.bodyMuted}
      </p>
    </section>
  );
}
```

**`final-cta.tsx`:**

```tsx
import Link from "next/link";
import { LANDING } from "@/lib/landing/content";

export function FinalCTA() {
  const { final } = LANDING;
  return (
    <section
      className="px-8 py-20 text-center"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(163,61,61,0.12) 0%, transparent 60%)",
      }}
    >
      <h2 className="mb-4 font-[family-name:var(--font-landing-display)] text-[80px] uppercase leading-[0.85] tracking-tight">
        {final.titleA}
        <br />
        {final.titleB}
      </h2>
      <p className="mx-auto mb-8 max-w-[460px] text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        {final.sub}
      </p>
      <Link
        href={final.href}
        className="inline-block rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
      >
        {final.cta}
      </Link>
    </section>
  );
}
```

**Verificación:**
```bash
cd frontend && npx tsc --noEmit
```

**Commit:** `feat(landing): SolidarityBlock + FinalCTA`

---

### Task 10 · FAQ accordion accesible

**File:** `frontend/components/landing/faq.tsx`
**Test:** `frontend/components/landing/faq.test.tsx`

Accordion accesible — un item por pregunta, click para toggle, Enter/Space funciona, `aria-expanded` correcto.

**Implementación con `<details>`/`<summary>` (accesible nativo, sin estado React):**

```tsx
import { LANDING } from "@/lib/landing/content";

export function FAQ() {
  const { faq } = LANDING;
  return (
    <section className="border-b border-[var(--color-landing-line)] px-8 py-16">
      <div className="mb-4 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        {faq.eyebrow}
      </div>
      <h2 className="mb-8 font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-tight tracking-tight">
        {faq.title}
      </h2>
      <div>
        {faq.items.map((item) => (
          <details
            key={item.q}
            className="group cursor-pointer border-b border-[var(--color-landing-line)] py-4 transition-colors focus-within:bg-white/[0.02]"
          >
            <summary className="flex list-none items-center justify-between text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]">
              <span>{item.q}</span>
              <span className="text-2xl font-light text-[var(--color-landing-text-muted)] transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3 pr-8 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              {item.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
```

**Test:**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FAQ } from "./faq";

describe("FAQ", () => {
  it("renders all questions", () => {
    render(<FAQ />);
    expect(screen.getByText("¿Cuándo se cargan las predicciones?")).toBeInTheDocument();
    expect(screen.getByText("¿Necesito ser socio del club?")).toBeInTheDocument();
  });

  it("opens an item on click and shows the answer", () => {
    render(<FAQ />);
    const summary = screen.getByText("¿Necesito ser socio del club?");
    fireEvent.click(summary);
    expect(screen.getByText(/cualquiera puede jugar/i)).toBeVisible();
  });
});
```

**Verificación:**
```bash
cd frontend && npm test -- faq
# Expected: 2 passing
```

**Commit:** `feat(landing): FAQ accordion with native details/summary`

---

### Task 11 · app/page.tsx — assembly + SEO

**File:** `frontend/app/page.tsx`

Reemplazar el `app/page.tsx` actual (vacío o el que haya). Estructura: server component que calcula `daysToKickoff`, ensambla las secciones.

```tsx
import type { Metadata } from "next";
import { StripTop } from "@/components/landing/strip-top";
import { LandingTopbar } from "@/components/landing/landing-topbar";
import { Hero } from "@/components/landing/hero";
import { StatsBar } from "@/components/landing/stats-bar";
import { LandingCountdown } from "@/components/landing/landing-countdown";
import { HowItWorks } from "@/components/landing/how-it-works";
import { PointSystem } from "@/components/landing/point-system";
import { SpecialBets } from "@/components/landing/special-bets";
import { Prizes } from "@/components/landing/prizes";
import { SolidarityBlock } from "@/components/landing/solidarity-block";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Prode Mundial 2026 · Bahía Blanca · Por el handball del Tiro Federal",
  description:
    "Pronosticá los partidos del Mundial 2026 fase por fase. Cada inscripción banca al equipo de handball del Tiro Federal que viaja al Nacional C en Comodoro Rivadavia.",
  openGraph: {
    title: "Prode Mundial 2026 · Bahía Blanca",
    description:
      "Jugá el prode, bancá el viaje. Inscripción $10.000. Cierra 11 de junio.",
    type: "website",
    locale: "es_AR",
  },
};

const KICKOFF_ISO = "2026-06-11T12:00:00-03:00";

function daysUntilKickoff(): number {
  const now = Date.now();
  const target = new Date(KICKOFF_ISO).getTime();
  const diff = target - now;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export default function LandingPage() {
  const daysToKickoff = daysUntilKickoff();
  return (
    <main className="landing-root min-h-screen bg-[var(--color-landing-bg)] text-[var(--color-landing-text)]">
      <StripTop daysToKickoff={daysToKickoff} />
      <LandingTopbar />
      <Hero daysToKickoff={daysToKickoff} />
      <StatsBar />
      <LandingCountdown />
      <HowItWorks />
      <PointSystem />
      <SpecialBets />
      <Prizes />
      <SolidarityBlock />
      <FAQ />
      <FinalCTA />
      <LandingFooter />
    </main>
  );
}
```

**Nota:** `daysUntilKickoff()` se ejecuta en el server. Como Next.js 16 puede revalidar/cachear, considerar `export const revalidate = 60 * 60` (1h) o `export const dynamic = "force-dynamic"` si el countdown debe ser siempre fresco. **Revisar la doc de Next 16 antes** (`frontend/node_modules/next/dist/docs/`).

**Verificación:**
```bash
cd frontend && npm run build && npm run dev
# Abrir http://localhost:3000 — debe renderizar la landing completa.
```

**Commit:** `feat(landing): assemble app/page.tsx with SEO metadata`

---

### Task 12 · E2E test — landing carga + CTA navega

**File:** `frontend/test/e2e/landing.spec.ts` (o donde estén los e2e — revisar el `playwright.config.ts`)

```ts
import { test, expect } from "@playwright/test";

test.describe("Landing Mundial 2026", () => {
  test("renders hero with INSCRIPCIÓN ABIERTA + brand correcto", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/INSCRIPCIÓN ABIERTA/i)).toBeVisible();
    await expect(page.getByText(/PRODE MUNDIAL 2026 · BAHÍA BLANCA/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /JUGÁ EL PRODE\./i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /BANCÁ EL VIAJE\./i })).toBeVisible();
  });

  test("CTA primario navega a /inscripcion", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Inscribirme · \$10\.000/i }).first().click();
    await expect(page).toHaveURL(/\/inscripcion/);
  });

  test("CTA Cómo funciona scrollea al ancla", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Cómo funciona/i }).first().click();
    await expect(page).toHaveURL(/#como-funciona/);
  });

  test("FAQ items se expanden al click", async ({ page }) => {
    await page.goto("/");
    const summary = page.getByText("¿Necesito ser socio del club?");
    await summary.click();
    await expect(page.getByText(/cualquiera puede jugar/i)).toBeVisible();
  });
});
```

**Verificación:**
```bash
cd frontend && npm run test:e2e -- landing
# Expected: 4 passing
```

**Commit:** `test(landing/e2e): hero + CTAs + FAQ`

---

## Integration / Manual verification

Después de los 12 tasks:

```bash
cd frontend
npm run build              # build pasa sin errores
npm test                   # unit tests verdes
npm run test:e2e           # e2e verdes
npm run dev                # dev server
```

Manual:

1. Abrir `http://localhost:3000` en mobile viewport (375px).
2. Verificar que el hero ocupa primer fold sin scroll.
3. Verificar countdown actualiza cada segundo.
4. Click en "Inscribirme · $10.000" → llega a `/inscripcion`.
5. Click en "Iniciar sesión" → llega a `/login`.
6. Click en "Reglamento completo →" → llega a `/reglamento`.
7. Abrir DevTools → Rendering → Emular `prefers-reduced-motion: reduce` → confirmar que el dot rojo no pulsa.
8. Lighthouse mobile audit ≥ 90 en Performance, Accessibility, SEO.
9. Probar en 768px (iPad) y 1440px (desktop).
10. Verificar contraste con WebAIM contrast checker (CTA rojo ya validado en 5.43:1, pero double-check).

## Rollback Plan

Cada task hace su propio commit. Si algo se rompe:

```bash
git log --oneline | head -15
git revert <commit-sha>
```

Para revertir TODA la landing:

```bash
git revert 36983da..HEAD   # desde el commit que creó el spec hasta ahora
```

## Out of scope

- Variantes `pre-launch` y `closed` del hero (queda en el spec para fase 2).
- OG image diseñada (placeholder por ahora — Next.js auto-genera de la metadata).
- Analytics tracking (TBD).
- A/B testing del headline.
