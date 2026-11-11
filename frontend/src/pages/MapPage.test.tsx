import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_PX, MARKER_PX } from "../clusters";
import { makePhoto, mockApi, type Routes } from "../test/api";
import { clickMap, fakeMap } from "../test/leaflet";
import MapPage from "./MapPage";

vi.mock("react-leaflet", () => import("../test/leaflet"));

/** Longitude difference of `px` screen pixels at `zoom` on the equator. */
const degreesFor = (px: number, zoom: number) => (px / (256 * 2 ** zoom)) * 360;

const PORTUGAL = { lat: 37, lon: -8 };
const SYDNEY = { lat: -33.9, lon: 151.2 };

const markers = () => screen.queryAllByTestId("map-marker");
const requests = (calls: { method: string; path: string }[]) => calls.map((c) => `${c.method} ${c.path}`);

async function start(routes: Routes) {
  const calls = mockApi(routes);
  render(<MapPage />);
  await waitFor(() => expect(requests(calls)).toContain("GET /photos/points"));
  return calls;
}

beforeEach(() => fakeMap.reset());

describe("MapPage", () => {
  it("frames every located photo and draws one marker per photo when none overlap", async () => {
    await start({
      "GET /photos/points": {
        body: [
          { id: 1, ...PORTUGAL },
          { id: 2, ...SYDNEY },
        ],
      },
    });
    await waitFor(() => expect(markers()).toHaveLength(2));
    expect(fakeMap.fitBounds).toHaveBeenCalledWith(
      [
        [SYDNEY.lat, PORTUGAL.lon],
        [PORTUGAL.lat, SYDNEY.lon],
      ],
      { padding: [MARKER_PX, MARKER_PX], maxZoom: 12 },
    );
    const photo = screen.getAllByTitle("Open photo")[0];
    expect(photo.querySelector("span")?.style.backgroundImage).toBe('url("/api/photos/1/file?kind=thumbnail")');
  });

  it("joins overlapping markers into one showing how many photos it holds", async () => {
    await start({
      "GET /photos/points": { body: [1, 2, 3].map((id) => ({ id, ...PORTUGAL })).concat({ id: 4, ...SYDNEY }) },
    });
    const group = await screen.findByTitle("3 photos");
    expect(group).toHaveTextContent("3");
    expect(markers()).toHaveLength(2);
  });

  it("redraws when the map moves", async () => {
    await start({
      "GET /photos/points": {
        body: [
          { id: 1, ...PORTUGAL },
          { id: 2, ...SYDNEY },
        ],
      },
    });
    await waitFor(() => expect(markers()).toHaveLength(2));
    fakeMap.view([-10, 35, -6, 39], 8); // only Portugal in view
    expect(markers()).toHaveLength(1);
    // supercluster's project/unproject round trip leaves float dust (37.000000000000036), so parse and compare.
    const [lat, lon] = (markers()[0].getAttribute("data-position") ?? "").split(",").map(Number);
    expect(lat).toBeCloseTo(37, 6);
    expect(lon).toBeCloseTo(-8, 6);
  });

  it("opens a photo from its marker", async () => {
    await start({
      "GET /photos/points": { body: [{ id: 7, ...PORTUGAL }] },
      "GET /photos/7": { body: makePhoto({ id: 7, camera: "NIKON Z 9" }) },
    });
    await userEvent.click(await screen.findByTitle("Open photo"));
    const dialog = await screen.findByRole("dialog", { name: "Photo details" });
    expect(within(dialog).getByText("NIKON Z 9")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every photo of a group, newest first, and opens them from there", async () => {
    await start({
      "GET /photos/points": { body: [30, 10, 20].map((id) => ({ id, ...PORTUGAL })) },
      "GET /photos/10": { body: makePhoto({ id: 10 }) },
    });
    await userEvent.click(await screen.findByTitle("3 photos"));
    const panel = screen.getByRole("region", { name: "Photos at this spot" });
    expect(within(panel).getByRole("heading")).toHaveTextContent("3 photos");
    const thumbnails = within(panel).getAllByRole("button", { name: /^Photo \d of 3$/ });
    expect(thumbnails.map((t) => t.querySelector("img")?.getAttribute("src"))).toEqual([
      "/api/photos/30/file?kind=thumbnail",
      "/api/photos/10/file?kind=thumbnail",
      "/api/photos/20/file?kind=thumbnail",
    ]);
    // Same spot: zooming in would never split them, so the panel doesn't offer it.
    expect(within(panel).queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();

    await userEvent.click(thumbnails[1]);
    expect(await screen.findByRole("dialog", { name: "Photo details" })).toBeInTheDocument();
    // Escape closes the photo first, then the panel.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Photos at this spot" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Photos at this spot" })).not.toBeInTheDocument();
  });

  it("zooms into a group until it splits", async () => {
    const zoom = fakeMap.zoom;
    const near = { lat: 0, lon: degreesFor(JOIN_PX * 0.9, zoom) }; // joined at this zoom, not at the next
    await start({
      "GET /photos/points": {
        body: [
          { id: 1, lat: 0, lon: 0 },
          { id: 2, ...near },
        ],
      },
    });
    await userEvent.click(await screen.findByTitle("2 photos"));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(fakeMap.flyTo).toHaveBeenCalledWith([expect.any(Number), expect.any(Number)], zoom + 1);
    expect(screen.queryByRole("region", { name: "Photos at this spot" })).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Open photo")).toHaveLength(2);
  });

  it("closes the group panel from its button", async () => {
    await start({ "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) } });
    await userEvent.click(await screen.findByTitle("2 photos"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("reloads the markers when a photo's position changes, without reframing the map", async () => {
    const routes: Routes = {
      "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) },
      "GET /photos/1": { body: makePhoto({ id: 1, point_manual: true }) },
      "PATCH /photos/1": { body: makePhoto({ id: 1, lat: SYDNEY.lat, lon: SYDNEY.lon, point_manual: true }) },
    };
    const calls = await start(routes);
    await userEvent.click(await screen.findByTitle("2 photos"));
    await userEvent.click(screen.getByRole("button", { name: "Photo 1 of 2" }));
    const dialog = await screen.findByRole("dialog");

    routes["GET /photos/points"] = {
      body: [
        { id: 1, ...SYDNEY },
        { id: 2, ...PORTUGAL },
      ],
    };
    clickMap(SYDNEY.lat, SYDNEY.lon);
    await userEvent.click(within(dialog).getByRole("button", { name: "Use this spot" }));
    await waitFor(() => expect(screen.getAllByTitle("Open photo")).toHaveLength(2));
    expect(requests(calls).filter((r) => r === "GET /photos/points")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Photos at this spot" })).not.toBeInTheDocument();
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("says when no photo has a position yet", async () => {
    await start({ "GET /photos/points": { body: [] } });
    expect(await screen.findByText("No photos with a position yet.")).toBeInTheDocument();
    expect(markers()).toEqual([]);
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
  });
});

describe("keyboard", () => {
  it.each(["Enter", " "])("opens a focused marker with %j", async (key) => {
    await start({
      "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) },
    });
    const group = await screen.findByTitle("2 photos");
    fireEvent.keyDown(group, { key: "Tab" }); // other keys do nothing
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    fireEvent.keyDown(group, { key });
    expect(screen.getByRole("region", { name: "Photos at this spot" })).toBeInTheDocument();
  });
});
