import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Photo } from "@/api";
import PhotoDetail from "@/components/PhotoDetail";
import { deferred, makePhoto, makeSpecies, mockApi } from "@/test/api";
import { clickMap } from "@/test/leaflet";

vi.mock("react-leaflet", () => import("@/test/leaflet"));

function renderDetail(photo: Photo) {
  const onChange = vi.fn<(photo: Photo) => void>();
  render(<PhotoDetail photo={photo} onChange={onChange} />);
  return { onChange };
}

const markers = () => screen.queryAllByTestId("marker").map((m) => [m.dataset.center, m.dataset.color]);

describe("PhotoDetail", () => {
  it("shows the photo's metadata", () => {
    renderDetail(
      makePhoto({ taken_at_local: "2026-05-01T09:00:00", taken_offset_minutes: -180, taken_at_manual: true }),
    );
    expect(screen.getByText("Taken").nextElementSibling).toHaveTextContent(
      new RegExp(`${new Date("2026-05-01T09:00:00").toLocaleString()}.*UTC-03:00.*set by you`),
    );
    expect(screen.getByText("Nikon Z 5")).toBeInTheDocument();
    expect(screen.getByText("NIKKOR Z 100-400mm")).toBeInTheDocument();
    expect(screen.getByText("ISO 800")).toBeInTheDocument();
    expect(screen.getByText("f/5.6")).toBeInTheDocument();
    expect(screen.getByText("1/500 s")).toBeInTheDocument();
    expect(screen.getByText("400 mm")).toBeInTheDocument();
    expect(screen.getByText("JPEG, 8 × 8 · 1 KB")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "/api/photos/1/file?kind=preview");
  });

  it("leaves out what is unknown", () => {
    renderDetail(
      makePhoto({
        taken_at_local: null,
        taken_offset_minutes: null,
        camera: null,
        lens: null,
        iso: null,
        aperture: null,
        shutter_seconds: null,
        focal_length_mm: null,
        files: [],
      }),
    );
    expect(screen.getByText("No date")).toBeInTheDocument();
    expect(screen.queryByText(/UTC|ISO|NIKON|set by you/)).not.toBeInTheDocument();
    for (const label of ["Camera", "Lens", "Settings", "File"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
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
      () =>
        vi.stubGlobal("fetch", () => {
          throw new TypeError("offline");
        }),
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

  it("writes long exposures in seconds and big files in MB, without unknown dimensions", () => {
    const original = makePhoto().files[0];
    renderDetail(
      makePhoto({
        shutter_seconds: 2,
        iso: null,
        files: [{ ...original, format: "nef", width: null, height: null, size_bytes: 52.3 * 1024 * 1024 }],
      }),
    );
    expect(screen.getByText("2 s")).toBeInTheDocument();
    expect(screen.getByText("NEF · 52.3 MB")).toBeInTheDocument();
  });
});

const section = () => screen.getByRole("heading", { name: "Species" }).parentElement!;

describe("PhotoDetail's species", () => {
  const heron = makeSpecies({ id: 1 });
  const egret = makeSpecies({ id: 2, scientific_name: "Egretta garzetta", name_en: "Little Egret", name_pt: null });

  it("lists them with their other names, or says there are none", () => {
    renderDetail(makePhoto({ species: [heron, egret] }));
    const items = within(section()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Grey HeronGarça-real · Ardea cinerea");
    expect(items[1]).toHaveTextContent("Little EgretEgretta garzetta");
  });

  it("says when there are none", () => {
    renderDetail(makePhoto());
    expect(within(section()).getByText("No species yet")).toBeInTheDocument();
  });

  it("removes one and saves at once", async () => {
    const saved = makePhoto({ species: [egret] });
    const calls = mockApi({ "PATCH /photos/1": { body: saved } });
    const { onChange } = renderDetail(makePhoto({ species: [heron, egret] }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Grey Heron" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(calls[0].body).toEqual({ species_ids: [2] });
  });

  it("adds one with the picker, after the others", async () => {
    const saved = makePhoto({ species: [heron, egret] });
    const calls = mockApi({
      "GET /species?q=egret&limit=8": { body: [heron, egret] },
      "PATCH /photos/1": { body: saved },
    });
    const { onChange } = renderDetail(makePhoto({ species: [heron] }));
    await userEvent.click(screen.getByRole("button", { name: "Add species" }));
    const field = screen.getByRole("combobox", { name: "Add species" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "egret");
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Little Egret"); // the heron is on the photo already
    await userEvent.click(options[0]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(calls.at(-1)?.body).toEqual({ species_ids: [1, 2] });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("hides the picker with Done", async () => {
    renderDetail(makePhoto());
    await userEvent.click(screen.getByRole("button", { name: "Add species" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("merges a species added by hand into the one it really is", async () => {
    const mine = makeSpecies({ id: 7, scientific_name: "Robinia fakeus", name_en: "My robin", ebird_code: null });
    const robin = makeSpecies({ id: 8, scientific_name: "Erithacus rubecula", name_en: "European Robin" });
    const after = makePhoto({ species: [robin] });
    const calls = mockApi({
      "GET /species?q=robin&limit=8": { body: [mine, robin] },
      "POST /species/7/merge-into/8": { body: robin },
      "GET /photos/1": { body: after },
    });
    const { onChange } = renderDetail(makePhoto({ species: [mine, heron] }));
    expect(screen.queryByRole("button", { name: "Merge Grey Heron into another species" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Merge My robin into another species" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/in every account, moves to it/)).toBeInTheDocument();
    await userEvent.click(toggle); // closes again
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    const field = screen.getByRole("combobox", { name: "Species My robin really is" });
    await userEvent.type(field, "robin");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1); // itself left out, and no "Add as a new species"
    await userEvent.click(options[0]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(after));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /species/7/merge-into/8");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it.each([
    ["the API's message", { status: 404, body: { detail: "Species not found" } }, "Species not found"],
    [
      "a plain one on a network error",
      () => {
        throw new TypeError("offline");
      },
      "Could not merge the species",
    ],
  ])("shows %s when merging fails", async (_, reply, message) => {
    const mine = makeSpecies({ id: 7, scientific_name: "Robinia fakeus", name_en: "My robin", ebird_code: null });
    mockApi({ "GET /species?q=robin&limit=8": { body: [heron] }, "POST /species/7/merge-into/1": reply });
    const { onChange } = renderDetail(makePhoto({ species: [mine] }));
    await userEvent.click(screen.getByRole("button", { name: "Merge My robin into another species" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Species My robin really is" }), "robin");
    await userEvent.click((await screen.findAllByRole("option"))[0]);
    expect(await within(section()).findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["the API's message", { status: 400, body: { detail: "Unknown species" } }, "Unknown species"],
    [
      "a plain one on a network error",
      () => {
        throw new TypeError("offline");
      },
      "Could not save the species",
    ],
  ])("shows %s when saving fails", async (_, reply, message) => {
    mockApi({ "PATCH /photos/1": reply });
    const { onChange } = renderDetail(makePhoto({ species: [heron] }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Grey Heron" }));
    expect(await within(section()).findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Grey Heron" })).toBeEnabled();
  });
});
