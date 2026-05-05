import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tokenStore } from "@/lib/auth/token-store";
import { __resetRefreshPromiseForTests } from "@/lib/auth/refresh-interceptor";
import { __resetApiClientForTests } from "@/lib/api/client";
import { AuthProvider } from "./auth-provider";
import { useAuth } from "@/lib/hooks/use-auth";

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
  // Clear cookies between tests
  document.cookie = "has_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

const TEST_USER = {
  id: "u1",
  dni: "11111111",
  firstName: "Juan",
  lastName: "Perez",
  whatsapp: "5491100000001",
  role: "USER" as const,
  status: "ACTIVE" as const,
  whatsappOptIn: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: null,
};

function ProbeUI() {
  const { user, isLoading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="user">{user ? user.dni : "null"}</div>
      <button
        data-testid="login-btn"
        onClick={() => {
          void login({ dni: "11111111", password: "prode2026" });
        }}
      >
        login
      </button>
      <button
        data-testid="logout-btn"
        onClick={() => {
          void logout();
        }}
      >
        logout
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  it("without has_session cookie: skips refresh, isLoading->false, user null", async () => {
    let refreshCalled = false;
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshCalled = true;
        return new HttpResponse(null, { status: 401 });
      }),
    );

    render(
      <AuthProvider>
        <ProbeUI />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(refreshCalled).toBe(false);
  });

  it("with has_session cookie: refresh + getMe populates user", async () => {
    document.cookie = "has_session=1; path=/";

    server.use(
      http.post(`${API}/auth/refresh`, () => {
        return HttpResponse.json({
          accessToken: "fresh-token",
          user: TEST_USER,
        });
      }),
      http.get(`${API}/auth/me`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer fresh-token");
        return HttpResponse.json(TEST_USER);
      }),
    );

    render(
      <AuthProvider>
        <ProbeUI />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("11111111");
    });
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(tokenStore.get()).toBe("fresh-token");
  });

  it("with has_session cookie but refresh fails: user stays null", async () => {
    document.cookie = "has_session=1; path=/";

    server.use(
      http.post(`${API}/auth/refresh`, () => {
        return new HttpResponse(JSON.stringify({ message: "no" }), {
          status: 401,
        });
      }),
    );

    render(
      <AuthProvider>
        <ProbeUI />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(tokenStore.get()).toBeNull();
  });

  it("login() updates user state", async () => {
    server.use(
      http.post(`${API}/auth/login`, () => {
        return HttpResponse.json({
          accessToken: "tok-login",
          user: TEST_USER,
        });
      }),
    );

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <ProbeUI />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await act(async () => {
      await user.click(screen.getByTestId("login-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("11111111");
    });
    expect(tokenStore.get()).toBe("tok-login");
  });

  it("logout() clears user even on backend failure", async () => {
    document.cookie = "has_session=1; path=/";

    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: "tok", user: TEST_USER }),
      ),
      http.get(`${API}/auth/me`, () => HttpResponse.json(TEST_USER)),
      http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 500 })),
    );

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <ProbeUI />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("11111111");
    });

    await act(async () => {
      await user.click(screen.getByTestId("logout-btn"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("null");
    });
    expect(tokenStore.get()).toBeNull();
  });
});
