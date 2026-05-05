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
});
