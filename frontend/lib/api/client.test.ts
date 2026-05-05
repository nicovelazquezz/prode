import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tokenStore } from "../auth/token-store";
import { __resetRefreshPromiseForTests } from "../auth/refresh-interceptor";

// El client lee NEXT_PUBLIC_API_URL al import time. Lo seteamos antes
// de importar el modulo bajo test.
process.env.NEXT_PUBLIC_API_URL = "http://test.local";

const API = "http://test.local";

let meCallCount = 0;
let refreshCallCount = 0;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  tokenStore.clear();
  __resetRefreshPromiseForTests();
  meCallCount = 0;
  refreshCallCount = 0;
});

describe("api client — refresh-on-401 interceptor", () => {
  it("attaches Authorization header from tokenStore", async () => {
    let receivedAuth: string | null = null;
    server.use(
      http.get(`${API}/auth/me`, ({ request }) => {
        receivedAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: "u1" });
      }),
    );

    tokenStore.set("tok-attach");
    const { api } = await import("./client");
    const data = await api.get("auth/me").json<{ id: string }>();

    expect(data).toEqual({ id: "u1" });
    expect(receivedAuth).toBe("Bearer tok-attach");
  });

  it("on 401: refreshes, retries with new token, returns success", async () => {
    server.use(
      http.get(`${API}/auth/me`, ({ request }) => {
        meCallCount += 1;
        const auth = request.headers.get("authorization");
        if (auth === "Bearer fresh-token") {
          return HttpResponse.json({ id: "u1", whoami: "ok" });
        }
        return new HttpResponse(JSON.stringify({ message: "expired" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
      http.post(`${API}/auth/refresh`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({ accessToken: "fresh-token" });
      }),
    );

    tokenStore.set("stale-token");
    const { api } = await import("./client");
    const data = await api.get("auth/me").json<{ id: string; whoami: string }>();

    expect(data).toEqual({ id: "u1", whoami: "ok" });
    expect(meCallCount).toBe(2); // initial + retry
    expect(refreshCallCount).toBe(1);
    expect(tokenStore.get()).toBe("fresh-token");
  });

  it("does NOT retry the /auth/refresh request itself on 401", async () => {
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCallCount += 1;
        return new HttpResponse(JSON.stringify({ message: "no" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { api } = await import("./client");
    await expect(api.post("auth/refresh").json()).rejects.toBeDefined();
    expect(refreshCallCount).toBe(1); // not retried
  });

  it("X-Retried guard prevents loop on persistent 401 after refresh", async () => {
    server.use(
      http.get(`${API}/auth/me`, () => {
        meCallCount += 1;
        return new HttpResponse(JSON.stringify({ message: "still 401" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
      http.post(`${API}/auth/refresh`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({ accessToken: "fresh-token" });
      }),
    );

    // Mock window.location.href so the redirect doesn't crash jsdom
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, href: "" },
      writable: true,
    });

    tokenStore.set("stale");
    const { api } = await import("./client");
    await expect(api.get("auth/me").json()).rejects.toBeDefined();

    // initial 401 + 1 retry = 2 calls; refresh once
    expect(meCallCount).toBe(2);
    expect(refreshCallCount).toBe(1);

    Object.defineProperty(window, "location", { value: original });
  });

  it("redirects to /login when refresh itself fails", async () => {
    server.use(
      http.get(`${API}/auth/me`, () => {
        meCallCount += 1;
        return new HttpResponse(JSON.stringify({ message: "expired" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
      http.post(`${API}/auth/refresh`, () => {
        refreshCallCount += 1;
        return new HttpResponse(JSON.stringify({ message: "denied" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const original = window.location;
    let redirectedTo = "";
    Object.defineProperty(window, "location", {
      value: {
        ...original,
        get href() {
          return redirectedTo;
        },
        set href(v: string) {
          redirectedTo = v;
        },
      },
      writable: true,
    });

    tokenStore.set("stale");
    const { api } = await import("./client");
    await expect(api.get("auth/me").json()).rejects.toBeDefined();

    expect(meCallCount).toBe(1); // refresh failed -> no retry
    expect(refreshCallCount).toBe(1);
    expect(redirectedTo).toBe("/login");
    expect(tokenStore.get()).toBeNull();

    Object.defineProperty(window, "location", { value: original });
  });
});
