"use client";

// Global error boundary del App Router. Captura errores que ocurren
// durante el render al nivel del root layout y los reporta a Sentry.
//
// IMPORTANTE: este archivo DEBE vivir en app/global-error.tsx y
// renderizar <html>/<body> propios porque reemplaza el root layout
// cuando se activa. No podemos asumir que cargó nuestra CSS — los
// estilos van inline con los hex values literales de la paleta
// landing. Si Tailwind no llegó a cargar, igual se ve coherente.
//
// La estética matchea la landing: dark editorial, Anton para display,
// DM Mono para uppercase tracking, paleta `--color-landing-*` (hex
// hard-coded para resilience).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

const COLORS = {
  bg: "#0e1426",
  surface: "#161d32",
  text: "#f1ece0",
  textMuted: "#8a92a8",
  red: "#a33d3d",
  redHover: "#b74545",
  green: "#5c7847",
  gold: "#c8a053",
  line: "rgba(241, 236, 224, 0.14)",
};

const ADMIN_WHATSAPP =
  process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "5492914000000";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const waUrl = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(
    `Hola, tuve un error en Prode${error.digest ? ` (id: ${error.digest})` : ""}. ¿Pueden ayudarme?`,
  )}`;

  return (
    <html lang="es-AR">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          fontFamily:
            'var(--font-noto-sans, system-ui), "Segoe UI", sans-serif',
          background: COLORS.bg,
          color: COLORS.text,
          textAlign: "center",
        }}
      >
        {/* Eyebrow mono uppercase */}
        <div
          style={{
            fontFamily: 'var(--font-mono-data, "DM Mono"), monospace',
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.22em",
            color: COLORS.textMuted,
          }}
        >
          Error inesperado
        </div>

        {/* Hero Anton con underline gold */}
        <h1
          style={{
            fontFamily:
              'var(--font-display-condensed, "Anton"), "Arial Narrow Black", sans-serif',
            fontSize: "clamp(40px, 10vw, 64px)",
            textTransform: "uppercase",
            letterSpacing: "-0.005em",
            lineHeight: 0.9,
            margin: 0,
            maxWidth: "20ch",
          }}
        >
          <span
            style={{
              display: "inline-block",
              borderBottom: `4px solid ${COLORS.red}`,
              paddingBottom: "4px",
            }}
          >
            Algo salió mal
          </span>
        </h1>

        <p
          style={{
            margin: 0,
            maxWidth: "44ch",
            fontSize: "15px",
            lineHeight: 1.6,
            color: COLORS.textMuted,
          }}
        >
          Tuvimos un error inesperado. Ya lo reportamos al sistema. Podés
          intentar recargar la página o avisarnos por WhatsApp si sigue
          fallando.
        </p>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            width: "100%",
            maxWidth: "320px",
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "14px 24px",
              borderRadius: "2px",
              border: "none",
              background: COLORS.red,
              color: COLORS.text,
              fontFamily: 'var(--font-mono-data, "DM Mono"), monospace',
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              cursor: "pointer",
              minHeight: "48px",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                COLORS.redHover;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                COLORS.red;
            }}
          >
            Recargar página
          </button>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "14px 24px",
              borderRadius: "2px",
              border: `1px solid ${COLORS.line}`,
              background: "transparent",
              color: COLORS.text,
              fontFamily: 'var(--font-mono-data, "DM Mono"), monospace',
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              textDecoration: "none",
              minHeight: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.borderColor =
                COLORS.text;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.borderColor =
                COLORS.line;
            }}
          >
            Avisanos por WhatsApp
          </a>
        </div>

        {/* Error digest para reporte (solo si Next lo asignó) */}
        {error.digest ? (
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono-data, "DM Mono"), monospace',
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: COLORS.textMuted,
            }}
          >
            ID del error: <strong style={{ color: COLORS.gold }}>{error.digest}</strong>
          </p>
        ) : null}
      </body>
    </html>
  );
}
