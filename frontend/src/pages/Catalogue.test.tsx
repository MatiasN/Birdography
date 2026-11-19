import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera, Photo } from "@/api";
import { deferred, makePhoto, makeSpecies, mockApi, type Call, type Routes } from "@/test/api";
import { clickMap } from "@/test/leaflet";
import { stubMatchMedia } from "@/test/media";
import { renderAt } from "@/test/router";
import Catalogue, { PAGE } from "@/pages/Catalogue";

vi.mock("react-leaflet", () => import("@/test/leaflet"));

const LIST = `GET /photos?limit=${PAGE}&offset=0`;
const FIRST_REQUESTS = ["GET /photos/summary", "GET /photos/cameras", LIST] as const;
const CAMERAS: Camera[] = [
  { make: "Nikon", model: "Z 8", photos: 5 },
  { make: "Canon", model: "EOS R5", photos: 3 },
  { make: "Nikon", model: "Z 5", photos: 1 },
  { make: null, model: "SM-G973U", photos: 1 },
];

/** Render with the given photos, and wait until the first page is on screen (or the empty state). */
async function start(photos: Photo[] = [], extra: Routes = {}, path = "/catalogue") {
  const routes: Routes = {
    [LIST]: { body: photos },
    "GET /photos/summary": { body: { photos: photos.length, species: 2 } },
    "GET /photos/cameras": { body: CAMERAS },
    ...extra,
  };
  const calls = mockApi(routes);
  const router = renderAt(<Catalogue />, path);
  await waitFor(() => expect(requests(calls)).toEqual(expect.arrayContaining([...FIRST_REQUESTS].slice(0, 2))));
  // A plain catalogue: wait for its tiles. With a query, the test waits for what it expects itself.
  const expected = path.includes("?") ? null : photos.length;
  await waitFor(() => expect(expected === null || tiles().length === expected).toBe(true));
  return { routes, calls, router };
}

