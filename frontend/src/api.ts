export type PhotoFile = {
  kind: "original" | "preview" | "thumbnail";
  url: string;
  format: string;
  is_raw: boolean;
  size_bytes: number;
  width: number | null;
  height: number | null;
};

/** A species as photos carry it; `/species` returns these fields and a few more (family, eBird code). */
export type Species = {
  id: number;
  scientific_name: string;
  name_en: string | null;
  name_pt: string | null;
};

/** The name shown for a species: English, else Portuguese, else the scientific name. */
export const speciesName = (species: Species) => species.name_en ?? species.name_pt ?? species.scientific_name;

/** The other names, for a second line: "Garça-real · Ardea cinerea". */
export const speciesOtherNames = (species: Species) =>
  [species.name_en && species.name_pt, species.scientific_name].filter(Boolean).join(" · ");

export type Photo = {
  id: number;
  uploaded_at: string;
  taken_at: string | null;
  taken_at_local: string | null;
  taken_offset_minutes: number | null;
  taken_at_manual: boolean;
  camera: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso: number | null;
  shutter_seconds: number | null;
  aperture: number | null;
  focal_length_mm: number | null;
  lat: number | null;
  lon: number | null;
  point_manual: boolean;
  species_ids: number[];
  species: Species[];
  location_id: number | null;
  files: PhotoFile[];
};

/** The photo detail's title: its first species, or a plain one while it has none. */
export const photoTitle = (photo: Photo) => (photo.species[0] ? speciesName(photo.species[0]) : "Photo details");

/** One of the user's cameras, from /photos/cameras. */
export type Camera = { make: string | null; model: string | null; photos: number };

/** How many photos a filter matches and how many species they show, from /photos/summary. */
export type Summary = { photos: number; species: number };

export type User = { id: number; email: string; expires_at: string };

/** Fired on any 401 outside the login and password forms: the session expired or was ended elsewhere. */
export const SESSION_EXPIRED = "session-expired";
const HANDLE_OWN_401 = ["/auth/login", "/auth/password"];

export type Health = {
  status: string;
  postgis: string;
  exiftool: string | null;
  limits: { upload_mb: number; raw_upload_mb: number };
};

export const RAW_EXTENSIONS = ["dng", "cr2", "cr3", "nef", "nrw", "arw", "orf", "rw2", "raf", "pef"];
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "tif", "tiff", "webp", "heic", "heif", ...RAW_EXTENSIONS];

/** After the last dot; a name without one is its own "extension", which matches nothing. */
const extension = (file: File) => file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();

export const isRaw = (file: File) => RAW_EXTENSIONS.includes(extension(file));
export const isJpeg = (file: File) => ["jpg", "jpeg"].includes(extension(file));
/** The name without its extension, lower-cased: what the two files of a RAW+JPEG pair share ("DSC_0001"). */
export function stem(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return (dot > 0 ? file.name.slice(0, dot) : file.name).toLowerCase();
}

/** Client-side check against the server's limits, so a hopeless upload fails before it starts. */
export function sizeProblem(file: File, limits: Health["limits"]): string | null {
  const raw = RAW_EXTENSIONS.includes(extension(file));
  const limitMb = raw ? limits.raw_upload_mb : limits.upload_mb;
  if (file.size > limitMb * 1024 * 1024) {
    return `${file.name}: ${raw ? "RAW" : "image"} files are limited to ${limitMb} MB`;
  }
  return null;
}

/** Where the photo was taken, if known. */
export const position = (photo: Photo): [number, number] | null =>
  photo.lat !== null && photo.lon !== null ? [photo.lat, photo.lon] : null;

export const hasFile = (photo: Photo, kind: PhotoFile["kind"]) => photo.files.some((f) => f.kind === kind);

export class ApiError extends Error {
  status: number;
  /** The whole error body, for the extra fields some answers carry (a 409's `species_id` or `photo_id`). */
  body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** FastAPI's `detail`: a string, or for validation errors (422) a list of `{msg}`. */
function errorMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item: { msg?: unknown }) => item?.msg).filter((msg) => typeof msg === "string");
    if (messages.length > 0) return messages.join("; ");
  }
  return null;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    if (response.status === 401 && !HANDLE_OWN_401.includes(path)) {
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    const body: Record<string, unknown> = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorMessage(body.detail) ?? response.statusText, body);
  }
  return response;
}

/** A request whose response is JSON of type T. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  const data: T = await response.json(); // the API's response models are the contract for T
  return data;
}

/**
 * Upload one photo with its species (plan 0008 §7), and the camera JPEG of a RAW+JPEG pair as `companion` (D12).
 * `fetch` can't report upload progress, so this uses XMLHttpRequest; `onProgress` gets the share sent, 0 to 1.
 * Errors are `ApiError`s as with `api()`, a 401 ends the session the same way, and a failed connection rejects
 * with a TypeError, as fetch does.
 */
export function uploadFile(
  file: File,
  companion: File | null,
  speciesIds: number[],
  onProgress: (share: number) => void,
): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/photos");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText)); // the API's response model is the contract, as in api()
        return;
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: a proxy's error page; the status still says what happened
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
      reject(new ApiError(xhr.status, errorMessage(body.detail) ?? (xhr.statusText || "Upload failed"), body));
    });
    xhr.addEventListener("error", () => reject(new TypeError("Network error")));
    const form = new FormData();
    form.append("file", file);
    if (companion) form.append("companion", companion);
    for (const id of speciesIds) form.append("species_ids", String(id));
    xhr.send(form);
  });
}

/** 52.3 MB, 840 KB. */
export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A request without a response body (204). */
export async function send(path: string, init?: RequestInit): Promise<void> {
  await request(path, init);
}

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Smallest browser-viewable file; the API falls back to larger kinds and finally the original. */
export const fileUrl = (photoId: number, kind: PhotoFile["kind"] = "thumbnail") =>
  `/api/photos/${photoId}/file?kind=${kind}`;
export const photoUrl = (photo: Photo, kind: PhotoFile["kind"] = "thumbnail") => fileUrl(photo.id, kind);

/** The date the photo was taken as the camera (or the user) recorded it, without time zone shifts. */
export const takenDate = (photo: Photo) =>
  photo.taken_at_local ? new Date(photo.taken_at_local).toLocaleDateString() : null;

const pad = (n: number) => String(n).padStart(2, "0");

/** 60 -> "UTC+01:00", -210 -> "UTC-03:30". */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
