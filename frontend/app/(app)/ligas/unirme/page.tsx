"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { joinLeague } from "@/lib/api/leagues";
import { queryKeys } from "@/lib/api/queryKeys";
import { cn } from "@/lib/utils/cn";

const VALID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const codeRegex = new RegExp(`^[${VALID_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * /ligas/unirme — input OTP de 6 chars (uppercase auto, alfabeto
 * exacto del backend `generateInviteCode`). Lee `?code=xxx` del
 * query param para auto-fill via Suspense + useSearchParams.
 *
 * Visual: dark editorial. Cada char es un slot oscuro con borde
 * line-strong, focus → outline gold + border-bottom green.
 */
export default function UnirmePage() {
  return (
    <section className="mx-auto max-w-md px-4 pb-20 pt-10 md:px-8 md:pb-24 md:pt-14">
      <Link
        href="/ligas"
        className="inline-flex items-center gap-2 mb-4 font-[family-name:var(--font-landing-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--color-landing-text-muted)] transition-colors hover:text-[var(--color-landing-text)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Volver
      </Link>

      <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
        Mini-liga
      </div>
      <h1 className="font-[family-name:var(--font-landing-display)] text-4xl md:text-5xl uppercase tracking-tight leading-[0.85] text-[var(--color-landing-text)]">
        <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
          Unirme.
        </span>
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-landing-text-muted)]">
        Pegale el código de 6 caracteres que te pasaron.
      </p>

      <Suspense fallback={<JoinFormSkeleton />}>
        <JoinForm />
      </Suspense>
    </section>
  );
}

function JoinFormSkeleton() {
  return (
    <div className="mt-8 flex justify-center gap-2" aria-busy="true">
      {[...Array(CODE_LENGTH)].map((_, i) => (
        <div
          key={i}
          className="h-14 w-12 rounded-sm bg-[var(--color-landing-surface)] border border-[var(--color-landing-line)] animate-pulse"
        />
      ))}
    </div>
  );
}

function JoinForm() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [chars, setChars] = useState<string[]>(() =>
    Array(CODE_LENGTH).fill(""),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Auto-fill desde ?code=xxx (uppercase, filtrado al alfabeto valido).
  useEffect(() => {
    const raw = params?.get("code") ?? null;
    if (!raw) return;
    const sanitized = raw
      .toUpperCase()
      .split("")
      .filter((c) => VALID_ALPHABET.includes(c))
      .slice(0, CODE_LENGTH);
    if (sanitized.length === 0) return;
    const next = Array(CODE_LENGTH).fill("");
    sanitized.forEach((c, i) => {
      next[i] = c;
    });
    setChars(next);
    // Foco al ultimo char preserved
    const focusIdx = Math.min(sanitized.length, CODE_LENGTH - 1);
    inputsRef.current[focusIdx]?.focus();
  }, [params]);

  const code = chars.join("");
  const isValid = codeRegex.test(code);

  const joinMutation = useMutation({
    mutationFn: (inviteCode: string) => joinLeague({ inviteCode }),
    onSuccess: (league) => {
      qc.invalidateQueries({ queryKey: queryKeys.leagues.all() });
      toast.success(`Te uniste a "${league.name}"`);
      router.push(`/leaderboard/liga/${league.id}`);
    },
    onError: async (err: Error) => {
      let message = "No pudimos unirte a la liga.";
      if (err instanceof HTTPError) {
        const status = err.response.status;
        if (status === 404) message = "Liga no encontrada. Verifica el codigo.";
        else if (status === 409) {
          // Backend devuelve 409 con detail message — intentamos parsear.
          try {
            const body = (await err.response.clone().json()) as {
              message?: string;
            };
            const detail = body?.message?.toLowerCase() ?? "";
            if (detail.includes("llena") || detail.includes("full")) {
              message = "Liga llena, no acepta mas miembros.";
            } else {
              message = "Ya sos miembro de esta liga.";
            }
          } catch {
            message = "Ya sos miembro de esta liga.";
          }
        }
      }
      setSubmitError(message);
      toast.error(message);
    },
  });

  const handleChange = (index: number, value: string) => {
    setSubmitError(null);
    const sanitized = value
      .toUpperCase()
      .split("")
      .filter((c) => VALID_ALPHABET.includes(c));

    if (sanitized.length === 0) {
      const next = [...chars];
      next[index] = "";
      setChars(next);
      return;
    }

    const next = [...chars];
    let cursor = index;
    for (const c of sanitized) {
      if (cursor >= CODE_LENGTH) break;
      next[cursor] = c;
      cursor += 1;
    }
    setChars(next);
    const focusIdx = Math.min(cursor, CODE_LENGTH - 1);
    inputsRef.current[focusIdx]?.focus();
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !chars[index] && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
      const next = [...chars];
      next[index - 1] = "";
      setChars(next);
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    } else if (e.key === "Enter" && isValid) {
      e.preventDefault();
      joinMutation.mutate(code);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || joinMutation.isPending) return;
    joinMutation.mutate(code);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-6">
      <div
        role="group"
        aria-label="Codigo de invitacion"
        className="flex justify-center gap-2"
      >
        {Array.from({ length: CODE_LENGTH }).map((_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            value={chars[i] ?? ""}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            aria-label={`Caracter ${i + 1}`}
            className={cn(
              "h-14 w-12 text-center",
              "font-[family-name:var(--font-landing-display)] text-3xl uppercase tabular-nums",
              "rounded-sm bg-[var(--color-landing-surface)]",
              "border-2 transition-colors duration-200",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]",
              submitError
                ? "border-[var(--color-landing-red)] text-[var(--color-landing-red)]"
                : "border-[var(--color-landing-line-strong)] focus:border-[var(--color-landing-green)] text-[var(--color-landing-text)]",
            )}
          />
        ))}
      </div>

      {submitError ? (
        <p
          role="alert"
          className="text-center font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--color-landing-red)]"
        >
          {submitError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!isValid || joinMutation.isPending}
        className="inline-flex w-full items-center justify-center rounded-sm bg-[var(--color-landing-red)] px-6 py-4 font-[family-name:var(--font-landing-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {joinMutation.isPending ? "Uniendo..." : "Unirme"}
      </button>
    </form>
  );
}
