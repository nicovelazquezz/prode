import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EntrySwitcher } from "./entry-switcher";
import {
  ActiveEntryContext,
  type ActiveEntryContextValue,
} from "@/providers/active-entry-provider";
import type { EntrySummary } from "@/lib/api/types";

// next/navigation hooks: el componente sólo los usa para limpiar
// `?entry=` después de seleccionar. Mockeamos minimal.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/predicciones",
}));

function buildEntry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: "e1",
    userId: "u1",
    position: 1,
    alias: null,
    status: "ACTIVE",
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    stats: {
      predictionsCount: 0,
      totalPoints: 0,
      rank: null,
      specialPredictionLocked: false,
    },
    ...overrides,
  };
}

function buildCtx(
  overrides: Partial<ActiveEntryContextValue> = {},
): ActiveEntryContextValue {
  const entries = overrides.entries ?? [buildEntry()];
  return {
    entries,
    activeEntry: entries[0] ?? null,
    setActiveEntry: vi.fn(),
    isLoading: false,
    canCreateMore: true,
    ...overrides,
  };
}

function renderWithCtx(ctx: ActiveEntryContextValue, onCreateNew = vi.fn()) {
  // QueryClient requerido porque EntrySwitcher ahora usa
  // useMutation/useQueryClient para el flujo de renombrar entry.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveEntryContext.Provider value={ctx}>
        <EntrySwitcher onCreateNew={onCreateNew} />
      </ActiveEntryContext.Provider>
    </QueryClientProvider>,
  );
}

describe("EntrySwitcher", () => {
  it("loading: renders a skeleton", () => {
    renderWithCtx(buildCtx({ isLoading: true, entries: [], activeEntry: null }));
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).not.toBeNull();
  });

  it("0 entries: renders nothing", () => {
    const { container } = renderWithCtx(
      buildCtx({ entries: [], activeEntry: null }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("1 entry without alias: shows 'Mi prode' (no #N suffix)", () => {
    renderWithCtx(buildCtx());
    expect(screen.getByRole("button", { name: /cambiar de prode/i }))
      .toHaveTextContent("Mi prode");
  });

  it("1 entry with alias: shows alias", () => {
    const ctx = buildCtx({
      entries: [buildEntry({ alias: "Optimista" })],
      activeEntry: buildEntry({ alias: "Optimista" }),
    });
    renderWithCtx(ctx);
    expect(screen.getByRole("button", { name: /cambiar de prode/i }))
      .toHaveTextContent("Optimista");
  });

  it("2+ entries without alias: shows '#N' suffix in fallback display", () => {
    const e1 = buildEntry({ id: "e1", position: 1 });
    const e2 = buildEntry({ id: "e2", position: 2 });
    const ctx = buildCtx({ entries: [e1, e2], activeEntry: e2 });
    renderWithCtx(ctx);
    expect(screen.getByRole("button", { name: /cambiar de prode/i }))
      .toHaveTextContent("Mi prode #2");
  });

  it("opens dropdown and lists entries with stats", async () => {
    const user = userEvent.setup();
    const e1 = buildEntry({
      id: "e1",
      position: 1,
      alias: "Serio",
      stats: {
        predictionsCount: 10,
        totalPoints: 47,
        rank: 18,
        specialPredictionLocked: false,
      },
    });
    const e2 = buildEntry({
      id: "e2",
      position: 2,
      stats: {
        predictionsCount: 3,
        totalPoints: 12,
        rank: 51,
        specialPredictionLocked: false,
      },
    });
    renderWithCtx(buildCtx({ entries: [e1, e2], activeEntry: e1 }));

    await user.click(
      screen.getByRole("button", { name: /cambiar de prode/i }),
    );

    expect(await screen.findByText("Mis prodes")).toBeInTheDocument();
    // "Serio" aparece tanto en el trigger como en la lista; sólo
    // verificamos la fila de stats en el dropdown.
    expect(screen.getByText(/47 pts · pos 18/)).toBeInTheDocument();
    expect(screen.getByText(/12 pts · pos 51/)).toBeInTheDocument();
    // El item del entry secundario sí se renderiza una sola vez.
    expect(screen.getByText("Mi prode #2")).toBeInTheDocument();
  });

  it("clicking an entry calls setActiveEntry with its id", async () => {
    const user = userEvent.setup();
    const setActiveEntry = vi.fn();
    const e1 = buildEntry({ id: "e1", position: 1 });
    const e2 = buildEntry({ id: "e2", position: 2, alias: "Otro" });
    renderWithCtx(
      buildCtx({
        entries: [e1, e2],
        activeEntry: e1,
        setActiveEntry,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: /cambiar de prode/i }),
    );
    await user.click(await screen.findByText("Otro"));

    expect(setActiveEntry).toHaveBeenCalledWith("e2");
  });

  it("clicking 'Crear otro prode' invokes onCreateNew when canCreateMore=true", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();
    renderWithCtx(buildCtx({ canCreateMore: true }), onCreateNew);

    await user.click(
      screen.getByRole("button", { name: /cambiar de prode/i }),
    );
    await user.click(await screen.findByText("Crear otro prode"));

    expect(onCreateNew).toHaveBeenCalledOnce();
  });

  it("crear otro prode disabled when canCreateMore=false (cap reached)", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();
    renderWithCtx(buildCtx({ canCreateMore: false }), onCreateNew);

    await user.click(
      screen.getByRole("button", { name: /cambiar de prode/i }),
    );
    expect(
      await screen.findByText(/llegaste al máximo configurado/i),
    ).toBeInTheDocument();
    // Click should not invoke
    await user.click(screen.getByText("Crear otro prode"));
    expect(onCreateNew).not.toHaveBeenCalled();
  });
});
