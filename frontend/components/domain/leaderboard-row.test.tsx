import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaderboardRow } from "./leaderboard-row";
import type { LeaderboardEntry } from "@/lib/api/types";

const baseEntry: LeaderboardEntry = {
  position: 5,
  userId: "u-5",
  firstName: "Juan",
  lastName: "Perez",
  totalPoints: 42,
};

describe("LeaderboardRow", () => {
  it("renders position, name, points", () => {
    render(<LeaderboardRow entry={baseEntry} />);
    expect(screen.getByText("#5")).toBeInTheDocument();
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("PTS")).toBeInTheDocument();
  });

  it("highlights row when currentUserId matches", () => {
    render(<LeaderboardRow entry={baseEntry} currentUserId="u-5" />);
    expect(screen.getByText("VOS")).toBeInTheDocument();
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-current-user", "true");
  });

  it("does not show VOS badge for other users", () => {
    render(<LeaderboardRow entry={baseEntry} currentUserId="someone-else" />);
    expect(screen.queryByText("VOS")).not.toBeInTheDocument();
  });

  it("invokes onClick with userId when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<LeaderboardRow entry={baseEntry} onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith("u-5");
  });

  it("applies podium border class for position 1", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 1 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("border-b-[#d4af37]");
  });

  it("applies podium border class for position 2", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 2 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("border-b-[#c0c0c0]");
  });

  it("applies podium border class for position 3", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 3 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("border-b-[#cd7f32]");
  });

  it("does not apply podium border for position 4+", () => {
    render(<LeaderboardRow entry={baseEntry} />);
    const button = screen.getByRole("button");
    expect(button.className).not.toContain("border-b-[#d4af37]");
    expect(button.className).not.toContain("border-b-[#c0c0c0]");
    expect(button.className).not.toContain("border-b-[#cd7f32]");
  });
});
