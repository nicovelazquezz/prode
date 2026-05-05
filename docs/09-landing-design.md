# 09 · Landing Mundial 2026 — Diseño

> Spec aprobado el 2026-05-05 tras brainstorming con mockups en browser.
> Mockup final aprobado (v3): `.superpowers/brainstorm/85758-1777986640/09-landing-v3.html`.
> Reglas de puntuación y premios: ver `02-sistema-puntos-premios.md` (fuente de verdad).

## Objetivo

Convertir tráfico tibio y caliente en inscripciones pagas al Prode del Mundial 2026, con explicación clara del costado solidario: la recaudación banca el viaje del equipo de **handball del Club Tiro Federal** al **Nacional C de Clubes en Comodoro Rivadavia**.

**Métrica primaria:** % visitantes → click en CTA "Inscribirme" → `/inscripcion`.

## Decisiones estratégicas

### Versión: C híbrida (educar + convertir)

Long-form scrolleable que explica el prode, los premios y el ángulo solidario, con CTA dominante arriba y repetido al final. Resuelve audiencia mixta sin sacrificar conversión.

### Branding: agnóstico, club al footer

Para que **otros clubes y simpatizantes ajenos a Tiro Federal puedan participar y colaborar sin sentir que es ajeno**, el branding visible es neutro:

- **Strip top (mono, fino):** `MUNDIAL FIFA 2026 · 11 JUN — 19 JUL · USA / MEXICO / CANADÁ · N DÍAS PARA KICKOFF` — info temporal del evento.
- **Topbar:** `● PRODE MUNDIAL 2026 · BAHÍA BLANCA` (sin escudo, sin nombre de club como marca dominante) + link `Iniciar sesión`.
- **Hero:** copy enfocado en el deporte y el viaje, no en la pertenencia al club.
- **Costado solidario:** ahí sí se nombra a Tiro Federal como organizador y dueño del equipo de handball que viaja.
- **Footer rico de 4 columnas:** `Organiza` · `Contacto` · `Prode` · `Cuenta`.

Esto permite que una persona de otro club juegue sin fricción identitaria, y el costado solidario es transversal ("ayudás a un equipo de pibes que se ganaron ir al Nacional").

### Estado del lifecycle: `open` desde día 1

La inscripción abre desde la publicación. **No hay variante pre-launch** en el MVP — simplifica el código y el copy.

(Se mantiene `closed` como variante futura cuando arranque el Mundial el 11/jun, pero queda fuera del MVP — se ajusta más cerca de esa fecha.)

### Dirección estética: "Stadium / Broadcast"

Estética de transmisión deportiva — tipografía display condensed gigante, datos en mono, lower-third de cancha. Anti-app, anti-corporativo.

### Paleta: WC 2026 trophy en versión apagada

| Token | Hex | Uso |
|-------|-----|-----|
| `bg` | `#0E1426` | Fondo navy profundo |
| `surface` | `#161D32` | Tarjetas, cells countdown |
| `surface-2` | `#1B2238` | Surfaces elevadas |
| `text` | `#F1ECE0` | Texto principal (cream cálido, no blanco puro) |
| `text-muted` | `#8A92A8` | Texto secundario |
| `blue` | `#3E5489` | Acento azul (data, headings secundarios) |
| `red` | `#A33D3D` | CTAs primarios, eyebrow "live", énfasis |
| `green` | `#5C7847` | Pasos del flujo, highlights de aciertos |
| `gold` | `#C8A053` | Reservado para premios destacados (uso mínimo) |
| `line` | `rgba(241,236,224,0.08)` | Separadores |
| `line-strong` | `rgba(241,236,224,0.14)` | Bordes de tarjetas |

Versiones apagadas de la paleta oficial WC2026 (Hermes blue, Torch red, American green) — no se usan los hex saturados originales.

### Tipografía

| Familia | Uso |
|---------|-----|
| **Anton** (Google Fonts) | Display: H1, números grandes, section titles |
| **DM Mono** (Google Fonts) | Eyebrows, labels de stats, datos técnicos, footer |
| **Inter** (Google Fonts) | Body, párrafos, CTAs |

Cuando el cliente provea `FWC2026-CondensedBlack.woff2` (variable `--font-fwc` ya configurada en `app/layout.tsx`), reemplaza Anton para el H1 hero. Mientras tanto: Anton.

### Motion

