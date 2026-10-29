export type Photo = {
  id: number;
  taken_at: string | null;
  camera: string | null;
  lens: string | null;
  lat: number | null;
  lon: number | null;
  species_id: number | null;
  location_id: number | null;
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

export const photoUrl = (photo: Photo) => `/api/photos/${photo.id}/file`;
