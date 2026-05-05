import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IosInstallHint } from "./ios-install-hint";

const ORIGINAL_USER_AGENT = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

function setStandalone(standalone: boolean) {
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    writable: true,
    value: standalone,
  });
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  setUserAgent(ORIGINAL_USER_AGENT);
  // limpia la prop standalone si la setteamos en el test
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window.navigator as any).standalone;
});

describe("IosInstallHint", () => {
  it("renders iOS hint with Compartir steps when on iOS Safari and not standalone", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    );
    setStandalone(false);
    render(<IosInstallHint />);
    expect(await screen.findByText(/Instala la app/i)).toBeInTheDocument();
    expect(screen.getByText(/Compartir/)).toBeInTheDocument();
    expect(screen.getByText(/Agregar a inicio/i)).toBeInTheDocument();
  });

  it("renders Android hint when on Android and not standalone", async () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124",
    );
    render(<IosInstallHint />);
    expect(await screen.findByText(/Instala la app/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Agregar a la pantalla principal/i),
    ).toBeInTheDocument();
  });

  it("renders nothing on desktop", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    );
    const { container } = render(<IosInstallHint />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when iOS standalone", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    );
    setStandalone(true);
    const { container } = render(<IosInstallHint />);
    expect(container).toBeEmptyDOMElement();
  });
});
