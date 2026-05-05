import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tokenStore } from "../auth/token-store";
import { __resetRefreshPromiseForTests } from "../auth/refresh-interceptor";
import { __resetApiClientForTests } from "./client";

process.env.NEXT_PUBLIC_API_URL = "http://test.local";
const API = "http://test.local";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  tokenStore.clear();
  __resetRefreshPromiseForTests();
  __resetApiClientForTests();
});

describe("auth API module", () => {
  it("login stores accessToken in tokenStore and returns user", async () => {
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        const body = (await request.json()) as { dni: string; password: string };
        expect(body.dni).toBe("11111111");
        expect(body.password).toBe("prode2026");
        return HttpResponse.json({
          accessToken: "tok-login",
          user: {
            id: "u1",
            dni: "11111111",
            firstName: "Juan",
            lastName: "Perez",
            whatsapp: "5491100000001",
            role: "USER",
            status: "ACTIVE",
            whatsappOptIn: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastLoginAt: null,
          },
        });
      }),
    );

    const { login } = await import("./auth");
    const result = await login({ dni: "11111111", password: "prode2026" });

    expect(result.accessToken).toBe("tok-login");
    expect(result.user.id).toBe("u1");
    expect(tokenStore.get()).toBe("tok-login");
  });

  it("logout clears tokenStore even if backend call fails", async () => {
    tokenStore.set("stale");
    server.use(
      http.post(`${API}/auth/logout`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { logout } = await import("./auth");
    await logout();
    expect(tokenStore.get()).toBeNull();
  });

  it("getMe returns the current user", async () => {
    tokenStore.set("tok-me");
    server.use(
      http.get(`${API}/auth/me`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok-me");
        return HttpResponse.json({
          id: "u1",
          dni: "11111111",
          firstName: "Juan",
          lastName: "Perez",
          whatsapp: "5491100000001",
          role: "USER",
          status: "ACTIVE",
          whatsappOptIn: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastLoginAt: "2026-05-04T00:00:00.000Z",
        });
      }),
    );

    const { getMe } = await import("./auth");
    const me = await getMe();
    expect(me.id).toBe("u1");
    expect(me.role).toBe("USER");
  });

  it("completeRegistration stores token", async () => {
    server.use(
      http.post(`${API}/auth/complete-registration`, () => {
        return HttpResponse.json({
          accessToken: "tok-cr",
          user: {
            id: "u-new",
            dni: "11111111",
            firstName: "Ana",
            lastName: "Diaz",
            whatsapp: "5491100000002",
            role: "USER",
            status: "ACTIVE",
            whatsappOptIn: true,
            createdAt: "2026-05-04T00:00:00.000Z",
            lastLoginAt: null,
          },
        });
      }),
    );

    const { completeRegistration } = await import("./auth");
    const result = await completeRegistration({
      token: "magic-link",
      dni: "11111111",
      firstName: "Ana",
      lastName: "Diaz",
      whatsapp: "5491100000002",
      password: "secret123",
    });
    expect(result.user.id).toBe("u-new");
    expect(tokenStore.get()).toBe("tok-cr");
  });

  it("forgotPassword does not require auth", async () => {
    server.use(
      http.post(`${API}/auth/forgot-password`, async ({ request }) => {
        const auth = request.headers.get("authorization");
        expect(auth).toBeNull(); // no token in store
        return HttpResponse.json({ ok: true });
      }),
    );

    const { forgotPassword } = await import("./auth");
    const result = await forgotPassword({ dni: "11111111" });
    expect(result.ok).toBe(true);
  });
});
