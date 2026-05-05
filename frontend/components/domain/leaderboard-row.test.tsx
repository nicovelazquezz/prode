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

  it("applies gold left border for position 1", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 1 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.style.borderLeftColor).toBe("var(--color-landing-gold)");
  });

  it("applies muted left border for position 2", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 2 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.style.borderLeftColor).toBe("var(--color-landing-text-muted)");
  });

  it("applies green left border for position 3", () => {
    const e: LeaderboardEntry = { ...baseEntry, position: 3 };
    render(<LeaderboardRow entry={e} />);
    const button = screen.getByRole("button");
    expect(button.style.borderLeftColor).toBe("var(--color-landing-green)");
  });

  it("applies transparent left border for position 4+", () => {
    render(<LeaderboardRow entry={baseEntry} />);
    const button = screen.getByRole("button");
    expect(button.style.borderLeftColor).toBe("transparent");
  });
});
