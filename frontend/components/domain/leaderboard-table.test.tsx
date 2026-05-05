import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardTable } from "./leaderboard-table";
import type { LeaderboardEntry } from "@/lib/api/types";

// Single-entry case (compat con tests pre-multi-prode): cada user
// tiene 1 entry (entryId presente, sin alias, entryPosition=1) y por
// lo tanto no aparece sufijo "(#N)" en el display name.
const entries: LeaderboardEntry[] = [
  { position: 1, entryId: "e1", userId: "u1", firstName: "Ana", lastName: "Gomez", alias: null, entryPosition: 1, totalPoints: 100 },
  { position: 2, entryId: "e2", userId: "u2", firstName: "Beto", lastName: "Lopez", alias: null, entryPosition: 1, totalPoints: 95 },
  { position: 3, entryId: "e3", userId: "u3", firstName: "Cami", lastName: "Diaz", alias: null, entryPosition: 1, totalPoints: 89 },
  { position: 4, entryId: "e4", userId: "u4", firstName: "Dami", lastName: "Ruiz", alias: null, entryPosition: 1, totalPoints: 70 },
];

describe("LeaderboardTable", () => {
  it("renders all entries when not loading", () => {
    render(<LeaderboardTable entries={entries} />);
    expect(screen.getByText(/Ana Gomez/)).toBeInTheDocument();
    expect(screen.getByText(/Beto Lopez/)).toBeInTheDocument();
    expect(screen.getByText(/Cami Diaz/)).toBeInTheDocument();
    expect(screen.getByText(/Dami Ruiz/)).toBeInTheDocument();
  });

  it("renders table headers", () => {
    render(<LeaderboardTable entries={entries} />);
    expect(screen.getByText("Pos")).toBeInTheDocument();
    expect(screen.getByText("Jugador")).toBeInTheDocument();
    expect(screen.getByText("Puntos")).toBeInTheDocument();
  });

  it("renders skeleton when loading", () => {
    render(<LeaderboardTable entries={[]} loading />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders empty state with default message when no entries", () => {
    render(<LeaderboardTable entries={[]} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
    expect(screen.getByText("Sin posiciones cargadas")).toBeInTheDocument();
  });

  it("renders empty state with custom message", () => {
    render(<LeaderboardTable entries={[]} emptyMessage="Sin miembros" />);
    expect(screen.getByText("Sin miembros")).toBeInTheDocument();
  });

  it("invokes onRowClick when a row is clicked", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<LeaderboardTable entries={entries} onRowClick={onRowClick} />);
    await user.click(screen.getByRole("button", { name: /Ana Gomez/i }));
    expect(onRowClick).toHaveBeenCalledWith("u1");
  });

  it("highlights current user row (legacy currentUserId path)", () => {
    render(<LeaderboardTable entries={entries} currentUserId="u3" />);
    expect(screen.getByText("VOS")).toBeInTheDocument();
  });

  // ── Multi-prode: display name lógica + currentEntryId ─────────
  it("highlights only the active entry when user has multiple entries", () => {
    const multi: LeaderboardEntry[] = [
      { position: 1, entryId: "e1", userId: "u1", firstName: "Juan", lastName: "Perez", alias: null, entryPosition: 1, totalPoints: 87 },
      { position: 5, entryId: "e2", userId: "u1", firstName: "Juan", lastName: "Perez", alias: null, entryPosition: 2, totalPoints: 32 },
    ];
    render(<LeaderboardTable entries={multi} currentEntryId="e2" />);
    const vosBadges = screen.getAllByText("VOS");
    expect(vosBadges).toHaveLength(1);
    const buttons = screen.getAllByRole("button");
    const highlighted = buttons.find(
      (b) => b.getAttribute("data-current-user") === "true",
    );
    expect(highlighted?.getAttribute("data-position")).toBe("5");
  });

  it("renders display name with alias when present", () => {
    const withAlias: LeaderboardEntry[] = [
      { position: 1, entryId: "e1", userId: "u1", firstName: "Juan", lastName: "Perez", alias: "Mi prode optimista", entryPosition: 1, totalPoints: 87 },
    ];
    render(<LeaderboardTable entries={withAlias} />);
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument();
    expect(screen.getByText(/· Mi prode optimista/)).toBeInTheDocument();
  });

  it("renders '(#N)' suffix when user has >1 entries and no alias", () => {
    const multi: LeaderboardEntry[] = [
      { position: 1, entryId: "e1", userId: "u1", firstName: "Juan", lastName: "Perez", alias: null, entryPosition: 1, totalPoints: 87 },
      { position: 5, entryId: "e2", userId: "u1", firstName: "Juan", lastName: "Perez", alias: null, entryPosition: 2, totalPoints: 32 },
    ];
    render(<LeaderboardTable entries={multi} />);
    expect(screen.getByText("(#1)")).toBeInTheDocument();
    expect(screen.getByText("(#2)")).toBeInTheDocument();
  });

  it("does NOT add '(#N)' suffix when each user has only 1 entry", () => {
    render(<LeaderboardTable entries={entries} />);
    expect(screen.queryByText(/\(#\d+\)/)).not.toBeInTheDocument();
  });
});
