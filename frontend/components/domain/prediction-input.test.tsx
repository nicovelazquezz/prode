import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PredictionInput } from "./prediction-input";

/**
 * Por default jsdom tiene `window.matchMedia` undefined. Lo mockeamos
 * antes de cada test para controlar el viewport (mobile vs desktop).
 */
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("PredictionInput (desktop)", () => {
  beforeEach(() => mockMatchMedia(false)); // not mobile
  afterEach(() => vi.restoreAllMocks());

  it("renders an input with placeholder when value is null", () => {
    render(<PredictionInput value={null} />);
    const input = screen.getByRole("textbox", { name: /prediccion/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveValue("");
  });

  it("shows the numeric value when set", () => {
    render(<PredictionInput value={3} />);
    expect(screen.getByRole("textbox")).toHaveValue("3");
  });

  it("calls onChange with parsed number when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PredictionInput value={null} onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "5");
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("clamps values above 99", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PredictionInput value={null} onChange={onChange} />);
    // Typing "99" character by character.
    await user.type(screen.getByRole("textbox"), "99");
    // Last call: 99 (max digits limited to 2 by maxLength).
    expect(onChange).toHaveBeenLastCalledWith(99);
  });

  it("calls onChange with null when cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PredictionInput value={4} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("respects disabled prop", () => {
    render(<PredictionInput value={2} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});

describe("PredictionInput (mobile)", () => {
  beforeEach(() => mockMatchMedia(true)); // is mobile
  afterEach(() => vi.restoreAllMocks());

  it("renders a button instead of input on mobile", () => {
    render(<PredictionInput value={null} onOpenSheet={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /prediccion/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("—");
  });

  it("shows the score when value is set", () => {
    render(<PredictionInput value={2} onOpenSheet={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("2");
  });

  it("calls onOpenSheet when tapped", async () => {
    const user = userEvent.setup();
    const onOpenSheet = vi.fn();
    render(<PredictionInput value={null} onOpenSheet={onOpenSheet} />);
    await user.click(screen.getByRole("button"));
    expect(onOpenSheet).toHaveBeenCalledOnce();
  });

  it("button is disabled when match is locked", async () => {
    const user = userEvent.setup();
    const onOpenSheet = vi.fn();
    render(
      <PredictionInput value={1} disabled onOpenSheet={onOpenSheet} />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onOpenSheet).not.toHaveBeenCalled();
  });
});
