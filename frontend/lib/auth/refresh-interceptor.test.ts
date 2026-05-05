import { describe, it, expect, beforeEach, vi } from "vitest";
import ky from "ky";
import { tokenStore } from "./token-store";
import {
  refreshAccessToken,
  __setRefreshClientForTests,
  __resetRefreshClientForTests,
  __resetRefreshPromiseForTests,
} from "./refresh-interceptor";

describe("refreshAccessToken — singleton dedupe", () => {
  beforeEach(() => {
    tokenStore.clear();
    __resetRefreshPromiseForTests();
    __resetRefreshClientForTests();
  });

  it("dedupes concurrent calls into a single network request", async () => {
    let callCount = 0;
    let resolveFn!: (value: { accessToken: string }) => void;
    const pending = new Promise<{ accessToken: string }>((resolve) => {
      resolveFn = resolve;
    });

    // mock ky con un client custom que cuenta llamadas
    const mockClient = ky.create({
      hooks: {
        beforeRequest: [
          () => {
            callCount += 1;
            return new Response(JSON.stringify({ accessToken: "tok-123" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        ],
      },
    });

    // Override interno: use el mock + bypass del beforeRequest hack
    // Vamos por enfoque mas simple: spy del fetch global
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      // simular delay para que 3 llamadas se solapen
      await pending;
      return new Response(JSON.stringify({ accessToken: "tok-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    __setRefreshClientForTests(
      ky.create({
        prefix: "http://test.local",
        credentials: "include",
      }),
    );

    const p1 = refreshAccessToken();
    const p2 = refreshAccessToken();
    const p3 = refreshAccessToken();

    // Las 3 promesas son la misma instancia
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    resolveFn({ accessToken: "tok-123" });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe("tok-123");
    expect(r2).toBe("tok-123");
    expect(r3).toBe("tok-123");

    // fetch llamado UNA SOLA VEZ
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // tokenStore actualizado
    expect(tokenStore.get()).toBe("tok-123");

    globalThis.fetch = originalFetch;
    void mockClient;
  });

  it("returns null and clears tokenStore on failure", async () => {
    tokenStore.set("old-token");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    __setRefreshClientForTests(
      ky.create({ prefix: "http://test.local", credentials: "include" }),
    );

    const result = await refreshAccessToken();
    expect(result).toBeNull();
    expect(tokenStore.get()).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it("releases the singleton after completion (next call refetches)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "tok-A" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "tok-B" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    __setRefreshClientForTests(
      ky.create({ prefix: "http://test.local", credentials: "include" }),
    );

    const r1 = await refreshAccessToken();
    expect(r1).toBe("tok-A");

    const r2 = await refreshAccessToken();
    expect(r2).toBe("tok-B");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    globalThis.fetch = originalFetch;
  });
});
