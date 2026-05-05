import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreDisplay } from "./score-display";

describe("ScoreDisplay", () => {
  it("renders both scores in DOM order home / away", () => {
    render(<ScoreDisplay scoreHome={3} scoreAway={1} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("3");
    expect(status).toHaveTextContent("1");
    expect(status.getAttribute("aria-label")).toMatch(/Resultado.*3.*1/);
  });

  it("uses prediction aria-label when isPrediction is true", () => {
    render(<ScoreDisplay scoreHome={2} scoreAway={2} isPrediction />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toMatch(/Prediccion.*2.*2/);
  });

  it("renders zero scores correctly", () => {
    render(<ScoreDisplay scoreHome={0} scoreAway={0} />);
    const status = screen.getByRole("status");
    expect(status.textContent?.replace(/\s+/g, "")).toContain("0-0");
  });
});
