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

describe("MatchCard — base states", () => {
  it("state=empty: open match, no prediction → FALTA TU PRONÓSTICO badge", () => {
    render(<MatchCard match={baseMatch} prediction={null} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "empty");
    expect(screen.getByText(/FALTA TU PRON/i)).toBeInTheDocument();
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
    // Hay 2 ocurrencias de "CERRADO": foot left + foot right.
    expect(screen.getAllByText(/CERRADO/i).length).toBeGreaterThanOrEqual(1);
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((i) => expect(i).toBeDisabled());
  });

  it("state=locked + IN_PROGRESS: shows EN VIVO indicator", () => {
    const liveMatch: Match = { ...baseMatch, status: "IN_PROGRESS" };
    render(<MatchCard match={liveMatch} prediction={basePrediction} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "locked");
    // "EN VIVO" puede aparecer 2 veces (foot-left badge + center subtext).
    // Garantizamos al menos una ocurrencia.
    expect(screen.getAllByText(/EN VIVO/i).length).toBeGreaterThanOrEqual(1);
  });

  it("state=locked + CANCELLED: shows CANCELADO instead of CERRADO", () => {
    const cancelledMatch: Match = { ...baseMatch, status: "CANCELLED" };
    render(<MatchCard match={cancelledMatch} prediction={basePrediction} />);
    const article = screen.getByRole("article");
    // El comportamiento (inputs disabled) sigue siendo "locked"; lo que
    // cambia es la presentación: "CANCELADO" en vez de "CERRADO" para que
    // el usuario sepa que el partido NO se juega (decisión externa).
    expect(article).toHaveAttribute("data-state", "locked");
    expect(screen.getAllByText(/CANCELADO/i).length).toBeGreaterThanOrEqual(1);
    // CERRADO no debe aparecer (sería contradictorio).
    expect(screen.queryByText(/^CERRADO$/i)).not.toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((i) => expect(i).toBeDisabled());
  });

  it("knockout sin equipos asignados: muestra ESPERANDO EQUIPOS y deshabilita inputs", () => {
    const placeholderMatch: Match = {
      ...baseMatch,
      phase: "ROUND_32",
      homeTeam: null,
      awayTeam: null,
      homeTeamLabel: "Ganador Grupo A",
      awayTeamLabel: "Segundo Grupo B",
    };
    render(<MatchCard match={placeholderMatch} prediction={null} />);
    expect(screen.getByText(/ESPERANDO EQUIPOS/i)).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((i) => expect(i).toBeDisabled());
  });
});

describe("MatchCard — finished outcome subtypes", () => {
  const finishedMatch: Match = {
    ...baseMatch,
    status: "FINISHED",
    scoreHome: 2,
    scoreAway: 1,
  };

  it("finished + EXACT → data-outcome=exact + ★ EXACTO + +5 PTS gold", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: "EXACT",
      basePoints: 5,
      multiplier: 1,
      pointsEarned: 5,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-state", "finished");
    expect(article).toHaveAttribute("data-outcome", "exact");
    expect(screen.getByText(/EXACTO/)).toBeInTheDocument();
    expect(screen.getByText("+5 PTS")).toBeInTheDocument();
    // Resultado eyebrow visible.
    expect(screen.getByText(/Resultado/i)).toBeInTheDocument();
    // PointsCelebration debe aparecer (evaluatedAt es justo ahora).
    expect(screen.getByTestId("points-celebration")).toBeInTheDocument();
  });

  it("finished + WINNER_AND_DIFF → data-outcome=winner-diff + GANADOR + DIFERENCIA", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: "WINNER_AND_DIFF",
      basePoints: 4,
      multiplier: 1,
      pointsEarned: 4,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-outcome", "winner-diff");
    expect(screen.getByText(/GANADOR \+ DIFERENCIA/)).toBeInTheDocument();
    expect(screen.getByText("+4 PTS")).toBeInTheDocument();
  });

  it("finished + WINNER_ONLY → data-outcome=winner-only + GANADOR (sin diferencia)", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: "WINNER_ONLY",
      basePoints: 2,
      multiplier: 1,
      pointsEarned: 2,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-outcome", "winner-only");
    expect(screen.getByText(/^✓ GANADOR$/)).toBeInTheDocument();
    expect(screen.getByText("+2 PTS")).toBeInTheDocument();
  });

  it("finished + MISS → data-outcome=miss + ✗ MISS + 0 PTS muted", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: "MISS",
      basePoints: 0,
      multiplier: 1,
      pointsEarned: 0,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-outcome", "miss");
    expect(screen.getByText(/MISS/)).toBeInTheDocument();
    expect(screen.getByText("0 PTS")).toBeInTheDocument();
    // PointsCelebration NO debe aparecer (0 pts).
    expect(screen.queryByTestId("points-celebration")).not.toBeInTheDocument();
  });

  it("finished + null outcomeType → defensivo data-outcome=miss", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: null,
      basePoints: 0,
      multiplier: 1,
      pointsEarned: 0,
      evaluatedAt: new Date().toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-outcome", "miss");
  });

  it("finished: omits PointsCelebration when evaluatedAt is older than 5 min", () => {
    const pred: Prediction = {
      ...basePrediction,
      outcomeType: "EXACT",
      basePoints: 5,
      multiplier: 1,
      pointsEarned: 5,
      evaluatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    render(<MatchCard match={finishedMatch} prediction={pred} />);
    expect(screen.queryByTestId("points-celebration")).not.toBeInTheDocument();
  });
});

describe("MatchCard — header band", () => {
  it("renders match number padded to 2 digits and group chip", () => {
    const match: Match = { ...baseMatch, matchNumber: 3, groupCode: "B" };
    render(<MatchCard match={match} prediction={null} />);
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("GRUPO B")).toBeInTheDocument();
  });

  it("falls back to phase label when no group code (knockouts)", () => {
    const match: Match = {
      ...baseMatch,
      phase: "QUARTERS",
      groupCode: null,
    };
    render(<MatchCard match={match} prediction={null} />);
    expect(screen.getByText("CUARTOS")).toBeInTheDocument();
  });
});
