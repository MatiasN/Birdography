import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Photo } from "../api";
import { deferred, health, makePhoto, mockApi, type Call, type Routes } from "../test/api";
import { clickMap } from "../test/leaflet";
import { stubMatchMedia } from "../test/media";
import { renderAt } from "../test/router";
import Photos from "./Photos";

vi.mock("react-leaflet", () => import("../test/leaflet"));

const MB = 1024 * 1024;

const LIMITS_HINT = "Up to 40 MB per photo, 70 MB for RAW";

/** Render with the given photos, and wait until the list and the upload limits have loaded. */
async function start(photos: Photo[] = [], extra: Routes = {}, path = "/catalogue") {
  const routes: Routes = { "GET /photos": { body: photos }, "GET /health": { body: health }, ...extra };
  const calls = mockApi(routes);
  const router = renderAt(<Photos />, path);
  await waitFor(() => expect(requests(calls).slice(0, 2)).toEqual(["GET /photos", "GET /health"]));
  if (!extra["GET /health"]) await screen.findByText(LIMITS_HINT);
  return { routes, calls, router };
}

function fileOf(name: string, size = 1): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const input = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const tiles = () => screen.queryAllByRole("button").filter((b) => b.querySelector("img"));
const requests = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path}`);
const count = (calls: Call[], request: string) => requests(calls).filter((r) => r === request).length;

const choose = (files: File[] | null) => fireEvent.change(input(), { target: { files } });

describe("Photos", () => {
  it("says when there is nothing yet", async () => {
    await start();
    expect(screen.getByText("No photos yet.")).toBeInTheDocument();
    expect(screen.getByText(LIMITS_HINT)).toBeInTheDocument();
    expect(input().accept).toContain(".nef");
    expect(input().accept).toContain(".jpg");
  });

  it("lists photos with date, camera and a hint when the position is missing", async () => {
    await start([
      makePhoto({ id: 1, taken_at_local: "2026-05-01T09:00:00", camera: "NIKON Z 5" }),
      makePhoto({ id: 2, taken_at_local: null, camera: null, lat: null, lon: null }),
    ]);
    await screen.findByText(/NIKON Z 5/);
    const [first, second] = tiles();
    expect(first).toHaveTextContent(`${new Date("2026-05-01T09:00:00").toLocaleDateString()}NIKON Z 5`);
    expect(first).not.toHaveTextContent("No position");
    expect(second).toHaveTextContent("No positionNo dateUnknown camera");
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
    await screen.findByText(/NIKON Z 5/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requests(calls)).toEqual(["GET /photos", "GET /health"]);
  });

  it("opens the file picker from the upload button", async () => {
    await start();
    const click = vi.spyOn(input(), "click").mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole("button", { name: "Upload photos" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("uploads every chosen file, then reloads the list", async () => {
    const uploaded = makePhoto({ id: 5 });
    const { routes, calls } = await start([], { "POST /photos": { status: 201, body: uploaded } });
    routes["GET /photos"] = { body: [uploaded] };
    choose([fileOf("a.jpg"), fileOf("b.nef")]);
    expect(await screen.findByText(/NIKON Z 5/)).toBeInTheDocument();
    expect(requests(calls)).toEqual(["GET /photos", "GET /health", "POST /photos", "POST /photos", "GET /photos"]);
    const form = calls[2].body;
    if (!(form instanceof FormData)) throw new Error("the upload is not a form");
    expect(form.get("file")).toHaveProperty("name", "a.jpg");
    expect(input().value).toBe("");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows that it is uploading", async () => {
    const reply = deferred();
    await start([], { "POST /photos": reply.promise });
    choose([fileOf("a.jpg")]);
    expect(screen.getByText("Uploading...")).toBeInTheDocument();
    reply.resolve({ status: 201, body: makePhoto() });
    expect(await screen.findByText("Upload photos")).toBeInTheDocument();
  });

  it("fetches a photo again once when its thumbnail was still being made", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = makePhoto({ id: 9, camera: "first", files: [] });
    const { routes, calls } = await start([], { "POST /photos": { status: 201, body: pending } });
    routes["GET /photos"] = { body: [pending] };
    routes["GET /photos/9"] = { body: makePhoto({ id: 9, camera: "with thumbnail" }) };
    choose([fileOf("big.nef")]);
    await screen.findByText(/first/);
    expect(count(calls, "GET /photos/9")).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText(/with thumbnail/)).toBeInTheDocument();
    expect(count(calls, "GET /photos/9")).toBe(1);
  });

  it("refuses files over the limit before sending them", async () => {
    const { calls } = await start([], { "POST /photos": { status: 201, body: makePhoto() } });
    choose([fileOf("huge.jpg", 41 * MB), fileOf("ok.jpg")]);
    expect(await screen.findByText("huge.jpg: image files are limited to 40 MB")).toBeInTheDocument();
    expect(count(calls, "POST /photos")).toBe(1);
  });

  it("checks sizes only once the limits are known", async () => {
    const { calls } = await start([], {
      "GET /health": deferred().promise, // never answers
      "POST /photos": { status: 201, body: makePhoto() },
    });
    expect(screen.queryByText(LIMITS_HINT)).not.toBeInTheDocument();
    choose([fileOf("huge.jpg", 41 * MB)]);
    await waitFor(() => expect(count(calls, "POST /photos")).toBe(1)); // the server still enforces its limit
  });

  it.each<[string, Routes, string]>([
    [
      "the API's reason",
      { "POST /photos": { status: 409, body: { detail: "Already uploaded" } } },
      "dup.jpg: Already uploaded",
    ],
    [
      "a generic reason on network errors",
      {
        "POST /photos": () => {
          throw new TypeError("offline");
        },
      },
      "dup.jpg: upload failed",
    ],
  ])("reports %s for each failed upload", async (_, routes, message) => {
    await start([], routes);
    choose([fileOf("dup.jpg")]);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("does nothing when the browser gives no file list", async () => {
    const { calls } = await start();
    choose([]);
    choose(null);
    await waitFor(() => expect(count(calls, "GET /photos")).toBe(3)); // each change reloads the list
    expect(count(calls, "POST /photos")).toBe(0);
  });
});
