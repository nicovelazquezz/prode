import { describe, it, expect } from "vitest";
import { formatPlayerName } from "./format-player-name";

describe("formatPlayerName", () => {
  it("flips simple 'Apellido Nombre' to 'Nombre Apellido'", () => {
    expect(formatPlayerName("Messi Lionel")).toBe("Lionel Messi");
    expect(formatPlayerName("Romero Cristian")).toBe("Cristian Romero");
  });

  it("keeps compound surnames (last word is given name)", () => {
    expect(formatPlayerName("Martinez Quarta Lisandro")).toBe(
      "Lisandro Martinez Quarta",
    );
    expect(formatPlayerName("De Paul Rodrigo")).toBe("Rodrigo De Paul");
  });

  it("returns single-word names unchanged", () => {
    expect(formatPlayerName("Pelé")).toBe("Pelé");
    expect(formatPlayerName("Ronaldinho")).toBe("Ronaldinho");
  });

  it("trims extra whitespace", () => {
    expect(formatPlayerName("  Messi   Lionel  ")).toBe("Lionel Messi");
  });

  it("handles null/undefined/empty as empty string", () => {
    expect(formatPlayerName(null)).toBe("");
    expect(formatPlayerName(undefined)).toBe("");
    expect(formatPlayerName("")).toBe("");
    expect(formatPlayerName("   ")).toBe("");
  });
});
