"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const DISMISSED_KEY = "prode.iosInstallBanner.dismissedAt";
/**
 * Si el user cerró el banner, no vuelve. Si querés que reaparezca
 * después de N días, validar `Date.now() - dismissedAt > N*24h` antes
 * de devolver dismissed. Por ahora: dismiss permanente — el user
 * eligió no instalarla y respetamos.
 */
const DISMISS_FOREVER = true;

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if ("standalone" in nav && nav.standalone === true) return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(display-mode: standalone)").matches;
  }
  return false;
}

interface IosInstallBannerProps {
  className?: string;
}

/**
 * Banner sticky bottom para invitar a instalar la app. Solo se muestra:
 *   - En iOS Safari (Apple no permite el botón nativo "instalar app")
 *   - Cuando NO está corriendo como PWA standalone
 *   - Cuando el user no lo cerró antes (localStorage)
 *
 * UX:
 *   - Aparece deslizando desde abajo después del primer paint.
 *   - Una sola línea con el ícono + texto + X.
 *   - Click en X → dismiss permanente (se persiste fecha en localStorage).
 *   - Click en el banner → expande con los 3 pasos (toca Compartir → Agregar a inicio).
 *
 * SSR-safe: render nulo en server. La detección corre solo en cliente
 * después del primer mount para evitar hydration mismatch.
 *
 * Diferencia con IosInstallHint:
 *   - IosInstallHint = card prominente para una sección específica (/perfil).
 *   - IosInstallBanner = banner sticky para mostrar pasivamente en el
 *     flow principal (lo monta el layout autenticado).
 */
export function IosInstallBanner({ className }: IosInstallBannerProps) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsStandalone(detectStandalone());
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(DISMISSED_KEY);
      if (stored && DISMISS_FOREVER) setDismissed(true);
    }
  }, []);

  if (platform !== "ios" || isStandalone || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Instalá Prode en tu pantalla de inicio"
      className={cn(
        "fixed left-0 right-0 z-30 mx-auto max-w-2xl px-4",
        // Sobre el bottom-nav mobile (h-16) — dejamos espacio extra
        // para que no quede tapado.
        "bottom-20 md:bottom-4",
        className,
      )}
    >
      <div className="rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-3 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-landing-gold)]"
          aria-expanded={expanded}
        >
          <div className="shrink-0 rounded-sm bg-[var(--color-landing-surface-2)] p-2 border border-[var(--color-landing-line-strong)]">
            <Smartphone
              className="h-4 w-4 text-[var(--color-landing-gold)]"
              aria-hidden
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)]">
              Instalá Prode en tu iPhone
            </p>
            <p className="mt-0.5 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--color-landing-text-muted)]">
              {expanded ? "Ocultar pasos" : "Tocá para ver cómo"}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-sm text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)] hover:bg-[var(--color-landing-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-landing-gold)]"
            aria-label="Cerrar y no volver a mostrar"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </button>
        {expanded ? (
          <div className="border-t border-[var(--color-landing-line)] px-3 py-3">
            <ol className="space-y-1.5 text-xs leading-relaxed text-[var(--color-landing-text-muted)]">
              <li>
                <span className="font-[family-name:var(--font-landing-display)] text-sm text-[var(--color-landing-gold)] mr-1">
                  1.
                </span>
                Tocá{" "}
                <Share
                  className="inline h-3.5 w-3.5 align-text-bottom text-[var(--color-landing-text)]"
                  aria-label="botón compartir"
                />{" "}
                Compartir abajo de Safari
              </li>
              <li>
                <span className="font-[family-name:var(--font-landing-display)] text-sm text-[var(--color-landing-gold)] mr-1">
                  2.
                </span>
                Tocá{" "}
                <span className="text-[var(--color-landing-text)]">
                  "Agregar a inicio"
                </span>
              </li>
              <li>
                <span className="font-[family-name:var(--font-landing-display)] text-sm text-[var(--color-landing-gold)] mr-1">
                  3.
                </span>
                Confirmá con{" "}
                <span className="text-[var(--color-landing-text)]">
                  Agregar
                </span>
              </li>
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}