- **Eyebrow live:** pulse blink (1.4s, opacidad 1 ↔ 0.35) sobre el dot rojo del topbar y del hero eyebrow.
- **Reveal scroll:** secciones con fade-up sutil (8-12px, 400ms) usando framer-motion.
- **CTA hover:** background-color shift (`#A33D3D` → `#B74545`), 150ms.
- **Respeto a `prefers-reduced-motion`:** todas las animaciones deshabilitadas si el usuario lo pide.

### Texturas / atmósfera

- **Grain texture overlay** (default ON) — SVG noise con `mix-blend-mode: overlay; opacity: 0.32`. Aplicado sobre el contenedor principal, rompe la planitud del navy. Imperceptible como decoración, perceptible como "calidad de impresión".
- **Radial gradients localizados** — uno suave en el hero (azul, top-center), otro en el final CTA (rojo, center). No se usa como decoración protagonista, solo como atmósfera.

### Sistema visual repetitivo

- **Underline verde** (`border-bottom: 4-6px solid #5C7847`) aplicado en H1 (sobre `BANCÁ EL VIAJE`), section-title `Cómo se juega`, y H2 del bloque solidario. Es el sello visual recurrente.
- **Eyebrow en mono uppercase** con letter-spacing 0.18-0.22em — todas las secciones lo usan para señalizar entrada.
- **Stats con número grande Anton + label mono pequeño** — patrón repetido en hero stats, countdown, sistema de puntos y premios.

## Copy (textos finales)

### Strip top (sobre el topbar)

`MUNDIAL FIFA 2026 · 11 JUN — 19 JUL · USA / MEXICO / CANADÁ · N DÍAS PARA KICKOFF`

(N se calcula en runtime — countdown a `2026-06-11T12:00:00-03:00`.)

### Hero

- **Eyebrow (con dot rojo pulsante):** `INSCRIPCIÓN ABIERTA · MUNDIAL 2026 · ARRANCA EN N DÍAS`
- **H1:** `JUGÁ EL PRODE.` / `BANCÁ EL VIAJE.` (la segunda línea con underline verde)
- **Lede:** `Pronosticá los partidos del Mundial fase por fase. Sumás puntos, escalás el ranking, ganás premios. Cada inscripción banca al equipo de handball del Tiro Federal que viaja al Nacional C en Comodoro Rivadavia.`
- **CTA primario:** `Inscribirme · $10.000`
- **CTA ghost:** `Cómo funciona`
- **Mini-meta debajo:** `CIERRA 11/JUN/26 · MERCADOPAGO · TRANSFERENCIA · EFECTIVO EN EL CLUB`

### Stats lower-third

`8 Semanas de juego` · `48 Selecciones` · `7 Fases` · `1 Causa`

### Countdown

- **Eyebrow:** `Cierre de carga`
- **H2:** `11 de junio. No más.`

### Cómo funciona (3 pasos)

1. **Te inscribís** — DNI + WhatsApp. Pagás online o en el club. Listo.
2. **Cargás predicciones** — Las **especiales** (campeón, goleador, total de goles) se tiran antes del 11 de junio. Los **partidos** se habilitan fase por fase a medida que avanza el Mundial — no son los 104 de golpe.
3. **Sumás y ganás** — Después de cada partido se actualiza el ranking. Mejor tiro, más premio.

### Sistema de puntos

Mostrar las **4 reglas base** + nota sobre multiplicadores por fase (no abrumar con la tabla completa, link al reglamento para detalle).

| Acierto | Puntos base |
|---------|-------------|
| Resultado exacto (2-1 ↔ 2-1) | **5 pts** |
| Ganador + diferencia exacta (2-1 ↔ 3-2) | **3 pts** |
| Empate acertado, marcador distinto (1-1 ↔ 2-2) | **2 pts** |
| Solo ganador correcto | **1 pt** |

Texto pie: `Los puntos se multiplican según la fase: x1 grupos, x1.5 dieciseisavos, x2 octavos, x3 cuartos, x4 semis, x5 final. Acertar la final exacta vale 25 puntos.`

CTA secundario: `Reglamento completo →` (link a `/reglamento`).

### Predicciones especiales

Bloque visual con 3 tarjetas:

- **Campeón** — 25 pts
- **Goleador del torneo** — 15 pts
- **Total de goles** — hasta 10 pts

Texto pie: `Subcampeón (12 pts), tercer puesto (8 pts) y aproximación al total de goles (5 pts) también suman.`

### Premios

En la landing **no se muestran montos ni porcentajes** (el cliente todavía no los confirmó). Se comunican las **categorías** de premios para que el participante sepa que hay para todos.

