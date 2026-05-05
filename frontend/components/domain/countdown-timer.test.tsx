import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CountdownTimer } from "./countdown-timer";

describe("CountdownTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the four unit labels (Dias/Horas/Min/Seg)", () => {
    vi.useFakeTimers();
    const future = new Date(Date.now() + 60_000).toISOString();
    render(<CountdownTimer targetIso={future} />);
    // jsdom dispara useEffect tras render, asi que parts ya tiene
    // un valor concreto cuando el assert corre. Verificamos que
    // los 4 labels aparezcan en el DOM (uno tiene un sr-only extra,
    // por eso usamos getAllByText).
    expect(screen.getAllByText(/dias/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/horas/i)).toBeInTheDocument();
    expect(screen.getByText(/min/i)).toBeInTheDocument();
    expect(screen.getByText(/seg/i)).toBeInTheDocument();
  });

  it("renders the finished label when target has already passed", () => {
    vi.useFakeTimers();
    const past = new Date(Date.now() - 60_000).toISOString();
    render(
      <CountdownTimer targetIso={past} finishedLabel="Termino!" />,
    );
    // Despues del primer compute en el effect, parts.finished === true
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText(/termino!/i)).toBeInTheDocument();
  });

  it("has timer role for accessibility", () => {
    vi.useFakeTimers();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    render(<CountdownTimer targetIso={future} />);
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });
});
