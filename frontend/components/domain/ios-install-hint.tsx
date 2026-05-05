"use client";

import { useEffect, useState } from "react";
import { Smartphone, Share, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/**
 * Detecta si la app esta corriendo como PWA standalone. iOS Safari
 * expone `window.navigator.standalone`; el resto usa el media query
 * `display-mode: standalone`.
 */
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if ("standalone" in nav && nav.standalone === true) return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(display-mode: standalone)").matches;
  }
  return false;
}

interface IosInstallHintProps {
  className?: string;
}

/**
 * Card explicativa "Agregar a inicio". Solo se renderiza en mobile
 * (iOS o Android) cuando la app NO esta en modo standalone.
 *
 * Visual: dark editorial (surface bg + line-strong border, typography
 * mono uppercase para steps + display title).
 *
 * SSR-safe: renderiza nada en server, decide en cliente despues
 * del primer mount (evita hydration mismatch).
 */
export function IosInstallHint({ className }: IosInstallHintProps) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsStandalone(detectStandalone());
  }, []);

  if (platform === null) return null;
  if (isStandalone) return null;
  if (platform === "other") return null;

  const stepNumber =
    "font-[family-name:var(--font-landing-display)] text-base text-[var(--color-landing-gold)] mr-2";

  return (
    <aside
      className={cn(
        "rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] p-5",
        className,
      )}
      aria-label={
        platform === "ios"
          ? "Como agregar la app al inicio en iOS"
          : "Como agregar la app al inicio en Android"
      }
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-sm bg-[var(--color-landing-surface-2)] p-2 border border-[var(--color-landing-line-strong)]">
          <Smartphone
            className="h-5 w-5 text-[var(--color-landing-text)]"
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-landing-display)] text-xl uppercase tracking-tight leading-none text-[var(--color-landing-text)]">
            Instalá la app
          </p>
          {platform === "ios" ? (
            <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              <li>
                <span className={stepNumber}>1.</span>
                Tocá{" "}
                <Share
                  className="inline h-4 w-4 align-text-bottom text-[var(--color-landing-text)]"
                  aria-label="boton compartir"
                />{" "}
                Compartir abajo de Safari.
              </li>
              <li>
                <span className={stepNumber}>2.</span>
                Tocá{" "}
                <span className="text-[var(--color-landing-text)]">
                  "Agregar a inicio"
                </span>
                .
              </li>
              <li>
                <span className={stepNumber}>3.</span>
                Confirmá con{" "}
                <Plus
                  className="inline h-4 w-4 align-text-bottom text-[var(--color-landing-text)]"
                  aria-hidden
                />{" "}
                Agregar.
              </li>
            </ol>
          ) : (
            <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
              <li>
                <span className={stepNumber}>1.</span>
                Tocá el menú del navegador (3 puntos arriba a la derecha).
              </li>
              <li>
                <span className={stepNumber}>2.</span>
                Elegí{" "}
                <span className="text-[var(--color-landing-text)]">
                  "Agregar a la pantalla principal"
                </span>
                .
              </li>
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}
