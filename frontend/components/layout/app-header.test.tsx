import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("renders default greeting when no userName provided", () => {
    render(<AppHeader />);
    expect(screen.getByText(/hola, usuario/i)).toBeInTheDocument();
  });

  it("renders custom userName", () => {
    render(<AppHeader userName="Juan" />);
    expect(screen.getByText(/hola, juan/i)).toBeInTheDocument();
  });

  it("includes a logout button", () => {
    render(<AppHeader />);
    expect(
      screen.getByRole("button", { name: /cerrar sesion/i }),
    ).toBeInTheDocument();
  });
});
