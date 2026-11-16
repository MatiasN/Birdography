import { ImagesIcon, MapPinOffIcon, UploadIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import EmptyState from "@/components/EmptyState";
import ResponsivePanel from "@/components/ResponsivePanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePhotoParam } from "@/usePhotoParam";
import { cn } from "cn";
import {
  api,
  ApiError,
  hasFile,
  IMAGE_EXTENSIONS,
  photoUrl,
  sizeProblem,
  takenDate,
  type Health,
  type Photo,
} from "../api";

// Loaded when a photo is first opened: its position map brings Leaflet, which the grid itself doesn't need.
const PhotoDetail = lazy(() => import("../PhotoDetail"));

const ACCEPT = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
/** Large uploads get their thumbnail after the response; fetch the photo again once, after this delay. */
const THUMBNAIL_RETRY_MS = 2000;

function Tile({ photo, selected, onOpen }: { photo: Photo; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "overflow-hidden rounded-xl border bg-card text-left text-card-foreground shadow-xs outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <span className="relative block">
        <img src={photoUrl(photo)} alt="" loading="lazy" className="aspect-square w-full bg-muted object-cover" />
        {photo.lat === null && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium text-warning shadow-xs">
            <MapPinOffIcon className="size-3" aria-hidden="true" />
            No position
          </span>
        )}
      </span>
      <span className="block px-3 py-2">
        <span className="block truncate text-sm font-medium">{takenDate(photo) ?? "No date"}</span>
        <span className="block truncate text-xs text-muted-foreground">{photo.camera ?? "Unknown camera"}</span>
      </span>
    </button>
  );
}

export default function Photos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limits, setLimits] = useState<Health["limits"] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [fetched, setFetched] = useState<Photo | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { photoId, open, close } = usePhotoParam();

  const replace = useCallback((fresh: Photo) => {
    setPhotos((current) => current.map((p) => (p.id === fresh.id ? fresh : p)));
    setFetched((current) => (current?.id === fresh.id ? fresh : current));
  }, []);

  const load = useCallback(
    () =>
      api<Photo[]>("/photos").then((list) => {
        setPhotos(list);
        setLoaded(true);
      }),
    [],
  );

  useEffect(() => {
    void load();
    void api<Health>("/health").then((health) => setLimits(health.limits));
  }, [load]);

  // The open photo comes from the URL (?photo=). One that isn't in the loaded page (an older photo, a link) is
  // fetched on its own; one that doesn't exist is dropped from the URL.
  const listed = photos.find((p) => p.id === photoId);
  useEffect(() => {
    if (photoId !== null && loaded && !listed) api<Photo>(`/photos/${photoId}`).then(setFetched, close);
  }, [photoId, loaded, listed, close]);
  const selected = listed ?? (fetched?.id === photoId ? fetched : null);

  function refreshLater(id: number) {
    setTimeout(() => void api<Photo>(`/photos/${id}`).then(replace), THUMBNAIL_RETRY_MS);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    setUploading(true);
    const problems: string[] = [];
    const pending: number[] = [];
    for (const file of event.target.files ?? []) {
      const problem = limits && sizeProblem(file, limits);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      try {
        const photo = await api<Photo>("/photos", { method: "POST", body });
        if (!hasFile(photo, "thumbnail")) pending.push(photo.id);
      } catch (error) {
        const detail = error instanceof ApiError ? error.message : "upload failed";
        problems.push(`${file.name}: ${detail}`);
      }
    }
    event.target.value = "";
    setErrors(problems);
    setUploading(false);
    await load();
    pending.forEach(refreshLater);
  }

  return (
    <div className="flex flex-1">
      <div className="min-w-0 flex-1 space-y-5 p-4 md:p-6 xl:p-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">Catalogue</h1>
          {/* Uploading stays here until Part 2 gives it the Upload tab (plan 0007 D8). */}
          <div className="flex flex-col items-start gap-1.5 md:ml-auto">
            <Button onClick={() => picker.current?.click()} disabled={uploading}>
              <UploadIcon />
              {uploading ? "Uploading..." : "Upload photos"}
            </Button>
            <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(event) => void upload(event)} />
            {limits && (
              <p className="text-xs text-muted-foreground">
                Up to {limits.upload_mb} MB per photo, {limits.raw_upload_mb} MB for RAW
              </p>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Some photos were not uploaded</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {loaded && photos.length === 0 && (
          <EmptyState icon={ImagesIcon} title="No photos yet.">
            Upload your first photos with the button above. Their date, camera and position are read from the files.
          </EmptyState>
        )}

        <div
          className={cn(
            "grid grid-cols-2 gap-3 sm:grid-cols-3",
            selected ? "lg:grid-cols-3 xl:grid-cols-4" : "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
          )}
        >
          {photos.map((photo) => (
            <Tile key={photo.id} photo={photo} selected={photo.id === selected?.id} onOpen={() => open(photo.id)} />
          ))}
        </div>
      </div>

      {selected && (
        <ResponsivePanel title="Photo details" onClose={close}>
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
            <PhotoDetail photo={selected} onChange={replace} />
          </Suspense>
        </ResponsivePanel>
      )}
    </div>
  );
}
