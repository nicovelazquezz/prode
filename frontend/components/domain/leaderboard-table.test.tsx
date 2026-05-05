import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardTable } from "./leaderboard-table";
import type { LeaderboardEntry } from "@/lib/api/types";

const entries: LeaderboardEntry[] = [
  { position: 1, userId: "u1", firstName: "Ana", lastName: "Gomez", totalPoints: 100 },
  { position: 2, userId: "u2", firstName: "Beto", lastName: "Lopez", totalPoints: 95 },
  { position: 3, userId: "u3", firstName: "Cami", lastName: "Diaz", totalPoints: 89 },
  { position: 4, userId: "u4", firstName: "Dami", lastName: "Ruiz", totalPoints: 70 },
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
    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("JUGADOR")).toBeInTheDocument();
    expect(screen.getByText("PUNTOS")).toBeInTheDocument();
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

  it("highlights current user row", () => {
    render(<LeaderboardTable entries={entries} currentUserId="u3" />);
    expect(screen.getByText("VOS")).toBeInTheDocument();
  });
});