const tiles = () => screen.queryAllByRole("button").filter((b) => b.querySelector("img"));
const requests = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path}`);
const many = (count: number, from = 1) => Array.from({ length: count }, (_, i) => makePhoto({ id: from + i }));

afterEach(() => vi.useRealTimers());

describe("Catalogue", () => {
  it("counts the photos and species, and links to the Upload tab", async () => {
    await start([makePhoto({ id: 1 })]);
    expect(await screen.findByText("1 photo · 2 species")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload" })).toHaveAttribute("href", "/upload");
    expect(screen.queryByRole("button", { name: /upload photos/i })).not.toBeInTheDocument(); // the button moved
  });

  it("explains an empty catalogue and points to the Upload tab, without filters to use", async () => {
    await start();
    expect(await screen.findByRole("heading", { level: 2, name: "No photos yet." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload photos" })).toHaveAttribute("href", "/upload");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says when the photos can't be loaded", async () => {
    await start([], { [LIST]: { status: 500, body: { detail: "boom" } } });
    expect(await screen.findByText("Could not load the photos")).toBeInTheDocument();
    expect(screen.queryByText("No photos yet.")).not.toBeInTheDocument();
  });

  it("still works when the counts and cameras can't be loaded", async () => {
    await start([makePhoto({ id: 1 })], {
      "GET /photos/summary": { status: 500, body: {} },
      "GET /photos/cameras": { status: 500, body: {} },
    });
    expect(tiles()).toHaveLength(1);
    expect(screen.queryByText(/photos? · /)).not.toBeInTheDocument();
  });

  it("shows each photo's first species, how many more it has, and names the open photo after it", async () => {
    const heron = makeSpecies({ id: 1 });
    const egret = makeSpecies({ id: 2, name_en: null, name_pt: "Garça-branca-pequena" });
    await start([makePhoto({ id: 1, species_ids: [1, 2], species: [heron, egret] }), makePhoto({ id: 2 })]);
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(tiles()[0]).toHaveTextContent(/^Grey Heron \+1/);
    expect(tiles()[1]).toHaveTextContent(/^No species yet/);

    await userEvent.click(tiles()[0]);
    expect(await screen.findByRole("dialog", { name: "Grey Heron" })).toBeInTheDocument();
  });

  it("lists photos with date, camera and a hint when the position is missing", async () => {
    await start([
      makePhoto({ id: 1, taken_at_local: "2026-05-01T09:00:00", camera: "Nikon Z 5" }),
      makePhoto({ id: 2, taken_at_local: null, camera: null, lat: null, lon: null }),
    ]);
    await screen.findByText(/Nikon Z 5/);
    const [first, second] = tiles();
    expect(first).toHaveTextContent(
      `No species yet${new Date("2026-05-01T09:00:00").toLocaleDateString()} · Nikon Z 5`,
    );
    expect(first).not.toHaveTextContent("No position");
    expect(second).toHaveTextContent("No positionNo species yetNo date · Unknown camera");
    expect(first.querySelector("img")).toHaveAttribute("src", "/api/photos/1/file?kind=thumbnail");
    expect(screen.queryByText("No photos yet.")).not.toBeInTheDocument();
  });

  it("opens a photo, keeps it in sync with what the detail saves, and closes it", async () => {
    const saved = makePhoto({ id: 2, lat: 38, lon: -9, point_manual: true });
    await start([makePhoto({ id: 1 }), makePhoto({ id: 2, lat: null, lon: null })], {
      "PATCH /photos/2": { body: saved },
    });
    await screen.findByText(/No position/);
    await userEvent.click(tiles()[1]);
    const dialog = await screen.findByRole("dialog", { name: "Photo details" });
    const use = await within(dialog).findByRole("button", { name: "Use this spot" }); // the detail loads lazily
    clickMap(38, -9);
    await userEvent.click(use);
    expect(await within(dialog).findByText("Position chosen by you.")).toBeInTheDocument();
    expect(screen.queryByText(/No position/)).not.toBeInTheDocument(); // the tile got the saved photo too
    await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(tiles()[1]).toHaveFocus()); // the sheet has no Radix trigger; focus goes back to the tile
  });

  it("keeps the open photo in the URL: a new entry to open, replaced when switching, gone when closed", async () => {
    stubMatchMedia(false, true); // wide: the panel sits beside the grid, which stays clickable
    const { router } = await start([makePhoto({ id: 1 }), makePhoto({ id: 2 })]);
    await userEvent.click(tiles()[0]);
    expect(router.state.location.search).toBe("?photo=1");
    expect(tiles()[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "Photo details" })).toBeInTheDocument();
    await userEvent.click(tiles()[1]);
    expect(router.state.location.search).toBe("?photo=2");
    await act(() => router.navigate(-1)); // Back closes the panel instead of returning to photo 1
    expect(router.state.location.search).toBe("");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("opens the photo of a link, fetching it when it isn't on the loaded page", async () => {
    const older = makePhoto({ id: 9, camera: "Canon EOS R5" });
    const { router } = await start([makePhoto({ id: 1 })], { "GET /photos/9": { body: older } }, "/catalogue?photo=9");
    const dialog = await screen.findByRole("dialog", { name: "Photo details" });
    expect(within(dialog).getByText("Canon EOS R5")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(router.state.location.search).toBe("")); // dropped, not a step back out of the page
    expect(router.state.location.pathname).toBe("/catalogue");
  });

  it("keeps a fetched photo in sync with what the detail saves", async () => {
    const older = makePhoto({ id: 9, lat: null, lon: null });
    await start(
      [makePhoto({ id: 1 })],
      {
        "GET /photos/9": { body: older },
        "PATCH /photos/9": { body: makePhoto({ id: 9, lat: 38, lon: -9, point_manual: true }) },
      },
      "/catalogue?photo=9",
    );
    const dialog = await screen.findByRole("dialog", { name: "Photo details" });
    clickMap(38, -9);
    await userEvent.click(within(dialog).getByRole("button", { name: "Use this spot" }));
    expect(await within(dialog).findByText("Position chosen by you.")).toBeInTheDocument();
  });

  it("drops a photo that doesn't exist from the URL", async () => {
    const { router } = await start(
      [],
      { "GET /photos/9": { status: 404, body: { detail: "Photo not found" } } },
      "/catalogue?photo=9",
    );
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a photo parameter that isn't an id", async () => {
    const { calls } = await start([makePhoto({ id: 1 })], {}, "/catalogue?photo=abc");
    await screen.findByText(/Nikon Z 5/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requests(calls)).toEqual([...FIRST_REQUESTS]);
  });

  it("loads the next page with Load more, until a page comes back short", async () => {
    const next = `GET /photos?limit=${PAGE}&offset=${PAGE}`;
    const later = deferred();
    const { calls } = await start(many(PAGE), { [next]: later.promise });
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    // A photo moved up meanwhile (an upload): it isn't shown twice.
    later.resolve({ body: [makePhoto({ id: PAGE }), ...many(9, PAGE + 1)] });
    await waitFor(() => expect(tiles()).toHaveLength(PAGE + 9));
    expect(screen.queryByRole("button", { name: /Load more|Loading/ })).not.toBeInTheDocument();
    expect(requests(calls).filter((r) => r === next)).toHaveLength(1);
  });

  it("asks for the next page once, however often it is triggered while loading", async () => {
    type Seen = (entries: { isIntersecting: boolean }[]) => void;
    const seen: Seen[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: Seen) {
          seen.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const next = `GET /photos?limit=${PAGE}&offset=${PAGE}`;
    const later = deferred();
    const { calls } = await start(many(PAGE), { [next]: later.promise });
    act(() => seen[0]([{ isIntersecting: true }]));
    act(() => seen[0]([{ isIntersecting: true }]));
    expect(requests(calls).filter((r) => r === next)).toHaveLength(1);
    later.resolve({ body: [] });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more|Loading/ })).not.toBeInTheDocument());
  });

  it.each([
    ["a page", { body: many(5, 500) }],
    ["a failure", { status: 500, body: {} }],
  ])("drops %s that arrives after the filters changed", async (_, reply) => {
    const next = `GET /photos?limit=${PAGE}&offset=${PAGE}`;
    const later = deferred();
    const { router } = await start(many(PAGE), {
      [next]: later.promise,
      [`GET /photos?located=true&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 1 })] },
      "GET /photos/summary?located=true": { body: { photos: 1, species: 0 } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await act(() => router.navigate("/catalogue?located=true"));
    await waitFor(() => expect(tiles()).toHaveLength(1));
    later.resolve(reply);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading…" })).not.toBeInTheDocument());
    expect(tiles()).toHaveLength(1);
    expect(screen.queryByText("Could not load more photos")).not.toBeInTheDocument();
  });

  it("says when the next page can't be loaded, keeping what is shown", async () => {
    await start(many(PAGE), { [`GET /photos?limit=${PAGE}&offset=${PAGE}`]: { status: 500, body: {} } });
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Could not load more photos")).toBeInTheDocument();
    expect(tiles()).toHaveLength(PAGE);
  });

  it("loads the next page by itself when Load more scrolls into view", async () => {
    type Seen = (entries: { isIntersecting: boolean }[]) => void;
    const observers: { callback: Seen; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect = vi.fn<() => void>();
        constructor(callback: Seen) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
    const next = `GET /photos?limit=${PAGE}&offset=${PAGE}`;
    const { calls } = await start(many(PAGE), { [next]: { body: many(3, PAGE + 1) } });
    const [observer] = observers;
    act(() => observer.callback([{ isIntersecting: false }]));
    expect(requests(calls)).not.toContain(next);
    act(() => observer.callback([{ isIntersecting: true }]));
    await waitFor(() => expect(tiles()).toHaveLength(PAGE + 3));
    expect(observer.disconnect).toHaveBeenCalled(); // the button went away with the last page
  });
});

