import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchCard } from "./match-card";
import type { Match, Prediction } from "@/lib/api/types";

beforeEach(() => {
  // Force desktop variant to make PredictionInput render as input
  // (so we can query by role="textbox").
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const baseMatch: Match = {
  id: "m1",
  matchNumber: 1,
  phase: "GROUPS",
  groupCode: "A",
  homeTeam: {
    id: "t-mx",
    fifaCode: "MEX",
    name: "Mexico",
    shortName: "MEX",
    flagUrl: "",
    confederation: "CONCACAF",
    groupCode: "A",
    fifaRanking: null,
  },
  awayTeam: {
    id: "t-us",
    fifaCode: "USA",
    name: "USA",
    shortName: "USA",
    flagUrl: "",
    confederation: "CONCACAF",
    groupCode: "A",
    fifaRanking: null,
  },
  homeTeamLabel: null,
  awayTeamLabel: null,
  kickoffAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  predictionsLockAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
  predictionsOpenAt: null,
  status: "SCHEDULED",
  scoreHome: null,
  scoreAway: null,
  venue: null,
};

const basePrediction: Prediction = {
  id: "p1",
  // Multi-prode v1.1: predictions ahora se asocian a un Entry (no User).
  // userId queda opcional para compat; entryId es la referencia canonical.
  entryId: "e1",
  userId: "u1",
  matchId: "m1",
  scoreHome: 2,
  scoreAway: 1,
  outcomeType: null,
  basePoints: 0,
  multiplier: 1,
  pointsEarned: 0,
  evaluatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("MatchCard — 5 visual states", () => {
  it("state=empty: open match, no prediction → PENDIENTE badge", () => {
    render(<MatchCard match={baseMatch} prediction={null} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("PENDIENTE")).toBeInTheDocument();
    // Inputs are enabled (not disabled).
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]).not.toBeDisabled();
  });

  it("state=saved: open match with prediction → ✓ GUARDADO", () => {
    render(<MatchCard match={baseMatch} prediction={basePrediction} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "saved");
    expect(screen.getByText(/GUARDADO/)).toBeInTheDocument();
    // Inputs reflect the prediction.
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]).toHaveValue("2");
    expect(inputs[1]).toHaveValue("1");
  });

  it("state=retrying: when error or loading → REINTENTANDO badge", () => {
    render(
      <MatchCard match={baseMatch} prediction={basePrediction} error />,
    );
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "retrying");
    expect(screen.getByText(/REINTENTANDO/)).toBeInTheDocument();
  });

  it("state=locked: match LOCKED → CERRADO + inputs disabled", () => {
    const lockedMatch: Match = { ...baseMatch, status: "LOCKED" };
    render(<MatchCard match={lockedMatch} prediction={basePrediction} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "locked");
    // Hay 2 ocurrencias de "CERRADO": countdown text + state badge.
    expect(screen.getAllByText(/CERRADO/i).length).toBeGreaterThanOrEqual(1);
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((i) => expect(i).toBeDisabled());
  });

  it("state=finished: with points → shows resultado, prediccion, points badge", () => {
    const finishedMatch: Match = {
      ...baseMatch,
      status: "FINISHED",
      scoreHome: 2,
      scoreAway: 1,
    };
    const evaluatedPrediction: Prediction = {
      ...basePrediction,
      outcomeType: "EXACT",
      basePoints: 3,
      multiplier: 1,
      pointsEarned: 3,
      evaluatedAt: new Date().toISOString(),
    };
    render(
      <MatchCard match={finishedMatch} prediction={evaluatedPrediction} />,
    );
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "finished");
    expect(screen.getByText("+3 PTS")).toBeInTheDocument();
    // Resultado + Tu prediccion both visible.
    expect(screen.getByText(/^Resultado$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Tu prediccion$/i)).toBeInTheDocument();
    // PointsCelebration debe aparecer (evaluatedAt es justo ahora).
    expect(screen.getByTestId("points-celebration")).toBeInTheDocument();
  });

  it("state=finished: omits PointsCelebration when evaluatedAt is older than 5 min", () => {
    const finishedMatch: Match = {
      ...baseMatch,
      status: "FINISHED",
      scoreHome: 2,
      scoreAway: 1,
    };
    const oldPrediction: Prediction = {
      ...basePrediction,
      outcomeType: "EXACT",
      basePoints: 3,
      multiplier: 1,
      pointsEarned: 3,
      evaluatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={oldPrediction} />);
    expect(screen.queryByTestId("points-celebration")).not.toBeInTheDocument();
  });

  it("state=finished: omits PointsCelebration when pointsEarned is 0", () => {
    const finishedMatch: Match = {
      ...baseMatch,
      status: "FINISHED",
      scoreHome: 2,
      scoreAway: 1,
    };
    const missPrediction: Prediction = {
      ...basePrediction,
      outcomeType: "MISS",
      basePoints: 0,
      multiplier: 1,
      pointsEarned: 0,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={missPrediction} />);
    expect(screen.queryByTestId("points-celebration")).not.toBeInTheDocument();
  });
});
