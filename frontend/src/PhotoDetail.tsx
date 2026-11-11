import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { api, ApiError, json, offsetLabel, photoUrl, type Photo } from "./api";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "./map";

type Props = {
  photo: Photo;
  onChange: (photo: Photo) => void;
  onClose: () => void;
};

type Point = { lat: number; lon: number };

function ClickToPick({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lon: event.latlng.lng }) });
  return null;
}

const hasPosition = (photo: Photo) => photo.lat !== null && photo.lon !== null;

function positionText(photo: Photo): string {
  if (!hasPosition(photo)) return "No position. Click the map where this photo was taken.";
  return photo.point_manual ? "Position chosen by you." : "Position from the camera's GPS.";
}

/** Metadata of one photo and a map to set where it was taken when the camera did not know. */
export default function PhotoDetail({ photo, onChange, onClose }: Props) {
  const [pick, setPick] = useState<Point | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(point: Point | null) {
    setSaving(true);
    setError(null);
    try {
      const body = point ? { lat: point.lat, lon: point.lon } : { lat: null, lon: null };
      onChange(await api<Photo>(`/photos/${photo.id}`, json("PATCH", body)));
      setPick(null);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Could not save the position");
    } finally {
      setSaving(false);
    }
  }

  const current: Point | null = hasPosition(photo) ? { lat: photo.lat!, lon: photo.lon! } : null;
  const center: [number, number] = current ? [current.lat, current.lon] : DEFAULT_CENTER;
  const taken = photo.taken_at_local ? new Date(photo.taken_at_local).toLocaleString() : "No date";

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded shadow-lg w-full max-w-3xl max-h-full overflow-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <img src={photoUrl(photo, "preview")} alt="" className="w-full max-h-72 object-contain bg-stone-900" />

        <div className="p-4 space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-stone-700">
            <span>
              {taken}
              {photo.taken_offset_minutes !== null && ` (${offsetLabel(photo.taken_offset_minutes)})`}
              {photo.taken_at_manual && " · set by you"}
            </span>
            {photo.camera && <span>{photo.camera}</span>}
            {photo.lens && <span>{photo.lens}</span>}
            {photo.iso !== null && <span>ISO {photo.iso}</span>}
          </div>

          <p className="text-stone-600">{positionText(photo)}</p>

          <MapContainer center={center} zoom={current ? 12 : DEFAULT_ZOOM} className="h-64 rounded">
            <TileLayer url={OSM} attribution={ATTRIBUTION} />
            <ClickToPick onPick={setPick} />
            {current && (
              <CircleMarker center={[current.lat, current.lon]} radius={7} pathOptions={{ color: "#047857" }} />
            )}
            {pick && <CircleMarker center={[pick.lat, pick.lon]} radius={7} pathOptions={{ color: "#b45309" }} />}
          </MapContainer>

          {error && <p className="text-red-700">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              disabled={!pick || saving}
              onClick={() => pick && save(pick)}
              className="bg-emerald-700 text-white rounded px-3 py-1 disabled:opacity-40 hover:bg-emerald-800"
            >
              Use this spot
            </button>
            {photo.point_manual && (
              <button
                disabled={saving}
                onClick={() => save(null)}
                className="rounded px-3 py-1 border border-stone-300 hover:bg-stone-100"
              >
                Remove my position
              </button>
            )}
            <button onClick={onClose} className="ml-auto rounded px-3 py-1 hover:bg-stone-100">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
