import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamSelectModal } from "./team-select-modal";
import type { Team } from "@/lib/api/types";

beforeEach(() => {
  // Radix Dialog uses ResizeObserver / pointer APIs. Mock minimas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const teams: Team[] = [
  {
    id: "t1",
    fifaCode: "ARG",
    name: "Argentina",
    shortName: "ARG",
    flagUrl: "",
    confederation: "CONMEBOL",
    groupCode: "A",
    fifaRanking: 1,
  },
  {
    id: "t2",
    fifaCode: "BRA",
    name: "Brasil",
    shortName: "BRA",
    flagUrl: "",
    confederation: "CONMEBOL",
    groupCode: "B",
    fifaRanking: 2,
  },
  {
    id: "t3",
    fifaCode: "MEX",
    name: "Mexico",
    shortName: "MEX",
    flagUrl: "",
    confederation: "CONCACAF",
    groupCode: "A",
    fifaRanking: 10,
  },
];

describe("TeamSelectModal", () => {
  it("renders all teams when open", () => {
    render(
      <TeamSelectModal
        open
        onOpenChange={vi.fn()}
        teams={teams}
        onSelect={vi.fn()}
        title="Elegi al campeon"
      />,
    );
    expect(screen.getByText("Elegi al campeon")).toBeInTheDocument();
    expect(screen.getByText("Argentina")).toBeInTheDocument();
    expect(screen.getByText("Brasil")).toBeInTheDocument();
    expect(screen.getByText("Mexico")).toBeInTheDocument();
  });

  it("filters by name when searching", async () => {
    const user = userEvent.setup();
    render(
      <TeamSelectModal
        open
        onOpenChange={vi.fn()}
        teams={teams}
        onSelect={vi.fn()}
        title="Elegi al campeon"
      />,
    );
    await user.type(screen.getByPlaceholderText(/buscar/i), "bra");
    expect(screen.queryByText("Argentina")).not.toBeInTheDocument();
    expect(screen.getByText("Brasil")).toBeInTheDocument();
    expect(screen.queryByText("Mexico")).not.toBeInTheDocument();
  });

  it("disables excluded teams and ignores their click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TeamSelectModal
        open
        onOpenChange={vi.fn()}
        teams={teams}
        excludeTeamIds={["t2"]}
        onSelect={onSelect}
        title="Elegi al campeon"
      />,
    );
    const brasilBtn = screen.getByRole("button", { name: /brasil/i });
    expect(brasilBtn).toBeDisabled();
    await user.click(brasilBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("invokes onSelect and closes when an enabled team is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TeamSelectModal
        open
        onOpenChange={onOpenChange}
        teams={teams}
        onSelect={onSelect}
        title="Elegi al campeon"
      />,
    );
    await user.click(screen.getByRole("button", { name: /argentina/i }));
    expect(onSelect).toHaveBeenCalledWith(teams[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
