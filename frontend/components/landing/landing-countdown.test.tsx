import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingCountdown } from "./landing-countdown";

describe("LandingCountdown", () => {
  it("renders the four time unit labels", () => {
    render(<LandingCountdown />);
    expect(screen.getByText("Días")).toBeInTheDocument();
    expect(screen.getByText("Horas")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
  });

  it("has aria-live polite for screen readers", () => {
    const { container } = render(<LandingCountdown />);
    const grid = container.querySelector("[aria-live='polite']");
    expect(grid).toBeInTheDocument();
    expect(grid?.getAttribute("aria-atomic")).toBe("true");
  });

  it("renders the section eyebrow and title", () => {
    render(<LandingCountdown />);
    expect(screen.getByText(/cierre de inscripción/i)).toBeInTheDocument();
    expect(screen.getByText(/11 de junio/i)).toBeInTheDocument();
  });
});
