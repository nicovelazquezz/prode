import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges classnames", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("dedupes conflicting tailwind utilities (last wins)", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
  });

  it("filters out falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("handles conditional classes via clsx semantics", () => {
    expect(cn("text-sm", true && "font-bold", false && "italic")).toBe(
      "text-sm font-bold",
    );
  });
});
