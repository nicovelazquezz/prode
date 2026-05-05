import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhaseTabs } from "./phase-tabs";

describe("PhaseTabs", () => {
  it("renders all 7 tabs (Upcoming + 6 phases)", () => {
    render(<PhaseTabs value="UPCOMING" onChange={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
  });

  it("marks the selected tab as active and focusable", () => {
    render(<PhaseTabs value="GROUPS" onChange={vi.fn()} />);
    const grupos = screen.getByRole("tab", { name: /grupos/i });
    expect(grupos).toHaveAttribute("aria-selected", "true");
    expect(grupos).toHaveAttribute("tabindex", "0");

    const proximos = screen.getByRole("tab", { name: /pr/i });
    expect(proximos).toHaveAttribute("aria-selected", "false");
    expect(proximos).toHaveAttribute("tabindex", "-1");
  });

  it("invokes onChange with phase value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PhaseTabs value="UPCOMING" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: /cuartos/i }));
    expect(onChange).toHaveBeenCalledWith("QUARTERS");
  });

  it("invokes onChange with UPCOMING for the Próx tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PhaseTabs value="GROUPS" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: /pr/i }));
    expect(onChange).toHaveBeenCalledWith("UPCOMING");
  });
});
