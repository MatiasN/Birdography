import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GroupPanel, { PAGE } from "./GroupPanel";

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const thumbnails = () => screen.queryAllByRole("button", { name: /^Photo \d+ of \d+$/ });

function renderPanel(photoIds: number[], extra: { onZoom?: () => void; listening?: boolean } = {}) {
  const onOpen = vi.fn<(id: number) => void>();
  const onClose = vi.fn<() => void>();
  const view = render(<GroupPanel photoIds={photoIds} onOpen={onOpen} onClose={onClose} {...extra} />);
  return { onOpen, onClose, ...view };
}

describe("GroupPanel", () => {
  it("shows big groups a page at a time", async () => {
    renderPanel(ids(PAGE * 2 + 5));
    expect(thumbnails()).toHaveLength(PAGE);
    await userEvent.click(screen.getByRole("button", { name: `Show ${PAGE} more of ${PAGE + 5}` }));
    expect(thumbnails()).toHaveLength(PAGE * 2);
    await userEvent.click(screen.getByRole("button", { name: "Show 5 more of 5" }));
    expect(thumbnails()).toHaveLength(PAGE * 2 + 5);
    expect(screen.queryByRole("button", { name: /more of/ })).not.toBeInTheDocument();
  });

  it("starts from the first page again for another group (a new key)", async () => {
    const { rerender, onOpen, onClose } = renderPanel(ids(PAGE + 1));
    await userEvent.click(screen.getByRole("button", { name: "Show 1 more of 1" }));
    expect(thumbnails()).toHaveLength(PAGE + 1);
    rerender(<GroupPanel key="other" photoIds={ids(PAGE + 1, 500)} onOpen={onOpen} onClose={onClose} />);
    expect(thumbnails()).toHaveLength(PAGE);
  });

  it("opens a photo, zooms and closes through its callbacks", async () => {
    const onZoom = vi.fn<() => void>();
    const { onOpen, onClose } = renderPanel([4, 9], { onZoom });
    await userEvent.click(screen.getByRole("button", { name: "Photo 2 of 2" }));
    expect(onOpen).toHaveBeenCalledWith(9);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoom).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes with Escape only while listening", () => {
    const { onClose, rerender, onOpen } = renderPanel([1, 2], { listening: false });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<GroupPanel photoIds={[1, 2]} onOpen={onOpen} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
