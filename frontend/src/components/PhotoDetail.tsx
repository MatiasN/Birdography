import "leaflet/dist/leaflet.css";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  api,
  ApiError,
  fileSize,
  json,
  offsetLabel,
  photoUrl,
  position,
  speciesName,
  speciesOtherNames,
  type Photo,
} from "@/api";
import InvalidateOnResize from "@/components/InvalidateOnResize";
import SpeciesPicker from "@/components/SpeciesPicker";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "@/map";

type Props = {
  photo: Photo;
  onChange: (photo: Photo) => void;
};

type Point = { lat: number; lon: number };

// Markers on the light OSM tiles (D9), so fixed colours rather than theme ones: emerald-700 and amber-700.
const SAVED = "#047857";
const PICKED = "#b45309";

function ClickToPick({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lon: event.latlng.lng }) });
  return null;
}

function positionText(photo: Photo): string {
  if (!position(photo)) return "No position. Click the map where this photo was taken.";
  return photo.point_manual ? "Position chosen by you." : "Position from the camera's GPS.";
}

/** 0.002 -> "1/500 s", 2 -> "2 s". */
const shutterText = (seconds: number) => (seconds >= 1 ? `${seconds} s` : `1/${Math.round(1 / seconds)} s`);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap gap-x-1.5">{children}</dd>
    </div>
  );
}

/** The photo's species: shown, added with the picker and removed, each change saved at once. */
function SpeciesSection({ photo, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(ids: number[]) {
    setSaving(true);
    setError(null);
    try {
      onChange(await api<Photo>(`/photos/${photo.id}`, json("PATCH", { species_ids: ids })));
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Could not save the species");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="font-medium">Species</h3>
      {photo.species.length === 0 ? (
        <p className="text-muted-foreground italic">No species yet</p>
      ) : (
        <ul className="space-y-2">
          {photo.species.map((species) => (
            <li key={species.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{speciesName(species)}</span>
                <span className="block truncate text-xs text-muted-foreground">{speciesOtherNames(species)}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${speciesName(species)}`}
                disabled={saving}
                onClick={() => void save(photo.species_ids.filter((id) => id !== species.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex items-start gap-2">
          <SpeciesPicker
            className="flex-1"
            label="Add species"
            focusOnMount
            exclude={photo.species_ids}
            onPick={(species) => {
              setAdding(false);
              void save([...photo.species_ids, species.id]);
            }}
          />
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Done
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" disabled={saving} onClick={() => setAdding(true)}>
          <PlusIcon />
          Add species
        </Button>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
    </section>
  );
}

/** Metadata of one photo and a map to set where it was taken when the camera did not know. */
export default function PhotoDetail({ photo, onChange }: Props) {
  const [pick, setPick] = useState<Point | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const current = position(photo);
  const center = current ?? DEFAULT_CENTER;
  const taken = photo.taken_at_local ? new Date(photo.taken_at_local).toLocaleString() : "No date";
  const original = photo.files.find((file) => file.kind === "original");
  const settings = [
    photo.iso !== null && `ISO ${photo.iso}`,
    photo.aperture !== null && `f/${photo.aperture}`,
    photo.shutter_seconds !== null && shutterText(photo.shutter_seconds),
    photo.focal_length_mm !== null && `${photo.focal_length_mm} mm`,
  ].filter((part) => part !== false);

  return (
    <div>
      <img src={photoUrl(photo, "preview")} alt="" className="aspect-[3/2] w-full bg-muted object-contain" />

      <div className="space-y-6 p-4 text-sm">
        <SpeciesSection photo={photo} onChange={onChange} />

        <section>
          <h3 className="mb-1 font-medium">Details</h3>
          <dl className="divide-y">
            <Row label="Taken">
              <span>
                {taken}
                {photo.taken_offset_minutes !== null && (
                  <span className="text-muted-foreground"> ({offsetLabel(photo.taken_offset_minutes)})</span>
                )}
                {photo.taken_at_manual && <span className="text-muted-foreground"> · set by you</span>}
              </span>
            </Row>
            {photo.camera && <Row label="Camera">{photo.camera}</Row>}
            {photo.lens && <Row label="Lens">{photo.lens}</Row>}
            {settings.length > 0 && (
              <Row label="Settings">
                {settings.map((part, i) => (
                  <span key={part}>
                    {i > 0 && <span className="text-muted-foreground">· </span>}
                    <span>{part}</span>
                  </span>
                ))}
              </Row>
            )}
            {original && (
              <Row label="File">
                {original.format.toUpperCase()}
                {original.width !== null && original.height !== null && `, ${original.width} × ${original.height}`}
                {` · ${fileSize(original.size_bytes)}`}
              </Row>
            )}
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Where</h3>
          <p className="text-muted-foreground">{positionText(photo)}</p>
          <div className="isolate overflow-hidden rounded-lg border">
            <MapContainer center={center} zoom={current ? 12 : DEFAULT_ZOOM} className="h-56">
              <TileLayer url={OSM} attribution={ATTRIBUTION} />
              <ClickToPick onPick={setPick} />
              <InvalidateOnResize />
              {current && <CircleMarker center={current} radius={7} pathOptions={{ color: SAVED }} />}
              {pick && <CircleMarker center={[pick.lat, pick.lon]} radius={7} pathOptions={{ color: PICKED }} />}
            </MapContainer>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button disabled={!pick || saving} onClick={pick ? () => void save(pick) : undefined}>
              Use this spot
            </Button>
            {photo.point_manual && (
              <Button variant="outline" disabled={saving} onClick={() => void save(null)}>
                Remove my position
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
