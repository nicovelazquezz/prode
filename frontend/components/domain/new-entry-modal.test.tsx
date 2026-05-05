import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tokenStore } from "@/lib/auth/token-store";
import { __resetApiClientForTests } from "@/lib/api/client";
import { NewEntryModal } from "./new-entry-modal";

process.env.NEXT_PUBLIC_API_URL = "http://test.local";
const API = "http://test.local";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  tokenStore.clear();
  __resetApiClientForTests();
});

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(open = true, onOpenChange = vi.fn()) {
  const client = makeClient();
  return {
    onOpenChange,
    ...render(
      <QueryClientProvider client={client}>
        <NewEntryModal open={open} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    ),
  };
}

describe("NewEntryModal", () => {
  it("renders title, alias input and price label", () => {
    renderModal();
    expect(screen.getByText(/nuevo prode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/alias/i)).toBeInTheDocument();
    expect(screen.getByText("$10.000")).toBeInTheDocument();
  });

  it("submit with alias hits POST /entries/init-payment with the alias and redirects", async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });

    let receivedBody: { alias?: string | null } | null = null;
    server.use(
      http.post(`${API}/entries/init-payment`, async ({ request }) => {
        receivedBody = (await request.json()) as { alias?: string | null };
        return HttpResponse.json({
          paymentId: "p1",
          initPoint: "https://mp.test/checkout/p1",
        });
      }),
    );

    const user = userEvent.setup();
    renderModal(true);
    await user.type(screen.getByLabelText(/alias/i), "Mi prode optimista");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /pagar/i }));
    });

    await waitFor(() => {
      expect(receivedBody).toEqual({ alias: "Mi prode optimista" });
      expect(assignSpy).toHaveBeenCalledWith("https://mp.test/checkout/p1");
    });
  });

  it("submit without alias sends alias=null", async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    let receivedBody: { alias?: string | null } | null = null;
    server.use(
      http.post(`${API}/entries/init-payment`, async ({ request }) => {
        receivedBody = (await request.json()) as { alias?: string | null };
        return HttpResponse.json({ paymentId: "p2", initPoint: "https://mp.test/p2" });
      }),
    );

    const user = userEvent.setup();
    renderModal(true);
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /pagar/i }));
    });
    await waitFor(() => {
      expect(receivedBody).toEqual({ alias: null });
    });
  });

  it("409 ENTRY_CAP_REACHED closes the modal", async () => {
    server.use(
      http.post(`${API}/entries/init-payment`, () => {
        return HttpResponse.json(
          {
            code: "ENTRY_CAP_REACHED",
            current: 5,
            cap: 5,
            message: "Llegaste al máximo de 5 entradas",
          },
          { status: 409 },
        );
      }),
    );

    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={makeClient()}>
        <NewEntryModal open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /pagar/i }));
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("non-cap error shows inline alert and keeps modal open", async () => {
    server.use(
      http.post(`${API}/entries/init-payment`, () => {
        return HttpResponse.json(
          { message: "MercadoPago caído" },
          { status: 500 },
        );
      }),
    );

    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={makeClient()}>
        <NewEntryModal open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /pagar/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
