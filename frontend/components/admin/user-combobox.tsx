"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { listUsers } from "@/lib/api/admin";

/**
 * Forma mínima del user para el autocomplete. Se comparte con
 * cualquier consumer que solo quiera el id (notificaciones,
 * futuros flujos de admin que necesiten elegir un usuario).
 */
export interface UserComboboxOption {
  id: string;
  dni: string;
  firstName: string;
  lastName: string;
}

interface UserComboboxProps {
  value: UserComboboxOption | null;
  onSelect: (user: UserComboboxOption | null) => void;
  placeholder?: string;
  /**
   * Sólo busca cuando el query tiene ≥ minChars (default 2) para
   * evitar pegarle al endpoint con cada keystroke.
   */
  minChars?: number;
}

const DEBOUNCE_MS = 300;

/**
 * Autocomplete de usuarios contra `GET /admin/users?search=`.
 * Match server-side case-insensitive en firstName/lastName y substring
 * en DNI (digits-only). El componente no asume nada del dominio que lo
 * consume — sólo emite `onSelect(user | null)`.
 *
 * El padre decide qué hacer con el id (notificar, asignar pago, etc.).
 */
export function UserCombobox({
  value,
  onSelect,
  placeholder = "Buscar por DNI o nombre",
  minChars = 2,
}: UserComboboxProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce 300ms — typeahead rápido sin spammear al backend.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Cierro el dropdown si el click cae afuera del contenedor.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const enabled = useMemo(
    () => debounced.trim().length >= minChars,
    [debounced, minChars],
  );

  const { data, isFetching } = useQuery({
    queryKey: ["admin-users-search", debounced],
    queryFn: () =>
      listUsers({ search: debounced.trim(), pageSize: 10, page: 1 }),
    enabled,
    staleTime: 30_000,
  });

  // Si ya hay un user seleccionado, mostramos el chip en lugar del input.
  if (value) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center justify-between rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 py-2.5">
          <div className="flex flex-col">
            <span className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)]">
              DNI {value.dni}
            </span>
            <span className="text-sm text-[var(--color-landing-text)]">
              {value.firstName} {value.lastName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
              setDebounced("");
            }}
            aria-label="Quitar selección"
            className="rounded-sm p-1 text-[var(--color-landing-text-muted)] hover:bg-[var(--color-landing-line-soft)] hover:text-[var(--color-landing-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const results = data?.data ?? [];

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3">
        <Search className="mr-2 h-4 w-4 shrink-0 text-[var(--color-landing-text-muted)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex h-11 w-full bg-transparent py-2.5 text-base text-[var(--color-landing-text)] outline-none placeholder:text-[var(--color-landing-text-muted)]"
        />
      </div>

      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] shadow-lg">
          {isFetching ? (
            <div className="px-3 py-3 text-sm text-[var(--color-landing-text-muted)]">
              Buscando…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--color-landing-text-muted)]">
              Sin resultados.
            </div>
          ) : (
            <ul className="py-1">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({
                        id: u.id,
                        dni: u.dni,
                        firstName: u.firstName,
                        lastName: u.lastName,
                      });
                      setOpen(false);
                      setQuery("");
                      setDebounced("");
                    }}
                    className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--color-landing-line-soft)] focus:bg-[var(--color-landing-line-soft)] focus:outline-none"
                  >
                    <span className="font-[family-name:var(--font-landing-mono)] text-[12px] text-[var(--color-landing-text-muted)]">
                      {u.dni}
                    </span>
                    <span className="text-[var(--color-landing-text)]">
                      {u.firstName} {u.lastName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && !enabled && query.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-sm border border-[var(--color-landing-line-strong)] bg-[var(--color-landing-surface)] px-3 py-3 text-sm text-[var(--color-landing-text-muted)] shadow-lg">
          Escribí al menos {minChars} caracteres.
        </div>
      )}
    </div>
  );
}