/** One photo for the list and the summary of this filter query. */
const answer = (query: string) => ({
  [`GET /photos?${query}&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 1 })] },
  [`GET /photos/summary?${query}`]: { body: { photos: 1, species: 0 } },
});
const dateButton = () => screen.getByRole("button", { name: /^Date: / });

describe("Catalogue filters", () => {
  const heron = makeSpecies({ id: 1 });
  const egret = makeSpecies({ id: 2, scientific_name: "Egretta garzetta", name_en: "Little Egret", name_pt: null });

  it("filters by species picked in the search, in the URL, and counts what matches", async () => {
    const filtered = `GET /photos?species_id=1&limit=${PAGE}&offset=0`;
    const { router, calls } = await start(many(3), {
      "GET /species?q=heron&limit=8&photographed=true": { body: [heron, egret] },
      [filtered]: { body: [makePhoto({ id: 2, species_ids: [1], species: [heron] })] },
      "GET /photos/summary?species_id=1": { body: { photos: 1, species: 1 } },
    });
    await userEvent.type(screen.getByRole("combobox", { name: "Filter by species" }), "heron");
    expect(screen.queryByRole("option", { name: /new species/ })).not.toBeInTheDocument(); // filtering only
    await userEvent.click(await screen.findByRole("option", { name: /Grey Heron/ }));

    expect(router.state.location.search).toBe("?species=1");
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(within(screen.getByRole("list", { name: "Species in the filter" })).getByText("Grey Heron")).toBeVisible();
    expect(screen.getAllByText("1 of 3 photos")).toHaveLength(2); // in the bar, and under it on phones
    expect(requests(calls)).toContain("GET /photos/summary?species_id=1");

    await act(() => router.navigate(-1)); // Back undoes the filter
    await waitFor(() => expect(tiles()).toHaveLength(3));
    expect(screen.queryByText("1 of 3 photos")).not.toBeInTheDocument();
  });

  it("names the species of a filter from a link, and drops one that is gone", async () => {
    const { router } = await start(
      [],
      {
        [`GET /photos?species_id=1&species_id=7&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 4 })] },
        [`GET /photos?species_id=1&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 4 })] },
        "GET /photos/summary?species_id=1&species_id=7": { body: { photos: 1, species: 1 } },
        "GET /photos/summary?species_id=1": { body: { photos: 1, species: 1 } },
        "GET /species/1": { body: heron },
        "GET /species/7": { status: 404, body: { detail: "Species not found" } },
      },
      "/catalogue?species=1,7,1,x",
    );
    const chips = await screen.findByRole("list", { name: "Species in the filter" });
    await waitFor(() => expect(router.state.location.search).toBe("?species=1"));
    expect(within(chips).getByRole("listitem")).toHaveTextContent("Grey Heron");
  });

  it("removes one species from the filter, keeping the open photo", async () => {
    stubMatchMedia(false, true); // wide: the panel leaves the filters usable
    const { router } = await start(
      [],
      {
        [`GET /photos?species_id=1&species_id=2&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 5 })] },
        [`GET /photos?species_id=2&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 5 })] },
        "GET /photos/summary?species_id=1&species_id=2": { body: { photos: 1, species: 2 } },
        "GET /photos/summary?species_id=2": { body: { photos: 1, species: 1 } },
        "GET /species/1": { body: heron },
        "GET /species/2": { body: egret },
      },
      "/catalogue?species=1,2&photo=5",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Remove Grey Heron from the filter" }));
    const params = new URLSearchParams(router.state.location.search);
    expect([params.get("species"), params.get("photo")]).toEqual(["2", "5"]);
    expect(await screen.findByRole("complementary", { name: "Photo details" })).toBeInTheDocument();
  });

  it("shows … for a species whose name is still loading", async () => {
    const later = deferred();
    await start(
      [],
      {
        [`GET /photos?species_id=1&limit=${PAGE}&offset=0`]: { body: [] },
        "GET /photos/summary?species_id=1": { body: { photos: 0, species: 0 } },
        "GET /species/1": later.promise,
      },
      "/catalogue?species=1",
    );
    expect(await screen.findByRole("button", { name: "Remove … from the filter" })).toBeInTheDocument();
    later.resolve({ body: heron });
    expect(await screen.findByRole("button", { name: "Remove Grey Heron from the filter" })).toBeInTheDocument();
  });

  it("filters by brand, or by brand and model, from the user's cameras", async () => {
    const { router } = await start(many(2), {
      [`GET /photos?camera_make=Nikon&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 1 })] },
      "GET /photos/summary?camera_make=Nikon": { body: { photos: 6, species: 1 } },
      [`GET /photos?camera_make=Canon&camera_model=EOS+R5&limit=${PAGE}&offset=0`]: { body: [] },
      "GET /photos/summary?camera_make=Canon&camera_model=EOS+R5": { body: { photos: 0, species: 0 } },
      [`GET /photos?camera_model=SM-G973U&limit=${PAGE}&offset=0`]: { body: [] },
      "GET /photos/summary?camera_model=SM-G973U": { body: { photos: 0, species: 0 } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Camera: Any camera" }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByRole("button", { name: /All Nikon\s*6/ })).toBeInTheDocument(); // Z 8 and Z 5 together
    await userEvent.click(within(menu).getByRole("button", { name: /All Nikon\s*6/ }));
    expect(router.state.location.search).toBe("?make=Nikon");
    expect(await screen.findByRole("button", { name: "Camera: Nikon" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Camera: Nikon" }));
    expect(within(await screen.findByRole("dialog")).getByRole("button", { name: /All Nikon\s*6/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Canon EOS R5\s*3/ }));
    expect(router.state.location.search).toBe("?make=Canon&model=EOS+R5");
    expect(await screen.findByText("No photos match these filters")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Camera: Canon EOS R5" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /SM-G973U\s*1/ }));
    expect(router.state.location.search).toBe("?model=SM-G973U");

    await userEvent.click(screen.getByRole("button", { name: "Clear the camera filter" }));
    expect(router.state.location.search).toBe("");
  });

  it("says when no camera is recorded yet", async () => {
    await start(many(1), { "GET /photos/cameras": { body: [] } });
    await userEvent.click(screen.getByRole("button", { name: "Camera: Any camera" }));
    expect(await screen.findByText("No camera recorded in your photos yet")).toBeInTheDocument();
  });

  it("filters by position", async () => {
    const { router } = await start(many(2), {
      [`GET /photos?located=false&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 2, lat: null, lon: null })] },
      "GET /photos/summary?located=false": { body: { photos: 1, species: 0 } },
      [`GET /photos?located=true&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 1 })] },
      "GET /photos/summary?located=true": { body: { photos: 1, species: 0 } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Position: Any position" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Without position" }));
    expect(router.state.location.search).toBe("?located=false");
    await userEvent.click(await screen.findByRole("button", { name: "Position: Without position" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "With position" }));
    expect(router.state.location.search).toBe("?located=true");
    await userEvent.click(await screen.findByRole("button", { name: "Position: With position" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Any position" }));
    expect(router.state.location.search).toBe("");
    await act(() => router.navigate("/catalogue?located=true"));
    await userEvent.click(await screen.findByRole("button", { name: "Clear the position filter" }));
    expect(router.state.location.search).toBe("");
  });

  it("filters by the days on the camera's clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 17, 12));
    const { router } = await start(many(2), {
      ...answer("date_from=2026-10-18"),
      ...answer("date_from=2026-01-01"),
      ...answer("date_from=2026-05-01&date_to=2026-05-31"),
      ...answer("date_from=2026-05-14&date_to=2026-05-14"),
      ...answer("date_to=2026-05-14"),
    });
    await userEvent.click(dateButton());
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Last 30 days" }));
    expect(router.state.location.search).toBe("?from=2026-10-18");
    await waitFor(() => expect(dateButton()).toHaveAccessibleName(/Date: From/));

    await userEvent.click(dateButton());
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "This year" }));
    expect(router.state.location.search).toBe("?from=2026-01-01");

    await userEvent.click(dateButton());
    let menu = await screen.findByRole("dialog");
    await userEvent.clear(within(menu).getByLabelText("From"));
    await userEvent.type(within(menu).getByLabelText("From"), "2026-05-01");
    await userEvent.type(within(menu).getByLabelText("To"), "2026-05-31");
    await userEvent.click(within(menu).getByRole("button", { name: "Apply" }));
    expect(router.state.location.search).toBe("?from=2026-05-01&to=2026-05-31");
    await waitFor(() => expect(dateButton()).toHaveAccessibleName(/ – /));

    await act(() => router.navigate("/catalogue?from=2026-05-14&to=2026-05-14"));
    await waitFor(() => expect(dateButton()).not.toHaveAccessibleName(/ – /)); // one day: its date alone

    await userEvent.click(dateButton());
    menu = await screen.findByRole("dialog");
    await userEvent.clear(within(menu).getByLabelText("From"));
    await userEvent.click(within(menu).getByRole("button", { name: "Apply" }));
    expect(router.state.location.search).toBe("?to=2026-05-14");
    await waitFor(() => expect(dateButton()).toHaveAccessibleName(/Date: Until/));

    await userEvent.click(screen.getByRole("button", { name: "Clear the date filter" }));
    expect(router.state.location.search).toBe("");
  });

  it("shows the filtered photos without a count when the count can't be loaded", async () => {
    await start(
      many(2),
      {
        [`GET /photos?located=true&limit=${PAGE}&offset=0`]: { body: [makePhoto({ id: 1 })] },
        "GET /photos/summary?located=true": { status: 500, body: {} },
      },
      "/catalogue?located=true",
    );
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(screen.queryByText(/ of 2 photos/)).not.toBeInTheDocument();
  });

  it("clears every filter from the no-results state", async () => {
    stubMatchMedia(false, true);
    const { router } = await start(
      many(1),
      {
        [`GET /photos?located=false&limit=${PAGE}&offset=0`]: { body: [] },
        "GET /photos/summary?located=false": { body: { photos: 0, species: 0 } },
        "GET /photos/1": { body: makePhoto({ id: 1 }) },
      },
      "/catalogue?located=false&photo=1",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(router.state.location.search).toBe("?photo=1");
  });

  it("ignores answers for filters that changed meanwhile", async () => {
    const slow = deferred();
    const { router } = await start(many(2), {
      [`GET /photos?located=true&limit=${PAGE}&offset=0`]: slow.promise,
      "GET /photos/summary?located=true": { body: { photos: 1, species: 0 } },
    });
    await act(() => router.navigate("/catalogue?located=true"));
    await act(() => router.navigate("/catalogue"));
    slow.resolve({ body: [makePhoto({ id: 9 })] });
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(screen.queryByText("1 of 2 photos")).not.toBeInTheDocument();
  });
});
