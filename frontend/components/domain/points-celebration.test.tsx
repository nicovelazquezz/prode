import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PointsCelebration } from "./points-celebration";

// Mock framer-motion para que las animaciones no requieran rAF en
// jsdom. Solo testeamos la semantica (aria-label, content), no la
// curva de animacion.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
      // Filtramos las props que framer-motion entiende (initial, animate,
      // transition) para que no warneen al pasar a div nativo.
      const {
        initial: _i,
        animate: _a,
        transition: _t,
        whileHover: _h,
        whileTap: _w,
        ...rest
      } = props as Record<string, unknown>;
      void _i;
      void _a;
      void _t;
      void _h;
      void _w;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

beforeEach(() => {
  // matchMedia para useReducedMotion fallback.
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

describe("PointsCelebration", () => {
  it("renders points earned in `+N pts` format", () => {
    render(<PointsCelebration points={5} />);
    expect(screen.getByText(/\+5 pts/i)).toBeInTheDocument();
  });

  it("uses aria-label for screen readers", () => {
    render(<PointsCelebration points={10} />);
    expect(
      screen.getByRole("status", { name: /Ganaste 10 puntos/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing when points is 0", () => {
    const { container } = render(<PointsCelebration points={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when points is negative", () => {
    const { container } = render(<PointsCelebration points={-3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("supports custom className", () => {
    render(
      <PointsCelebration
        points={3}
        className="custom-class font-display text-5xl"
      />,
    );
    const el = screen.getByRole("status");
    expect(el.className).toContain("custom-class");
  });
});
