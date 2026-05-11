import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { inlineBold } from "./inline-bold";

describe("inlineBold", () => {
  it("renders plain text without bold markers", () => {
    render(<div>{inlineBold("hola mundo")}</div>);
    expect(screen.getByText("hola mundo")).toBeInTheDocument();
  });

  it("wraps text between ** in <strong>", () => {
    render(<div>{inlineBold("hola **mundo** chau")}</div>);
    const strong = screen.getByText("mundo");
    expect(strong.tagName).toBe("STRONG");
  });

  it("handles multiple bold sections", () => {
    render(<div>{inlineBold("**uno** y **dos**")}</div>);
    expect(screen.getByText("uno").tagName).toBe("STRONG");
    expect(screen.getByText("dos").tagName).toBe("STRONG");
  });

  it("returns the empty string as-is", () => {
    const { container } = render(<div>{inlineBold("")}</div>);
    expect(container.firstChild?.textContent).toBe("");
  });
});
