import { describe, it, expect } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys", () => {
  it("auth.me returns a stable key", () => {
    expect(queryKeys.auth.me()).toEqual(["auth", "me"]);
  });

  it("matches.byPhase namespaces under matches/phase", () => {
    expect(queryKeys.matches.byPhase("GROUPS")).toEqual([
      "matches",
      "phase",
      "GROUPS",
    ]);
  });

  it("predictions.forMatch composes match id at the end", () => {
    expect(queryKeys.predictions.forMatch("m-123")).toEqual([
      "predictions",
      "me",
      "match",
      "m-123",
    ]);
  });

  it("leaderboard.league includes leagueId and page", () => {
    expect(queryKeys.leaderboard.league("L-1", 2)).toEqual([
      "leaderboard",
      "league",
      "L-1",
      2,
    ]);
  });

  it("admin.users.list defaults filters to empty object", () => {
    expect(queryKeys.admin.users.list()).toEqual([
      "admin",
      "users",
      "list",
      {},
    ]);
    expect(queryKeys.admin.users.list({ status: "ACTIVE" })).toEqual([
      "admin",
      "users",
      "list",
      { status: "ACTIVE" },
    ]);
  });

  // ── Multi-prode: entries.* keys ─────────────────────────────────
  it("entries.me returns a stable key", () => {
    expect(queryKeys.entries.me()).toEqual(["entries", "me"]);
  });

  it("entries.detail composes entryId at the end", () => {
    expect(queryKeys.entries.detail("e-1")).toEqual(["entries", "e-1"]);
  });

  it("entries.predictions namespaces under entry+predictions with filters", () => {
    expect(queryKeys.entries.predictions("e-1")).toEqual([
      "entries",
      "e-1",
      "predictions",
      {},
    ]);
    expect(queryKeys.entries.predictions("e-1", { pageSize: 50 })).toEqual([
      "entries",
      "e-1",
      "predictions",
      { pageSize: 50 },
    ]);
  });

  it("entries.predictionForMatch nests match id under the entry", () => {
    expect(queryKeys.entries.predictionForMatch("e-1", "m-9")).toEqual([
      "entries",
      "e-1",
      "predictions",
      "match",
      "m-9",
    ]);
  });

  it("entries.special is per-entry", () => {
    expect(queryKeys.entries.special("e-2")).toEqual([
      "entries",
      "e-2",
      "special",
    ]);
  });

  it("leaderboard.aroundEntry composes entryId in the middle for invalidation", () => {
    expect(queryKeys.leaderboard.aroundEntry("e-3")).toEqual([
      "leaderboard",
      "entry",
      "e-3",
      "around",
    ]);
  });
});