| Categoría | Descripción |
|-----------|-------------|
| 🏆 **Tabla general (top 3)** | 1°, 2° y 3° del puntaje acumulado al cierre del Mundial. |
| 🥇 **Mejor de cada bloque de fases** | Mejor puntaje en **Grupos + 16avos**, en **Octavos + Cuartos** y en **Semis + Final**. |
| ⭐ **Aciertos especiales** | Premios por acertar **Campeón**, **Goleador del torneo** y **Total de goles**. |

Texto pie: `Un mismo participante puede llevarse varios premios. Los montos exactos se anuncian antes del cierre de inscripción.`

> **Nota técnica:** el sistema de scoring en `02-sistema-puntos-premios.md` define 6 premios por fase separados (grupos, 16avos, octavos, cuartos, semis, final). En la landing los agrupamos en 3 bloques para simplificar el mensaje al usuario. El backend sigue calculando los 6, y el cliente decide si entrega 6 premios separados o agrupa el reparto. Si decide mantener 6 separados, este copy se ajusta a último momento sin tocar lógica.

### Costado solidario (clave)

- **Eyebrow:** `POR QUÉ JUGAR`
- **H2:** `El handball del Tiro Federal va al Nacional C.` / `Esta es la nafta para llegar.`
- **Body:** `El equipo de handball del Club Tiro Federal de Bahía Blanca clasificó al Nacional C de Clubes que se juega en Comodoro Rivadavia. Hay que pagar viaje, hospedaje, viáticos, indumentaria. Cada inscripción al prode banca ese fondo. Jugás vos, viajan ellos.`
- **Sub-bullet:** Mostrar (cuando esté confirmado por el cliente) cuántos jugadores viajan, fechas del torneo, foto del equipo si dan permiso.
- **CTA:** `Inscribirme · $10.000`

### FAQ

Accordion con 6 preguntas:

1. **¿Cuándo cierra la carga de predicciones?** El 11 de junio a las 12:00 hs (hora del primer partido del Mundial). Después de eso, los partidos ya jugados se cierran y los siguientes se pueden seguir cargando hasta 1 hora antes del kickoff de cada uno.
2. **¿Puedo crear una mini-liga con mis amigos?** Sí. Una vez inscripto, podés crear o sumarte a mini-ligas privadas con código de invitación.
3. **¿Cómo y cuándo se pagan los premios?** Por transferencia, dentro de los 7 días posteriores a la final del Mundial (19 de julio).
4. **¿Qué pasa si me olvido de cargar un partido?** Suma 0 puntos en ese partido, pero podés seguir cargando los siguientes.
5. **¿Necesito ser socio del club?** No. Cualquiera puede jugar. La causa es la causa, el prode es para todos.
6. **¿Cómo me contactan?** Por WhatsApp al número que cargues en la inscripción.

### Final CTA

- **H2:** `Estás a un click de jugar.`
- **Sub:** `Inscripción $10.000 · MercadoPago, transferencia o efectivo en el club. La carga abre apenas pagás.`
- **CTA:** `Quiero jugar`

### Footer (rico, 4 columnas)

| Columna | Contenido |
|---------|-----------|
| **Organiza** | `Club Tiro Federal · Bahía Blanca · 2026` + tagline corto: `Iniciativa solidaria del equipo de handball. Abierta a todo el que quiera jugar.` |
| **Contacto** | `WhatsApp +54 9 ...` · `Instagram @clubtirofederal` · `contacto@...` |
| **Prode** | `Reglamento` · `Términos` · `Política de privacidad` |
| **Cuenta** | `Inscribirme` · `Iniciar sesión` |

Bar inferior: `© 2026 · Club Tiro Federal · Bahía Blanca` · `Hecho con cariño en Bahía`.

## Estructura de página (orden vertical)

1. Strip top — `MUNDIAL FIFA 2026 · 11 JUN — 19 JUL · USA / MEXICO / CANADÁ · N DÍAS PARA KICKOFF`
2. Topbar — `● PRODE MUNDIAL 2026 · BAHÍA BLANCA` + link `Iniciar sesión`
3. Hero (eyebrow live + H1 + lede + CTAs + mini-meta)
4. Stats lower-third
5. Countdown
6. Cómo funciona (3 pasos)
7. Sistema de puntos (4 reglas + nota multiplicadores)
8. Predicciones especiales (3 tarjetas)
9. Premios (3 categorías, sin %)
10. Costado solidario (handball / Comodoro / Nacional C)
11. FAQ
12. Final CTA
13. Footer rico (4 columnas + bar)

