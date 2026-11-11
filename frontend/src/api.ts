export type PhotoFile = {
  kind: "original" | "preview" | "thumbnail";
  url: string;
  format: string;
  is_raw: boolean;
  size_bytes: number;
  width: number | null;
  height: number | null;
};

export type Photo = {
  id: number;
  uploaded_at: string;
  taken_at: string | null;
  taken_at_local: string | null;
  taken_offset_minutes: number | null;
  taken_at_manual: boolean;
  camera: string | null;
  lens: string | null;
  iso: number | null;
  shutter_seconds: number | null;
  aperture: number | null;
  focal_length_mm: number | null;
  lat: number | null;
  lon: number | null;
  point_manual: boolean;
  species_ids: number[];
  location_id: number | null;
  files: PhotoFile[];
};

export type User = { id: number; email: string };

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

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    const body: { detail?: unknown } = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorMessage(body.detail) ?? response.statusText);
  }
  return response;
}

/** A request whose response is JSON of type T. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  const data: T = await response.json(); // the API's response models are the contract for T
  return data;
}

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
export const photoUrl = (photo: Photo, kind: PhotoFile["kind"] = "thumbnail") =>
  `/api/photos/${photo.id}/file?kind=${kind}`;

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
