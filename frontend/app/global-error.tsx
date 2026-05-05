"use client";

// Global error boundary for the App Router. Catches errors thrown during
// rendering at the root layout level and reports them to Sentry. The capture
// is a no-op when no DSN is configured.
//
// This file MUST live at app/global-error.tsx and define <html>/<body>
// because it replaces the root layout when triggered.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

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

  return (
    <html lang="es-AR">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
          textAlign: "center",
          background: "#ffffff",
          color: "#05090e",
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>
          Algo salio mal
        </h1>
        <p style={{ maxWidth: "32ch", margin: 0, opacity: 0.7 }}>
          Tuvimos un error inesperado. Ya lo reportamos. Probalo de nuevo.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "12px 24px",
            borderRadius: "8px",
            border: "2px solid #05090e",
            background: "#ffffff",
            color: "#05090e",
            fontSize: "16px",
            fontWeight: 600,
            cursor: "pointer",
            minHeight: "44px",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
