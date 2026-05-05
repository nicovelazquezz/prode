import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberPadSheet } from "./number-pad-sheet";

beforeEach(() => {
  // vaul / @radix-ui usan PointerEvents API; jsdom no las trae por
  // default. Mock minimo para que el Drawer no rompa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).PointerEvent ??= class PointerEvent extends Event {};
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // navigator.vibrate stub
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => vi.restoreAllMocks());

const homeTeam = { name: "Mexico", fifaCode: "MEX" };
const awayTeam = { name: "USA", fifaCode: "USA" };

describe("NumberPadSheet", () => {
  it("does not render content when closed", () => {
    render(
      <NumberPadSheet
        open={false}
        onOpenChange={vi.fn()}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        initialScoreHome={null}
        initialScoreAway={null}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("Mexico")).not.toBeInTheDocument();
  });

  it("shows both team names when open", () => {
    render(
      <NumberPadSheet
        open
        onOpenChange={vi.fn()}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        initialScoreHome={2}
        initialScoreAway={1}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Mexico")).toBeInTheDocument();
    expect(screen.getByText("USA")).toBeInTheDocument();
    // Multiple "2" appear (digit button + score). At least one exists.
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("disables GUARDAR when scores are null", () => {
    render(
      <NumberPadSheet
        open
        onOpenChange={vi.fn()}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        initialScoreHome={null}
        initialScoreAway={null}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /guardar/i })).toBeDisabled();
  });

  it("digits update active side score and saves", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <NumberPadSheet
        open
        onOpenChange={onOpenChange}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        initialScoreHome={null}
        initialScoreAway={null}
        onSave={onSave}
      />,
    );
    // Default active side is home; tap "2" → home becomes 2.
    await user.click(screen.getByRole("button", { name: "2" }));
    // Switch to away, tap "1" → away becomes 1.
    await user.click(screen.getByRole("button", { pressed: false, name: /USA/i }));
    await user.click(screen.getByRole("button", { name: "1" }));

    await user.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSave).toHaveBeenCalledWith({ scoreHome: 2, scoreAway: 1 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clear resets the active side score to null", async () => {
    const user = userEvent.setup();
    render(
      <NumberPadSheet
        open
        onOpenChange={vi.fn()}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        initialScoreHome={5}
        initialScoreAway={3}
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /borrar/i }));
    // GUARDAR debe estar disabled porque home volvio a null.
    expect(screen.getByRole("button", { name: /guardar/i })).toBeDisabled();
  });
});
