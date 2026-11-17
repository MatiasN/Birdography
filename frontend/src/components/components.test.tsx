import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BirdIcon } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubMatchMedia } from "@/test/media";
import EmptyState from "@/components/EmptyState";
import ResponsivePanel from "@/components/ResponsivePanel";
import SidePanel from "@/components/SidePanel";
import ThemePicker from "@/components/ThemePicker";

describe("ThemePicker", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
  });
  afterEach(() => document.documentElement.classList.remove("dark"));

  it("starts on the stored choice", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemePicker />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("starts on System with nothing stored", () => {
    render(<ThemePicker />);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("applies and stores a new choice", async () => {
    render(<ThemePicker />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("keeps the choice when the chosen option is clicked again", async () => {
    render(<ThemePicker />);
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });
});

describe("SidePanel", () => {
  it("shows its title, actions and content as a labelled region", () => {
    render(
      <SidePanel title="12 photos here" onClose={() => undefined} actions={<button>Zoom in</button>}>
        <p>thumbnails</p>
      </SidePanel>,
    );
    const panel = screen.getByRole("complementary", { name: "12 photos here" });
    expect(panel).toHaveTextContent("thumbnails");
    expect(screen.getByRole("heading", { name: "12 photos here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("closes with the Close button and Escape", async () => {
    const onClose = vi.fn<() => void>();
    render(
      <SidePanel title="Photo" onClose={onClose}>
        x
      </SidePanel>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("a");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("leaves Escape to someone else when asked", async () => {
    const onClose = vi.fn<() => void>();
    const { unmount } = render(
      <SidePanel title="Photo" onClose={onClose} closeOnEscape={false}>
        x
      </SidePanel>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });
});

describe("EmptyState", () => {
  it("shows the icon, title, text, action and note", () => {
    render(
      <EmptyState icon={BirdIcon} title="Your species" action={<button>Start</button>} note="Coming in Phase 2">
        One page each.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Your species" })).toBeInTheDocument();
    expect(screen.getByText("One page each.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByText("Coming in Phase 2")).toBeInTheDocument();
  });

  it("leaves out the action and note when there are none", () => {
    render(
      <EmptyState icon={BirdIcon} title="Nothing yet">
        Text
      </EmptyState>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Coming in Phase 2")).not.toBeInTheDocument();
  });
});

// A focusable element that isn't an HTMLElement: a link inside an SVG.
const marker = (
  <svg>
    <a href="#group" aria-label="Marker" />
  </svg>
);

describe("ResponsivePanel", () => {
  it("on phones, leaves focus alone on close when what had it can't take it back", async () => {
    stubMatchMedia(false, false);
    const { rerender } = render(marker);
    screen.getByLabelText("Marker").focus();
    rerender(
      <>
        {marker}
        <ResponsivePanel title="Photo details" onClose={() => undefined}>
          body
        </ResponsivePanel>
      </>,
    );
    expect(await screen.findByRole("dialog", { name: "Photo details" })).toBeInTheDocument();
    rerender(marker);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Radix hands focus back in a timeout after the sheet unmounts.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.getByLabelText("Marker")).not.toHaveFocus();
  });
});
