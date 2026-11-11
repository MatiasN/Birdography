import { describe, expect, it, vi } from "vitest";
import { api, ApiError, hasFile, json, offsetLabel, photoUrl, position, send, sizeProblem, takenDate } from "./api";
import { makePhoto, me, mockApi } from "./test/api";

const MB = 1024 * 1024;
const limits = { upload_mb: 40, raw_upload_mb: 70 };

function fileOf(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("sizeProblem", () => {
  it("uses the RAW limit for RAW extensions, case-insensitively", () => {
    expect(sizeProblem(fileOf("bird.NEF", 60 * MB), limits)).toBeNull();
    expect(sizeProblem(fileOf("bird.nef", 71 * MB), limits)).toBe("bird.nef: RAW files are limited to 70 MB");
  });

  it("uses the image limit for everything else, including names without an extension", () => {
    expect(sizeProblem(fileOf("bird.jpg", 40 * MB), limits)).toBeNull();
    expect(sizeProblem(fileOf("bird.jpg", 41 * MB), limits)).toBe("bird.jpg: image files are limited to 40 MB");
    expect(sizeProblem(fileOf("bird", 41 * MB), limits)).toBe("bird: image files are limited to 40 MB");
  });
});

describe("photo helpers", () => {
  it("hasFile", () => {
    const photo = makePhoto();
    expect(hasFile(photo, "thumbnail")).toBe(true);
    expect(hasFile(photo, "preview")).toBe(false);
  });

  it("position needs both coordinates", () => {
    expect(position(makePhoto({ lat: 1, lon: 2 }))).toEqual([1, 2]);
    expect(position(makePhoto({ lat: 0, lon: 0 }))).toEqual([0, 0]);
    expect(position(makePhoto({ lat: null, lon: 2 }))).toBeNull();
    expect(position(makePhoto({ lat: 1, lon: null }))).toBeNull();
  });

  it("photoUrl defaults to the thumbnail", () => {
    expect(photoUrl(makePhoto({ id: 7 }))).toBe("/api/photos/7/file?kind=thumbnail");
    expect(photoUrl(makePhoto({ id: 7 }), "preview")).toBe("/api/photos/7/file?kind=preview");
  });

  it("takenDate is the local date as recorded", () => {
    expect(takenDate(makePhoto({ taken_at_local: "2026-05-01T23:30:00" }))).toBe(
      new Date("2026-05-01T23:30:00").toLocaleDateString(),
    );
    expect(takenDate(makePhoto({ taken_at_local: null }))).toBeNull();
  });

  it.each([
    [60, "UTC+01:00"],
    [0, "UTC+00:00"],
    [-210, "UTC-03:30"],
    [345, "UTC+05:45"],
  ])("offsetLabel(%i) is %s", (minutes, label) => {
    expect(offsetLabel(minutes)).toBe(label);
  });

  it("json builds a JSON request", () => {
    expect(json("PATCH", { a: 1 })).toEqual({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
  });
});

describe("api", () => {
  it("prefixes /api and parses JSON", async () => {
    const session = me();
    const calls = mockApi({ "GET /auth/me": { body: session } });
    await expect(api("/auth/me")).resolves.toEqual(session);
    expect(calls).toEqual([{ method: "GET", path: "/auth/me", body: undefined }]);
  });

  it("send expects no body", async () => {
    mockApi({ "POST /auth/logout": { status: 204 } });
    await expect(send("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it.each([
    ["a string detail", { detail: "Invalid email or password" }, "Invalid email or password"],
    [
      "validation errors",
      { detail: [{ msg: "String should have at least 10 characters" }, { msg: "Field required" }] },
      "String should have at least 10 characters; Field required",
    ],
    ["validation errors without messages", { detail: [{ type: "x" }, null] }, "Failed"],
    ["another detail shape", { detail: { code: 1 } }, "Failed"],
    ["no detail", {}, "Failed"],
  ])("turns %s into an ApiError", async (_, body, message) => {
    mockApi({ "POST /auth/login": { status: 401, body } });
    const error = await api("/auth/login", { method: "POST" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message });
  });

  it("falls back to the status text when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(send("/photos")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
});
