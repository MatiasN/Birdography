import { describe, expect, it, vi } from "vitest";
import {
  api,
  isJpeg,
  isRaw,
  stem,
  photoTitle,
  speciesName,
  speciesOtherNames,
  ApiError,
  json,
  offsetLabel,
  fileUrl,
  errorText,
  position,
  send,
  SESSION_EXPIRED,
  sizeProblem,
  takenDate,
} from "@/api";
import { makePhoto, makeSpecies, me, mockApi } from "@/test/api";

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
  it("position needs both coordinates", () => {
    expect(position(makePhoto({ lat: 1, lon: 2 }))).toEqual([1, 2]);
    expect(position(makePhoto({ lat: 0, lon: 0 }))).toEqual([0, 0]);
    expect(position(makePhoto({ lat: null, lon: 2 }))).toBeNull();
    expect(position(makePhoto({ lat: 1, lon: null }))).toBeNull();
  });

  it("fileUrl defaults to the thumbnail", () => {
    expect(fileUrl(7)).toBe("/api/photos/7/file?kind=thumbnail");
    expect(fileUrl(7, "preview")).toBe("/api/photos/7/file?kind=preview");
  });

  it("errorText takes the API's message, else the fallback", () => {
    expect(errorText(new ApiError(400, "Unknown species"), "Could not save")).toBe("Unknown species");
    expect(errorText(new TypeError("Failed to fetch"), "Could not save")).toBe("Could not save");
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

  it.each([
    ["/photos", true],
    ["/auth/me", true],
    ["/auth/login", false],
    ["/auth/password", false],
  ])("fires session-expired on a 401 from %s: %s", async (path, fired) => {
    mockApi({ [`GET ${path}`]: { status: 401, body: { detail: "Not authenticated" } } });
    const seen = vi.fn<() => void>();
    window.addEventListener(SESSION_EXPIRED, seen);
    await expect(api(path)).rejects.toMatchObject({ status: 401 });
    window.removeEventListener(SESSION_EXPIRED, seen);
    expect(seen.mock.calls.length > 0).toBe(fired);
  });

  it("does not fire session-expired on other failures", async () => {
    mockApi({ "GET /photos": { status: 500, body: {} } });
    const seen = vi.fn<() => void>();
    window.addEventListener(SESSION_EXPIRED, seen);
    await expect(api("/photos")).rejects.toMatchObject({ status: 500 });
    window.removeEventListener(SESSION_EXPIRED, seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("falls back to the status text when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(send("/photos")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
});

describe("file names", () => {
  it("tells RAW from JPEG and finds what a pair shares", () => {
    const nef = new File([""], "DSC_0001.NEF");
    const jpg = new File([""], "dsc_0001.jpg");
    expect([isRaw(nef), isRaw(jpg), isJpeg(nef), isJpeg(jpg)]).toEqual([true, false, false, true]);
    expect(stem(nef)).toBe(stem(jpg));
    expect(stem(new File([""], "noext"))).toBe("noext"); // no dot: the whole name
  });
});

describe("species names", () => {
  const both = makeSpecies();
  const portugueseOnly = makeSpecies({ name_en: null });
  const neither = makeSpecies({ name_en: null, name_pt: null }); // older records may lack common names

  it("shows English, else Portuguese, else the scientific name", () => {
    expect([both, portugueseOnly, neither].map((s) => speciesName(s))).toEqual([
      "Grey Heron",
      "Garça-real",
      "Ardea cinerea",
    ]);
  });

  it("puts the names not shown on the second line", () => {
    expect([both, portugueseOnly, neither].map((s) => speciesOtherNames(s))).toEqual([
      "Garça-real · Ardea cinerea",
      "Ardea cinerea",
      "", // the scientific name is the title already
    ]);
  });

  it("follows the chosen language, falling back to the next name there is", () => {
    const englishOnly = makeSpecies({ name_pt: null });
    expect([both, englishOnly].map((s) => speciesName(s, "pt"))).toEqual(["Garça-real", "Grey Heron"]);
    expect(speciesOtherNames(both, "pt")).toBe("Grey Heron · Ardea cinerea");
    expect(speciesOtherNames(englishOnly, "pt")).toBe("Ardea cinerea");
    expect(speciesName(both, "sci")).toBe("Ardea cinerea");
    expect(speciesOtherNames(both, "sci")).toBe("Grey Heron · Garça-real");
    expect(photoTitle(makePhoto({ species: [both] }), "sci")).toBe("Ardea cinerea");
  });

  it("titles a photo after its first species", () => {
    expect(photoTitle(makePhoto({ species: [portugueseOnly, both] }))).toBe("Garça-real");
    expect(photoTitle(makePhoto())).toBe("Photo details");
  });
});
