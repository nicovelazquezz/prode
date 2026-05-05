import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUsePathname = vi.fn(() => "/predicciones");

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

import { BottomNav } from "./bottom-nav";

describe("BottomNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/predicciones");
  });

  it("renders all 4 nav items as links", () => {
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /predic/i })).toHaveAttribute(
      "href",
      "/predicciones",
    );
    expect(screen.getByRole("link", { name: /tabla/i })).toHaveAttribute(
      "href",
      "/leaderboard",
    );
    expect(screen.getByRole("link", { name: /ligas/i })).toHaveAttribute(
      "href",
      "/ligas",
    );
    expect(screen.getByRole("link", { name: /perfil/i })).toHaveAttribute(
      "href",
      "/perfil",
    );
  });

  it("marks the current pathname item with aria-current=page", () => {
    mockUsePathname.mockReturnValue("/leaderboard");
    render(<BottomNav />);
    const tabla = screen.getByRole("link", { name: /tabla/i });
    expect(tabla).toHaveAttribute("aria-current", "page");
    const predic = screen.getByRole("link", { name: /predic/i });
    expect(predic).not.toHaveAttribute("aria-current", "page");
  });

  it("matches nested paths via startsWith", () => {
    mockUsePathname.mockReturnValue("/ligas/abc123");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /ligas/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
