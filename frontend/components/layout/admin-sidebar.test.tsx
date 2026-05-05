import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUsePathname = vi.fn(() => "/admin");

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

import { AdminSidebar } from "./admin-sidebar";

describe("AdminSidebar", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/admin");
  });

  it("renders all 9 nav items", () => {
    render(<AdminSidebar />);
    const expected = [
      "Dashboard",
      "Usuarios",
      "Pagos",
      "Partidos",
      "Fases",
      "Ligas",
      "Notificaciones",
      "Auditoria",
      "Config",
    ];
    for (const label of expected) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks Dashboard active when on /admin (exact match only)", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks nested admin route active via prefix match", () => {
    mockUsePathname.mockReturnValue("/admin/usuarios/abc");
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: "Usuarios" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Dashboard ya no deberia estar activo cuando el path NO es "/admin" exacto
    expect(
      screen.getByRole("link", { name: "Dashboard" }),
    ).not.toHaveAttribute("aria-current", "page");
  });
});
