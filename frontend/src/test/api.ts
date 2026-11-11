import { vi } from "vitest";
import type { Photo, PhotoFile, User } from "../api";

export type Answer = { status?: number; body?: unknown };
/** An answer, one that arrives later (see `deferred`), or a function that throws, as fetch does on network errors. */
type Reply = Answer | Promise<Answer> | (() => never);
/** Replies keyed by "METHOD /path?query" (the path after /api). */
export type Routes = Record<string, Reply>;

/** A promise the test resolves when it wants, to look at what happens in between. */
export function deferred<T = Answer>() {
  const handle: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((done) => (handle.resolve = done));
  return { promise, resolve: (value: T) => handle.resolve?.(value) };
}

export type Call = { method: string; path: string; body: unknown };

/** Replace fetch with canned API replies; returns the calls made, in order. Unknown routes fail the test. */
export function mockApi(routes: Routes): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = url.replace(/^\/api/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, body });
    const reply = routes[`${method} ${path}`];
    if (reply === undefined) throw new Error(`unexpected request: ${method} ${path}`);
    if (typeof reply === "function") return reply();
    const { status = 200, body: payload } = await reply;
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), {
      status,
      statusText: status >= 400 ? "Failed" : "OK",
    });
  });
  return calls;
}

const file = (kind: PhotoFile["kind"]): PhotoFile => ({
  kind,
  url: `/photos/1/file?kind=${kind}`,
  format: "jpeg",
  is_raw: false,
  size_bytes: 1000,
  width: 8,
  height: 8,
});

export function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 1,
    uploaded_at: "2026-05-01T10:00:00Z",
    taken_at: "2026-05-01T08:00:00Z",
    taken_at_local: "2026-05-01T09:00:00",
    taken_offset_minutes: 60,
    taken_at_manual: false,
    camera: "NIKON Z 5",
    lens: "NIKKOR Z 100-400mm",
    iso: 800,
    shutter_seconds: 0.002,
    aperture: 5.6,
    focal_length_mm: 400,
    lat: 37.02,
    lon: -7.93,
    point_manual: false,
    species_ids: [],
    location_id: null,
    files: [file("original"), file("thumbnail")],
    ...overrides,
  };
}

/** /auth/me's shape; expires far enough out that Layout's timer never fires during a test. */
export const me = (overrides: Partial<User> = {}) => ({
  id: 1,
  email: "me@example.com",
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  ...overrides,
});

export const health = { status: "ok", postgis: "3.5", exiftool: "13.63", limits: { upload_mb: 40, raw_upload_mb: 70 } };