## Implementación técnica

- **Ruta:** `app/page.tsx` (root del frontend Next.js).
- **Layout:** existente `app/layout.tsx` (mantiene fonts y providers). Agregar Anton + DM Mono via `next/font/google`.
- **Componentes:** ubicarlos en `components/landing/` — desglose por sección: `Hero`, `StatsBar`, `Countdown`, `HowItWorks`, `PointSystem`, `SpecialBets`, `Prizes`, `SolidarityBlock`, `FAQ`, `FinalCTA`, `Footer`.
- **Datos estáticos:** todo el copy y números (precio, fechas, FAQ, premios) en `lib/landing-content.ts`. Permite ajustar texto sin tocar JSX.
- **Countdown:** componente client-only con `useEffect` + `setInterval(1000)`. Fecha objetivo desde `landing-content.ts` (default: 2026-06-11T12:00:00-03:00).
- **CTAs:** `Inscribirme` → `/inscripcion`. `Iniciar sesión` → `/login`. `Cómo funciona` → anchor `#como-funciona`. `Reglamento completo` → `/reglamento`.
- **SEO:** metadata en `app/page.tsx` con title/description orientados a la causa ("Prode Mundial 2026 · Bahía Blanca · Por el handball del Tiro Federal"). OG image generada con el headline + paleta (placeholder de PNG por ahora; reemplazable).
- **Performance:** fonts con `display: swap`. Sin imágenes pesadas above-the-fold. Hero text estático (no animado al cargar) para FCP.
- **Mobile-first:** breakpoints `< 640px (sm)`, `≥ 768px (md)`, `≥ 1024px (lg)`. H1 baja de 96px desktop a ~52px mobile.

## Accesibilidad

- Contraste verificado: texto cream (`#F1ECE0`) sobre navy (`#0E1426`) → ~14:1 ✓ AAA.
- Contraste verificado: texto cream sobre CTA rojo (`#A33D3D`) → ~5.43:1 ✓ AA.
- Contraste verificado: texto muted (`#8A92A8`) sobre navy → ~5.79:1 ✓ AA.
- **Focus rings:** `:focus-visible { outline: 2px solid #C8A053; outline-offset: 4px; }` en CTAs y links.
- **Eyebrow live:** texto explícito (`INSCRIPCIÓN ABIERTA · ARRANCA EN N DÍAS`) — el dot rojo es decoración, no portador único de información.
- **Countdown:** contenedor con `aria-live="polite"` y `aria-atomic="true"`. Actualización del DOM cada **minuto** (no cada segundo) para no spammear lectores de pantalla; visualmente el segundero sigue al ritmo normal.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` desactiva el pulse del dot rojo, los reveals de framer-motion y reduce todas las transitions a 0.01ms.
- **Touch targets:** CTAs y FAQ items ≥ 44px de alto.
- **`cursor: pointer`** en todos los elementos clickables (FAQ items, prize cards si son interactivas, links del footer).
- **FAQ accordion accesible:** items con `tabindex="0"`, manejo de teclado (Enter/Space para abrir).

## Out of scope

- Variantes `pre-launch` y `closed` del hero (queda diseñado para `open` solamente).
- Hero video/animación de fondo.
- Login social.
- Multi-idioma.
- Captura de leads vía form de WhatsApp (no necesario porque inscripción está abierta).
- Foto del equipo de handball como hero — se reserva para el bloque solidario, y solo si el cliente la provee con autorización.

## Pendientes (información del cliente, no bloquean implementación)

1. **Datos del equipo de handball** para enriquecer el bloque solidario: cuántos jugadores viajan, fechas exactas del Nacional C, foto del equipo (con permiso).
2. **OG image final** para redes sociales — placeholder generado por código en MVP.

## Validación

Antes de mergear a producción:

- [ ] Lighthouse mobile ≥ 90 en Performance, Accessibility, SEO.
- [ ] Probado en 375px (iPhone SE), 768px (iPad), 1440px (desktop).
- [ ] Probado con `prefers-reduced-motion: reduce`.
- [ ] Contraste rojo CTA verificado con WebAIM contrast checker.
- [ ] CTAs trackeados (analytics — TBD si Google Analytics o Plausible).
- [ ] OG image generada y testeada en preview de WhatsApp.
- [ ] Copy revisado por el cliente antes del go-live.
