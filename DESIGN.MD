# FIFA World Cup 26 Hospitality Design System

## Overview
The FIFA World Cup 26 Hospitality design system pairs an ultra-bold condensed display typeface—**Fwc 2026 Condensed**—with the clean, highly legible **Noto Sans** for body text. This creates a striking visual hierarchy where headlines command attention with their compressed, heavy letterforms while UI text remains approachable and readable. The color story is anchored in near-black (`#05090e`) for primary text and UI elements, set against crisp white backgrounds with a distinctive deep navy (`#0c1521`) serving as the hero and atmospheric backdrop. A vibrant FIFA red (`#fe1743`) provides strategic accent moments. The overall aesthetic balances premium sports event grandeur with modern digital clarity—bold, confident, and purposefully restrained.

---United 2026 FIFA World Cup Bid Logo Colors with Hex & RGB Codes
United 2026 FIFA World Cup bid Logo
The United 2026 FIFA World Cup Bid Logo Colors with Hex & RGB Codes has 5 colors which are Average Green (#3CAC3B), Hermes (#2A398D), Torch Red (#E61D25), Light Gray (#D1D4D1) and Dark Heather Grey (#474A4A). The RGB and CMYK values of the colors are in the table below along with the closest RAL and PANTONE® numbers. Click on a color chip to view shades, tints and tones, and also download patterns, gradients and palettes of the color.

## Color Palette

### Core Colors
| Token | Hex | Usage |
|---|---|---|
| `--color-primary` | `#05090e` | Primary text, headings on light backgrounds, button text, nav links |
| `--color-secondary` | `#0c1521` | Hero section backgrounds, dark mode surfaces, atmospheric overlays |
| `--color-accent` | `#fe1743` | CTA highlights, alert states, brand accent moments |
| `--color-bg` | `#ffffff` | Page background, card surfaces, modal backgrounds |
| `--color-surface` | `#f9fbff` | Subtle elevated surfaces, alternating section backgrounds |
| `--color-text-primary` | `#05090e` | Body text, primary content |
| `--color-text-secondary` | `#4b5667` | Supporting text, descriptions, muted labels |
| `--color-text-muted` | `#bc8fd1` | Disabled states, placeholder text |
| `--color-border` | `#d0d5df` | Input borders, dividers, card separators |

### Semantic
- **Page background**: `#ffffff`
- **Primary CTA**: bg `#05090e`, text `#ffffff`
- **Secondary CTA / Nav buttons**: transparent bg, text `#222222`, hover state shifts opacity
- **Ghost buttons**: bg transparent, text `#05090e` with underline or border on hover
- **Hero background**: `#0c1521` deep navy with potential gradient overlay
- **Modal surface**: `#ffffff` with `16px` radius
- **City cards**: Multi-colored backgrounds (teal `#4bd7e6`, green variants) per host city branding
- **Hover states**: Background-color transitions over `300ms ease-out`, opacity shifts to `0.8` or color darken by ~10%
- **Focus states**: Outline rings in `#05090e` at `2px` offset

---

## Typography

### Font Families
```
--font-display: "Fwc 2026 Condensed", Arial, sans-serif;
--font-sans:    "Noto Sans", sans-serif;
```

The **Fwc 2026 Condensed** typeface is the signature voice of this system—a proprietary ultra-condensed black-weight face designed specifically for the tournament identity. It appears exclusively in display and heading roles (H1–H3), rendered at massive sizes (32–80px) with tight tracking that conveys energy, impact, and sporting authority. Its compressed width allows for dramatic scale without breaking layouts. **Noto Sans** handles everything else: body copy, navigation, labels, buttons, and UI chrome. This pairing works because the contrast is structural—geometric compression versus humanist openness—creating visual tension that feels dynamic rather than jarring. The system avoids mixing more than these two families to maintain brand coherence across all touchpoints.

### Type Scale
| Role | Family | Size | Weight | Line-height | Color |
|---|---|---|---|---|---|
| Display / H1 | Fwc 2026 Condensed | 80px | 900 | 76.8px | `#ffffff` (on dark) / `#05090e` (on light) |
| H2 / Section heading | Fwc 2026 Condensed | 72px | 900 | 72px | `#05090e` |
| H3 / Article title | Fwc 2026 Condensed | 32px | 900 | 32px | `#05090e` |
| H4 / Label | Noto Sans | 14px | 700 | 18.2px | `#696969` |
| Body | Noto Sans | 16px | 400 | 24.64px | `#05090e` / `#ffffff` |
| Body (on dark) | Noto Sans | 16px | 400 | 24.64px | `#ffffff` |
| UI Label / Nav | Noto Sans | 14px | 500 | normal | `#222222` |
| Small / Caption | Noto Sans | 14px | 400 | normal | `#4b5667` |

### Typography Notes
- Display headings use positive letter-spacing (`1.56px` at 80px, `1.44px` at 72px, `0.64px` at 32px) to slightly open the ultra-condensed forms
- All uppercase treatment is built into the font choice for headings—no CSS text-transform needed; the typeface itself is all-caps
- Navigation items use `font-size: 14px` with `font-weight: 500` for a semi-bold but not heavy feel
- Modal titles ("CHOOSE COUNTRY") use the display face at a reduced size (~28–32px) in `#05090e`
- Countdown timer digits appear to use the display face or a monospace variant for tabular alignment
- City name labels on cards use all-caps tracking, likely the display face at ~20–24px in white

---

## Spacing Scale
```
2px   — hairline borders, micro-adjustments
4px   — icon gaps, internal element spacing
8px   — compact gaps between inline elements
12px  — default gap between related items (most common after 16px)
16px  — standard padding unit, gutter between grid items
24px  — component internal padding, section sub-spacing
28px  — button padding height (vertical)
32px  — section padding, larger component gaps
48px  — section vertical rhythm, major block spacing
64px  — large section separation
80px  — hero section vertical padding
88px  — maximum section padding observed
```

**Container widths:**
- Max content width: `1440px` (main wrapper)
- Full-bleed sections: `100vw` with internal container constraints
- Side padding: `16px` mobile (implied), scales via `padding-global` class
- Section vertical padding: `80px` for hero, `64–88px` for content sections

---

## Border Radius Vocabulary
```
--radius-sm:     4px        — small inputs, toggle switches, minor rounded corners
--radius-md:     16px       — cards, modal containers, panels
--radius-lg:     24px       — city browse tiles, large feature cards
--radius-top:    0px 0px 8px 8px  — card bottom-only rounding (observed pattern)
--radius-asym:   0px 32px 32px  — top-only rounding for special elements
--radius-pill:   9999px     — pill buttons, tags, avatar containers (inferred)
```

The system uses asymmetrical radius patterns—notably `0px 0px 8px 8px` appearing frequently—which suggests cards that are sharp-edged at the top and rounded at the bottom, creating a subtle "tab" or "folder" aesthetic on stacked elements.

---

## Shadow Vocabulary
```
(no explicit box-shadows detected in extracted data)
```

The shadow philosophy here is notably flat or minimal. Cards and modals rely on **border definition**, **background contrast**, and **overlay treatments** (like the semi-transparent dark backdrop behind modals: `rgba(5, 9, 14, 0.4)`) rather than traditional drop shadows. This creates a cleaner, more modern appearance where elevation is communicated through layering and backdrop blur rather than shadow depth.

---

## Component Recipes

### Primary CTA Button
```css
background-color: #05090e;
color: #ffffff;
border: none;
border-radius: 0px; /* or small pill radius depending on context */
padding: 16px 32px;
font-family: "Noto Sans", sans-serif;
font-size: 14px;
font-weight: 500;
transition: background-color 0.3s ease-out;
cursor: pointer;
```
On hover: background darkens slightly or opacity reduces to `0.9`.

### Secondary / Ghost Button
```css
background-color: transparent;
color: #222222;
border: none;
border-radius: 0px;
padding: 8px 0;
font-family: "Noto Sans", sans-serif;
font-size: 14px;
font-weight: 500;
transition: color 0.3s, opacity 0.3s;
cursor: pointer;
position: relative;
```
Nav-style ghost buttons may show underline or chevron on hover. Dropdown toggles include chevron icons.

### Outlined Button (Country Selector)
```css
background-color: #ffffff;
color: #05090e;
border: 2px solid #d0d5df; /* or accent border when selected */
border-radius: 16px;
padding: 16px 24px;
font-family: "Noto Sans", sans-serif;
font-size: 16px;
font-weight: 400;
display: flex;
align-items: center;
justify-content: space-between;
gap: 12px;
transition: border-color 0.3s ease-out, background-color 0.3s ease-out;
cursor: pointer;
```
Selected state: border becomes teal/green tint matching host city branding, or uses accent color.

### Input / Search
```css
background-color: transparent;
color: #05090e;
border: none;
border-bottom: 1px solid #d0d5df;
border-radius: 0px;
padding: 12px 0;
font-family: "Noto Sans", sans-serif;
font-size: 16px;
font-weight: 400;
outline: none;
transition: border-color 0.3s;
```
Focus state: border-bottom color shifts to `#05090e`.

### Card (Modal Style)
```
- Background: pure white #ffffff
- Border-radius: 16px (uniform) or asymmetric 0 0 8px 8px
- Padding: 32–40px internal
- Shadow: none (relies on overlay backdrop)
- Border: none
- Close icon: top-right corner, 24×24px area, thin X stroke
```

### Card (City Browse Tile)
```
- Background: vibrant solid color per city (teal #4bd7e6, greens, reds)
- Border-radius: 24px (large rounding)
- Min-height: ~120–160px
- Content: centered city name in display font, all caps, white text
- Hover: slight scale transform or brightness shift
- Layout: horizontal scrollable row or responsive grid
```

### Navigation Header
```
- Position: fixed or sticky at top
- Background: #ffffff with subtle bottom border or shadow
- Height: ~64–80px
- Layout: flex row, space-between
- Left side: FIFA 26 logo mark + "ON LOCATION" label + Country selector dropdown
- Center: Main nav links (Single Matches, Match Offerings [dropdown], FAQ, More [dropdown])
- Right side: Schedule button (outlined/icon), Visa logo, Language selector (English + chevron), Log In / Sign Up link
- Mobile: hamburger menu icon triggers overlay panel
- Font: Noto Sans 14px weight 500 for links
- Special: "ON LOCATION" has a location pin icon prefix; country selector shows flag + "USA" + chevron
```

### Modal / Dialog (Country Chooser)
```
- Overlay: fixed viewport coverage, rgba(5, 9, 14, 0.4) backdrop
- Container: centered, max-width ~600px, aspect ratio roughly 4:3
- Background: #ffffff, border-radius: 16px
- Header: "CHOOSE COUNTRY" in Fwc 2026 Condensed ~28–32px, #05090e
- Body text: Noto Sans 16px #4b5667, explaining purchase context
- Options: three clickable rows, each containing flag icon + country name + chevron
- Selected state (United States): highlighted with colored border (teal/green tint)
- Close button: X icon top-right, ~24px from edges
- Animation: fade-in + zoom slightly (rcDialogZoomIn keyframe)
```

### Privacy Consent Banner
```
- Position: fixed bottom, full-width
- Background: #0f174f (deep navy blue variant)
- Text: white, Noto Sans 14px
- Buttons: three actions — "Preference Center" (white bg, dark text), "Reject All" (ghost/transparent), "I'm OK with that" (primary style, blue bg)
- Layout: text left, buttons right, vertically center-aligned
```

### Countdown Timer
```
- Container: centered in hero area, horizontal layout
- Each unit (Days/Hours/Minutes/Seconds): stacked number + label
- Number: Fwc 2026 Condensed, very large (~48–56px), white or light color
- Label: Noto Sans 12–14px, muted color, uppercase or capitalized
- Separator: colon or dot between units if present
```

---

## Motion & Animation

### Transition Tokens
```
--transition-fast:   background-color 0.3s ease-out;
--transition-color:  color 0.3s;
--transition-opacity:opacity 0.3s;
--transition-bg:     background-color 0.3s;
--transition-base:   0.35s;
--transform-base:    transform 0.25s;
```

Transitions are consistently timed at **~300ms** with `ease-out` easing, giving interactions a smooth but snappy feel without sluggishness. No springy or bouncy curves detected.

### Keyframe Animations
- `spin` — rotation animation (loading states, carousel indicators)
- `onetrust-fade-in` — consent banner entrance (fade from 0 to 1 opacity)
- `slide-down-custom` — dropdown panel reveal (translate Y from negative offset)
- `fontbulger` — likely a playful text weight/scale animation for interactive elements
- `shimmer` — loading skeleton shimmer effect
- `example` — demo/prototype animation placeholder
- `onEntry` — element entrance on scroll into view
- `onSelect` — selection state transition (scale or highlight)
- `ScaleEntry` — modal or card entrance with scale from 0.95→1
- `tagExit` — tag dismissal animation
- `scaleIn` — general scale-up reveal
- `growFromBottom` — expand from bottom edge upward
- `rcDialogZoomIn` / `rcDialogZoomOut` — modal zoom + fade entrance/exit
- `rcDialogFadeIn` / `rcDialogFadeOut` — modal overlay fade only

### Interaction Patterns
- **Hover on buttons/cards**: Background color shift or opacity reduction over 300ms
- **Dropdown menus**: Slide-down reveal with possible opacity fade
- **Modal open/close**: Zoom from 0.95 to 1.0 combined with backdrop fade-in
- **Scroll-triggered reveals**: Elements animate in (scale, fade, slide) when entering viewport
- **City card hover**: Slight scale transform (1.0 → 1.02) or brightness increase
- **Navigation sticky state**: Header may gain background/shadow on scroll (common pattern)

---

## Layout System

### Grid
- **Mobile** (<992px): Single column, full-width containers, stacked sections, hamburger nav
- **Tablet** (992px–1199px): Constrained multi-column, adjusted nav gap sizes per media query
- **Desktop** (1200px+): Full 1440px max-width container, multi-column grids for city cards (horizontal scroll or 4+ column grid)

The site uses Webflow's responsive classes (`w-nav`, `w-dropdown`) indicating a component-driven layout system with breakpoint-aware behaviors.

### Header Architecture
```
[Logo 26] [📍 ON LOCATION] [🇺🇸 USA ▾]     Single Matches  Match Offerings ▾  FAQ  More ▾     [📅 Schedule] [VISA] [English ▾]  Log In / Sign Up
←————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————→
                                                                 (sticky/fixed positioning, white bg, ~72px height)
```

### Hero Section
```
┌──────────────────────────────────────────────────────────────┐
│  [Soccer imagery L]          ⏱ 38  02  03  41    [Crowd R] │
│                             Days Hrs Min Sec                 │
│                                                              │
│         ████████████████████████████████████████████         │  ← Dark navy bg #0c1521
│         █  FIFA WORLD CUP 2026™                            █  │  ← Display font H1, 80px, white
│         █  Experience the best of it all with official...  █  │  ← Body text 16px, white
│         █  [CTA Button]  [Secondary CTA]                   █  │
│         ████████████████████████████████████████████         │
└──────────────────────────────────────────────────────────────┘
  (Full-bleed dark background, min-height ~70vh, centered content)
```

### City Browse Section
```
┌──────────────────────────────────────────────────────────────┐
│  BROWSE                                        Host City ▾ Team ◀ ▶│
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ...   │
│  │ ATLANTA  │ │ BOSTON   │ │ DALLAS   │ │ HOUSTON  │       │
│  │ (teal)   │ │ (green)  │ │ (teal)   │ │ (green)  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│  (Horizontal scroll or flex-wrap grid, 24px gap)            │
└──────────────────────────────────────────────────────────────┘
```

---

## Imagery Style
- **Photography**: High-action sports photography—players mid-play, stadium crowds, pitch-level angles
- **Treatment**: Images have rounded corners (8–16px), some with dark vignette overlays for text legibility
- **Color grading**: Warm tones on player shots, cool/blue atmospheric tones on crowd/stadium scenes
- **Framing**: Asymmetric placement within hero—images bleed to edges or float within composition
- **Role**: Imagery supports rather than dominates; text remains primary information carrier
- **Hero images**: Positioned left and right of central countdown/content area, partially cropped
- **No illustrations or 3D elements detected**—purely photographic with typographic overlays

---

## Icon System
- **Library**: Custom SVG (webflow-icons font detected for utility icons, plus custom SVG paths)
- **Specific icons observed**: 
  - Location pin (for "ON LOCATION")
  - Chevron/down arrow (dropdowns, selectors, country pickers)
  - Right arrow (country selector rows, pagination)
  - X/close (modal dismiss)
  - Hamburger menu (mobile nav)
  - Calendar icon (Schedule button)
  - Flag icons (country selectors—Canada 🇨🇦, Mexico 🇲🇽, USA 🇺🇸)
  - Visa logo (sponsor placement)
  - FIFA 26 logo mark (stylized "26")
- **Treatment**: Icons are 16–24px typically, stroke-based for UI icons (chevrons, close), fill-based for flags/logos
- **Alignment**: Vertically center-aligned with adjacent text, consistent 8px gap from text

---

## Recommended Frontend Stack
```
- Framework:      Next.js 15 (App Router) or Astro (for static-heavy landing)
- Styling:        Tailwind v4 (utility-first matches extracted class patterns)
- Fonts:          Google Fonts for Noto Sans; self-host FWC2026-UltraCondensedBlack.woff2 for display
- Animation:      Framer Motion (for scroll-triggered reveals, modal transitions) or vanilla CSS keyframes
- Icons:          Lucide React (for chevrons, arrows, X, calendar, map-pin) + custom SVG for flags/logo
- Component lib:  None (custom components) or Radix primitives for accessible modals/dropdowns
- Deployment:     Vercel or Netlify (Webflow-originated sites translate well)
```

---

## Design Principles
1. **Typographic Authority** — The ultra-condensed display face at extreme sizes (72–80px) is the hero of every layout; nothing competes with it. All other elements recede to let the type breathe.
2. **Contrast Through Compression** — Pairing a hyper-compressed bold headline font with an open, neutral sans-serif body creates intentional visual friction that signals energy and premium positioning.
3. **Flat Elevation** — Depth is achieved through layering (overlays, backdrops, color fields) rather than shadows. This keeps the aesthetic clean and modern while maintaining clear hierarchy.
4. **Color as Environment** — Deep navy backgrounds aren't just decorative; they create immersive "zones" (hero, footer, banner) that signal context shifts. White surfaces remain pristine for content consumption.
5. **Motion With Restraint** — Every transition takes exactly ~300ms. Animations serve function (revealing, selecting, confirming) not decoration. No parallax, no particle effects.
6. **Component Over Page** — Reusable patterns (city cards, country selectors, nav dropdowns) follow strict internal consistency so new pages can be assembled from existing atomic parts.
7. **Accessibility Through Contrast** — Text always meets WCAG AA ratios against its background (white on navy, near-black on white). Interactive elements have clear focus states.
8. **Global Event, Local Feel** — Country flags, city-specific colors, and localized currency references ground the global tournament identity in personal, geographic relevance for each user.