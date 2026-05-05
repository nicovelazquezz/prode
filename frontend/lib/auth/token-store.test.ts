import { describe, it, expect, beforeEach } from "vitest";
import { tokenStore } from "./token-store";

describe("tokenStore", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it("starts with null token", () => {
    expect(tokenStore.get()).toBeNull();
  });

  it("set/get/clear roundtrip", () => {
    tokenStore.set("abc123");
    expect(tokenStore.get()).toBe("abc123");

    tokenStore.set("xyz789");
    expect(tokenStore.get()).toBe("xyz789");

    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it("set null clears", () => {
    tokenStore.set("abc");
    tokenStore.set(null);
    expect(tokenStore.get()).toBeNull();
  });
});
