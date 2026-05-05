import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext, type AuthContextValue } from "@/providers/auth-provider";
import type { User } from "@/lib/api/types";
import { AppHeader } from "./app-header";

const mockUsePathname = vi.fn(() => "/predicciones");

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

const mockUser: User = {
  id: "u1",
  dni: "12345678",
  firstName: "Juan",
  lastName: "Perez",
  whatsapp: "+541112345678",
  role: "USER",
  status: "ACTIVE",
  whatsappOptIn: false,
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
};

function renderWithAuth(
  ui: React.ReactElement,
  overrides: Partial<AuthContextValue> = {},
) {
  const value: AuthContextValue = {
    user: mockUser,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <AuthContext.Provider value={value}>{ui}</AuthContext.Provider>,
    ),
    value,
  };
}

describe("AppHeader", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/predicciones");
  });

  it("renders default greeting when no userName provided", () => {
    renderWithAuth(<AppHeader />);
    expect(screen.getByText(/hola, usuario/i)).toBeInTheDocument();
  });

  it("renders custom userName", () => {
    renderWithAuth(<AppHeader userName="Juan" />);
    expect(screen.getByText(/hola, juan/i)).toBeInTheDocument();
  });

  it("includes a logout button", () => {
    renderWithAuth(<AppHeader />);
    expect(
      screen.getByRole("button", { name: /cerrar sesion/i }),
    ).toBeInTheDocument();
  });

  it("renders all 5 desktop nav tabs as links", () => {
    renderWithAuth(<AppHeader />);
    expect(
      screen.getByRole("link", { name: /^predicciones$/i }),
    ).toHaveAttribute("href", "/predicciones");
    expect(screen.getByRole("link", { name: /especiales/i })).toHaveAttribute(
      "href",
      "/especiales",
    );
    expect(screen.getByRole("link", { name: /^tabla$/i })).toHaveAttribute(
      "href",
      "/leaderboard",
    );
    expect(screen.getByRole("link", { name: /^ligas$/i })).toHaveAttribute(
      "href",
      "/ligas",
    );
    expect(screen.getByRole("link", { name: /^perfil$/i })).toHaveAttribute(
      "href",
      "/perfil",
    );
  });

  it("marks the active tab via aria-current=page", () => {
    mockUsePathname.mockReturnValue("/leaderboard");
    renderWithAuth(<AppHeader />);
    const tabla = screen.getByRole("link", { name: /^tabla$/i });
    expect(tabla).toHaveAttribute("aria-current", "page");
    const predic = screen.getByRole("link", { name: /^predicciones$/i });
    expect(predic).not.toHaveAttribute("aria-current", "page");
  });

  it("matches nested paths via startsWith", () => {
    mockUsePathname.mockReturnValue("/ligas/abc123");
    renderWithAuth(<AppHeader />);
    expect(
      screen.getByRole("link", { name: /^ligas$/i }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("brand logo is a link to /predicciones", () => {
    renderWithAuth(<AppHeader />);
    const brandLink = screen.getByRole("link", {
      name: /ir a mis predicciones/i,
    });
    expect(brandLink).toHaveAttribute("href", "/predicciones");
  });

  it("invokes logout from useAuth on click", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    renderWithAuth(<AppHeader />, { logout });
    await user.click(screen.getByRole("button", { name: /cerrar sesion/i }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
