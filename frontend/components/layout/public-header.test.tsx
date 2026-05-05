import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("renders brand link, reglamento, and login CTAs", () => {
    render(<PublicHeader />);

    expect(
      screen.getByRole("link", { name: /prode 2026/i }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByRole("link", { name: /reglamento/i }),
    ).toHaveAttribute("href", "/reglamento");
    expect(
      screen.getByRole("link", { name: /ingresar/i }),
    ).toHaveAttribute("href", "/login");
  });
});
