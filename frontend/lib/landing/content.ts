/**
 * Single source of truth para todo el copy y datos visibles de la landing.
 * Editar acá ajusta la landing sin tocar JSX.
 *
 * Convención: strings con `**foo**` se renderizan como <strong> usando
 * el helper `inlineBold()` (lib/landing/inline-bold.tsx).
 */
export const LANDING = {
  topbar: {
    brand: "PRODE MUNDIAL 2026 · BAHÍA BLANCA",
    loginCta: "Iniciar sesión",
    loginHref: "/login",
  },

  hero: {
    eyebrowPrefix: "INSCRIPCIÓN ABIERTA · MUNDIAL 2026 · ARRANCA EN",
    eyebrowSuffix: "DÍAS",
    h1Lines: ["JUGÁ EL PRODE.", "GANÁ EN EFECTIVO."] as const,
    underlineSecondLine: true,
    lede:
      "Pronosticá los partidos del Mundial fase por fase. Sumás puntos, escalás el ranking, **ganás premios en efectivo**. Y cada inscripción banca al equipo de handball del Tiro Federal que viaja al Nacional C en Comodoro Rivadavia.",
    primaryCta: "Inscribirme · $10.000",
    primaryHref: "/inscripcion",
    secondaryCta: "Inscribirme por WhatsApp",
    secondaryHref:
      "https://wa.me/5492914231087?text=hola%20quiero%20inscribirme%20al%20prode",
    secondaryExternal: true,
    secondaryIcon: "whatsapp",
    miniMeta: "CIERRA 11/JUN/26 · MERCADOPAGO · TRANSFERENCIA · EFECTIVO EN EL CLUB",
  },

  stats: [
    { n: "8", l: "Semanas de juego", color: "default" },
    { n: "48", l: "Selecciones", color: "green" },
    { n: "7", l: "Fases", color: "blue" },
    { n: "1", l: "Causa", color: "red" },
  ] as const,

  countdown: {
    targetIso: "2026-06-11T12:00:00-03:00",
    eyebrow: "Cierre de inscripción",
    titleA: "11 de junio.",
    titleB: "No más.",
  },

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

  points: {
    eyebrow: "Sistema de puntos",
    title: "Cuánto vale cada acierto.",
    rules: [
      { label: "Resultado exacto", small: "2-1 dijiste, 2-1 fue.", pts: 5, accent: "green" },
      {
        label: "Ganador + diferencia exacta",
        small: "Acertaste el ganador y la diferencia.",
        pts: 3,
        accent: "blue",
      },
      {
        label: "Empate acertado, marcador distinto",
        small: "Dijiste 1-1, fue 2-2.",
        pts: 2,
        accent: "blue",
      },
      {
        label: "Solo el ganador",
        small: "Acertaste quién, no por cuánto.",
        pts: 1,
        accent: "red",
      },
    ] as const,
    note:
      "Los puntos se multiplican según la fase: **x1 grupos · x1.5 dieciseisavos · x2 octavos · x3 cuartos · x4 semis · x5 final**. Acertar la final exacta vale 25 puntos.",
    noteCta: "Reglamento completo →",
    noteCtaHref: "/reglamento",
  },

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

  final: {
    titleA: "Estás a un click",
    titleB: "de jugar.",
    sub:
      "Inscripción $10.000 · MercadoPago, transferencia o efectivo en el club. La carga abre apenas pagás.",
    cta: "Quiero jugar",
    href: "/inscripcion",
  },

  footer: {
    columns: [
      {
        title: "Organiza",
        body: "Club Tiro Federal · Bahía Blanca · 2026",
        muted:
          "Iniciativa solidaria del equipo de handball del club. Abierta a todo el que quiera jugar.",
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
} as const;
