import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FAQ } from "./faq";

describe("FAQ", () => {
  it("renders all questions from content", () => {
    render(<FAQ />);
    expect(
      screen.getByText("¿Cuándo se cargan las predicciones?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("¿Necesito ser socio del club?"),
    ).toBeInTheDocument();
    expect(screen.getByText("¿Cómo me contactan?")).toBeInTheDocument();
  });

  it("opens an item on click and shows the answer", () => {
    render(<FAQ />);
    const summary = screen.getByText("¿Necesito ser socio del club?");
    fireEvent.click(summary);
    expect(
      screen.getByText(/cualquiera puede jugar/i),
    ).toBeInTheDocument();
  });

  it("each question is rendered inside a <details> element for native accessibility", () => {
    const { container } = render(<FAQ />);
    const detailsList = container.querySelectorAll("details");
    expect(detailsList.length).toBe(6);
  });
});
