import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamFlag } from "./team-flag";

describe("TeamFlag", () => {
  it("renders an img with flagcdn url derived from FIFA code", () => {
    render(<TeamFlag fifaCode="ARG" />);
    const img = screen.getByRole("img", { name: /bandera arg/i });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toContain("flagcdn.com/ar.svg");
  });

  it("uppercases FIFA code in alt text but lowercases the URL", () => {
    render(<TeamFlag fifaCode="MEX" />);
    const img = screen.getByRole("img", { name: /bandera mex/i });
    expect(img.getAttribute("src")).toContain("flagcdn.com/me.svg");
  });

  it("respects custom size", () => {
    render(<TeamFlag fifaCode="BRA" size={64} />);
    const img = screen.getByRole("img", { name: /bandera bra/i });
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
  });
});
