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
  // iOS Safari: navigator.standalone (boolean).
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if ("standalone" in nav && nav.standalone === true) return true;
  // Android Chrome y otros: matchMedia.
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
 * En iOS muestra los pasos especificos del menu Compartir; en
 * Android, el equivalente del menu del navegador.
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

  return (
    <aside
      className={cn(
        "rounded-md border border-[var(--color-prode-border)] bg-[var(--color-prode-surface)] p-4",
        className,
      )}
      aria-label={
        platform === "ios"
          ? "Como agregar la app al inicio en iOS"
          : "Como agregar la app al inicio en Android"
      }
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-white p-2 border border-[var(--color-prode-border)]">
          <Smartphone className="h-5 w-5 text-[var(--color-prode-near-black)]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-black uppercase tracking-wide text-[var(--color-prode-near-black)]">
            Instala la app
          </p>
          {platform === "ios" ? (
            <ol className="mt-2 space-y-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
              <li className="inline-flex items-center gap-1">
                <span className="font-bold text-[var(--color-prode-near-black)]">1.</span>
                Toca <Share className="inline h-4 w-4 align-text-bottom" aria-label="boton compartir" /> Compartir abajo de Safari.
              </li>
              <li className="inline-flex items-center gap-1">
                <span className="font-bold text-[var(--color-prode-near-black)]">2.</span>
                Toca <span className="font-medium text-[var(--color-prode-near-black)]">"Agregar a inicio"</span>.
              </li>
              <li className="inline-flex items-center gap-1">
                <span className="font-bold text-[var(--color-prode-near-black)]">3.</span>
                Confirma con <Plus className="inline h-4 w-4 align-text-bottom" aria-hidden /> Agregar.
              </li>
            </ol>
          ) : (
            <ol className="mt-2 space-y-1 font-sans text-sm text-[var(--color-prode-text-secondary)]">
              <li>
                <span className="font-bold text-[var(--color-prode-near-black)]">1.</span>{" "}
                Toca el menu del navegador (3 puntos arriba a la derecha).
              </li>
              <li>
                <span className="font-bold text-[var(--color-prode-near-black)]">2.</span>{" "}
                Elegi <span className="font-medium text-[var(--color-prode-near-black)]">"Agregar a la pantalla principal"</span>.
              </li>
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}
