import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GroupPanel, { PAGE } from "@/components/GroupPanel";

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const thumbnails = () => screen.queryAllByRole("button", { name: /^Photo \d+ of \d+$/ });

function renderPanel(photoIds: number[]) {
  const onOpen = vi.fn<(id: number) => void>();
  const view = render(<GroupPanel photoIds={photoIds} onOpen={onOpen} />);
  return { onOpen, ...view };
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
    const { rerender, onOpen } = renderPanel(ids(PAGE + 1));
    await userEvent.click(screen.getByRole("button", { name: "Show 1 more of 1" }));
    expect(thumbnails()).toHaveLength(PAGE + 1);
    rerender(<GroupPanel key="other" photoIds={ids(PAGE + 1, 500)} onOpen={onOpen} />);
    expect(thumbnails()).toHaveLength(PAGE);
  });

  it("opens a photo through its callback", async () => {
    const { onOpen } = renderPanel([4, 9]);
    await userEvent.click(screen.getByRole("button", { name: "Photo 2 of 2" }));
    expect(onOpen).toHaveBeenCalledWith(9);
  });
});
