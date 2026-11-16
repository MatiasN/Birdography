import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_PX, MARKER_PX } from "../clusters";
import { makePhoto, mockApi, type Routes } from "../test/api";
import { clickMap, fakeMap } from "../test/leaflet";
import { stubMatchMedia } from "../test/media";
import { renderAt } from "../test/router";
import MapPage from "./MapPage";

vi.mock("react-leaflet", () => import("../test/leaflet"));

/** Longitude difference of `px` screen pixels at `zoom` on the equator. */
const degreesFor = (px: number, zoom: number) => (px / (256 * 2 ** zoom)) * 360;

const PORTUGAL = { lat: 37, lon: -8 };
const SYDNEY = { lat: -33.9, lon: 151.2 };

const markers = () => screen.queryAllByTestId("map-marker");
const requests = (calls: { method: string; path: string }[]) => calls.map((c) => `${c.method} ${c.path}`);

async function start(routes: Routes, path = "/map") {
  const calls = mockApi(routes);
  const router = renderAt(<MapPage />, path);
  await waitFor(() => expect(requests(calls)).toContain("GET /photos/points"));
  return Object.assign(calls, { router });
}

const sheet = (name: string) => screen.findByRole("dialog", { name });

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

  it("opens a photo from its marker, keeping it in the URL until it is closed", async () => {
    const { router } = await start({
      "GET /photos/points": { body: [{ id: 7, ...PORTUGAL }] },
      "GET /photos/7": { body: makePhoto({ id: 7, camera: "NIKON Z 9" }) },
    });
    await userEvent.click(await screen.findByTitle("Open photo"));
    expect(within(await sheet("Photo details")).getByText("NIKON Z 9")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?photo=7");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.search).toBe("");
  });

  it("opens the photo of a link, and Back from the photo closes it", async () => {
    const { router } = await start(
      {
        "GET /photos/points": { body: [{ id: 7, ...PORTUGAL }] },
        "GET /photos/7": { body: makePhoto({ id: 7 }) },
      },
      "/map?photo=7",
    );
    expect(await sheet("Photo details")).toBeInTheDocument();
    // Arrived with the link: closing drops the parameter instead of leaving the page.
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/map");
    expect(router.state.location.search).toBe("");

    await userEvent.click(screen.getByTitle("Open photo"));
    expect(await sheet("Photo details")).toBeInTheDocument();
    await act(() => router.navigate(-1)); // the browser's Back button
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("drops a photo that can't be loaded from the URL", async () => {
    const { router } = await start(
      {
        "GET /photos/points": { body: [] },
        "GET /photos/99": { status: 404, body: { detail: "Photo not found" } },
      },
      "/map?photo=99",
    );
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every photo of a group, newest first, and opens them from there", async () => {
    await start({
      "GET /photos/points": { body: [30, 10, 20].map((id) => ({ id, ...PORTUGAL })) },
      "GET /photos/10": { body: makePhoto({ id: 10 }) },
    });
    await userEvent.click(await screen.findByTitle("3 photos"));
    const panel = await sheet("3 photos here");
    const thumbnails = within(panel).getAllByRole("button", { name: /^Photo \d of 3$/ });
    expect(thumbnails.map((t) => t.querySelector("img")?.getAttribute("src"))).toEqual([
      "/api/photos/30/file?kind=thumbnail",
      "/api/photos/10/file?kind=thumbnail",
      "/api/photos/20/file?kind=thumbnail",
    ]);
    // Same spot: zooming in would never split them, so the panel doesn't offer it.
    expect(within(panel).queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();

    await userEvent.click(thumbnails[1]);
    expect(await sheet("Photo details")).toBeInTheDocument();
    // Escape closes the photo first, which brings the group back, then the group.
    await userEvent.keyboard("{Escape}");
    expect(await sheet("3 photos here")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Photo details" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
    await userEvent.click(within(await sheet("2 photos here")).getByRole("button", { name: "Zoom in" }));
    expect(fakeMap.flyTo).toHaveBeenCalledWith([expect.any(Number), expect.any(Number)], zoom + 1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByTitle("Open photo")).toHaveLength(2);
  });

  it("closes the group sheet with its Back button", async () => {
    await start({ "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) } });
    await userEvent.click(await screen.findByTitle("2 photos"));
    await userEvent.click(within(await sheet("2 photos here")).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reloads the markers when a photo's position changes, without reframing the map", async () => {
    const routes: Routes = {
      "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) },
      "GET /photos/1": { body: makePhoto({ id: 1, point_manual: true }) },
      "PATCH /photos/1": { body: makePhoto({ id: 1, lat: SYDNEY.lat, lon: SYDNEY.lon, point_manual: true }) },
    };
    const calls = await start(routes);
    await userEvent.click(await screen.findByTitle("2 photos"));
    await userEvent.click(within(await sheet("2 photos here")).getByRole("button", { name: "Photo 1 of 2" }));
    const dialog = await sheet("Photo details");

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
    // The group may have split; closing the photo shows the map, not a stale group.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("says when no photo has a position yet", async () => {
    await start({ "GET /photos/points": { body: [] } });
    expect(await screen.findByText("No photos with a position yet.")).toBeInTheDocument();
    expect(markers()).toEqual([]);
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
  });

  it("redraws the map when its container changes size (a panel opening beside it)", async () => {
    const observed: Element[] = [];
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );
    await start({ "GET /photos/points": { body: [] } });
    expect(observed).toContain(fakeMap.getContainer());
    resize?.();
    expect(fakeMap.invalidateSize).toHaveBeenCalled();
  });
});

describe("MapPage on a wide screen", () => {
  beforeEach(() => stubMatchMedia(false, true));

  it("shows the group and the photo in a side panel beside the map", async () => {
    await start({
      "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) },
      "GET /photos/2": { body: makePhoto({ id: 2 }) },
    });
    await userEvent.click(await screen.findByTitle("2 photos"));
    const group = screen.getByRole("complementary", { name: "2 photos here" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: "Photo 2 of 2" }));
    expect(await screen.findByRole("complementary", { name: "Photo details" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "2 photos here" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" }); // the photo first
    expect(await screen.findByRole("complementary", { name: "2 photos here" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it.each(["Enter", " "])("opens a focused marker with %j", async (key) => {
    await start({
      "GET /photos/points": { body: [1, 2].map((id) => ({ id, ...PORTUGAL })) },
    });
    const group = await screen.findByTitle("2 photos");
    fireEvent.keyDown(group, { key: "Tab" }); // other keys do nothing
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(group, { key });
    expect(await sheet("2 photos here")).toBeInTheDocument();
  });
});
