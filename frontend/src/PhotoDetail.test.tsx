import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Photo } from "./api";
import PhotoDetail from "./PhotoDetail";
import { deferred, makePhoto, mockApi } from "./test/api";
import { clickMap } from "./test/leaflet";

vi.mock("react-leaflet", () => import("./test/leaflet"));

function renderDetail(photo: Photo) {
  const onChange = vi.fn<(photo: Photo) => void>();
  const onClose = vi.fn<() => void>();
  const { unmount } = render(<PhotoDetail photo={photo} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose, unmount };
}

const markers = () => screen.queryAllByTestId("marker").map((m) => [m.dataset.center, m.dataset.color]);

describe("PhotoDetail", () => {
  it("shows the photo's metadata", () => {
    renderDetail(
      makePhoto({ taken_at_local: "2026-05-01T09:00:00", taken_offset_minutes: -180, taken_at_manual: true }),
    );
    expect(screen.getByRole("dialog", { name: "Photo details" })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${new Date("2026-05-01T09:00:00").toLocaleString()}.*UTC-03:00.*set by you`)),
    ).toBeInTheDocument();
    expect(screen.getByText("NIKON Z 5")).toBeInTheDocument();
    expect(screen.getByText("NIKKOR Z 100-400mm")).toBeInTheDocument();
    expect(screen.getByText("ISO 800")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "/api/photos/1/file?kind=preview");
  });

  it("leaves out what is unknown", () => {
    renderDetail(makePhoto({ taken_at_local: null, taken_offset_minutes: null, camera: null, lens: null, iso: null }));
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.queryByText(/UTC|ISO|NIKON|set by you/)).not.toBeInTheDocument();
  });

  it("explains where the position comes from", () => {
    renderDetail(makePhoto({ lat: 37, lon: -8, point_manual: false }));
    expect(screen.getByText("Position from the camera's GPS.")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-center", "37,-8");
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "12");
    expect(markers()).toEqual([["37,-8", "#047857"]]);
    expect(screen.queryByRole("button", { name: "Remove my position" })).not.toBeInTheDocument();
  });

  it("offers to remove a position chosen by hand", async () => {
    const calls = mockApi({ "PATCH /photos/1": { body: makePhoto({ point_manual: false }) } });
    const { onChange } = renderDetail(makePhoto({ point_manual: true }));
    expect(screen.getByText("Position chosen by you.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove my position" }));
    expect(calls[0].body).toEqual({ lat: null, lon: null });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ point_manual: false }));
  });

  it("places a photo without a position from a click on the map", async () => {
    const saved = makePhoto({ lat: 38.5, lon: -9.1, point_manual: true });
    const calls = mockApi({ "PATCH /photos/1": { body: saved } });
    const { onChange } = renderDetail(makePhoto({ lat: null, lon: null }));
    expect(screen.getByText("No position. Click the map where this photo was taken.")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "6");
    expect(markers()).toEqual([]);
    const use = screen.getByRole("button", { name: "Use this spot" });
    expect(use).toBeDisabled();

    clickMap(38.5, -9.1);
    expect(markers()).toEqual([["38.5,-9.1", "#b45309"]]);
    await userEvent.click(use);
    expect(calls[0]).toEqual({ method: "PATCH", path: "/photos/1", body: { lat: 38.5, lon: -9.1 } });
    expect(onChange).toHaveBeenCalledWith(saved);
    expect(markers()).toEqual([]); // the pick is cleared; the parent re-renders with the saved photo
    expect(use).toBeDisabled();
  });

  it("disables the buttons while saving", async () => {
    const reply = deferred();
    mockApi({ "PATCH /photos/1": reply.promise });
    renderDetail(makePhoto({ point_manual: true }));
    await userEvent.click(screen.getByRole("button", { name: "Remove my position" }));
    expect(screen.getByRole("button", { name: "Remove my position" })).toBeDisabled();
    reply.resolve({ body: makePhoto() });
    expect(await screen.findByRole("button", { name: "Remove my position" })).toBeEnabled();
  });

  it.each([
    [
      "the API's message",
      () => mockApi({ "PATCH /photos/1": { status: 400, body: { detail: "lat and lon go together" } } }),
      "lat and lon go together",
    ],
    [
      "a generic message on network errors",
      () => vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline"))),
      "Could not save the position",
    ],
  ])("shows %s when saving fails", async (_, setup, message) => {
    setup();
    const { onChange } = renderDetail(makePhoto({ lat: null, lon: null }));
    clickMap(1, 2);
    await userEvent.click(screen.getByRole("button", { name: "Use this spot" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(markers()).toEqual([["1,2", "#b45309"]]); // kept, to try again
  });

  it("closes with Escape, the backdrop or the Close button", async () => {
    const { onClose } = renderDetail(makePhoto());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    const [backdrop, button] = screen.getAllByRole("button", { name: "Close" });
    await userEvent.click(backdrop);
    await userEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("stops listening for Escape once unmounted", () => {
    const { onClose, unmount } = renderDetail(makePhoto());
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
