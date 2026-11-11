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
  species_ids: number[];
  location_id: number | null;
  files: PhotoFile[];
};

export type User = { id: number; email: string };

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }
  return response.status === 204 ? (undefined as T) : response.json();
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
