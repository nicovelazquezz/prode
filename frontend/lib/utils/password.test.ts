import { describe, it, expect } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  it("returns 8 chars", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(8);
    }
  });

  it("contains 4 letters and 4 digits", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      const letters = p.replace(/[^a-z]/g, "");
      const digits = p.replace(/[^0-9]/g, "");
      expect(letters).toHaveLength(4);
      expect(digits).toHaveLength(4);
    }
  });

  it("excludes ambiguous characters (0, 1, O, I, l)", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).not.toMatch(/[01OIl]/);
    }
  });
});
