import { ImagesIcon, MapPinOffIcon, SearchXIcon, UploadIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import ResponsivePanel from "@/components/ResponsivePanel";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePhotoParam } from "@/hooks/usePhotoParam";
import { apiQuery, hasFilters, NO_FILTERS, readFilters, writeFilters, type Filters } from "@/lib/filters";
import { cn } from "cn";
import {
  api,
  photoTitle,
  photoUrl,
  speciesName,
  takenDate,
  type Camera,
  type Photo,
  type Species,
  type Summary,
} from "@/api";

// Loaded when a photo is first opened: its position map brings Leaflet, which the grid itself doesn't need.
const PhotoDetail = lazy(() => import("@/components/PhotoDetail"));

/** Photos per request: a multiple of every column count the grid uses (2 to 6). */
export const PAGE = 60;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function Tile({ photo, selected, onOpen }: { photo: Photo; selected: boolean; onOpen: () => void }) {
  const [first] = photo.species;
  const more = photo.species.length - 1;
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
        <span className="block truncate text-sm font-medium">
          {first ? (
            <>
              {speciesName(first)}
              {more > 0 && <span className="text-muted-foreground"> +{more}</span>}
            </>
          ) : (
            <span className="text-muted-foreground italic">No species yet</span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {takenDate(photo) ?? "No date"} · {photo.camera ?? "Unknown camera"}
        </span>
      </span>
    </button>
  );
}

/** What the list request gave for one set of filters (`key`); a newer filter makes it stale until its own answer. */
type Result = { key: string; photos: Photo[]; more: boolean; error: string | null };

export default function Catalogue() {
  const [params, setParams] = useSearchParams();
  // Only the filter part of the URL: opening a photo changes the URL too, and must not reload the list.
  const filterKey = writeFilters(new URLSearchParams(), readFilters(params)).toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(filterKey)), [filterKey]);
  const filtering = hasFilters(filters);

  const [result, setResult] = useState<Result | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<Summary | null>(null);
  const [matching, setMatching] = useState<{ key: string; summary: Summary } | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [species, setSpecies] = useState<Record<number, Species>>({});
  const [fetched, setFetched] = useState<Photo | null>(null);
  const { photoId, open, close } = usePhotoParam();

  // While the photos for new filters load, the previous ones stay on screen.
  const photos = result?.photos ?? [];
  const loaded = result?.key === filterKey;
  const error = loaded ? result.error : null;
  const more = loaded && result.more;

  /** A filter change is a new history entry, so Back undoes it; the open photo stays open. */
  const setFilters = useCallback((next: Filters) => setParams((now) => writeFilters(now, next)), [setParams]);

  const replace = useCallback((fresh: Photo) => {
    setResult((shown) => shown && { ...shown, photos: shown.photos.map((p) => (p.id === fresh.id ? fresh : p)) });
    setFetched((photo) => (photo?.id === fresh.id ? fresh : photo));
  }, []);

  useEffect(() => {
    void api<Summary>("/photos/summary").then(setTotal, () => undefined);
    void api<Camera[]>("/photos/cameras").then(setCameras, () => undefined);
  }, []);

  useEffect(() => {
    let current = true;
    api<Photo[]>(`/photos${apiQuery(filters, { limit: PAGE, offset: 0 })}`).then(
      (list) => current && setResult({ key: filterKey, photos: list, more: list.length === PAGE, error: null }),
      () => current && setResult({ key: filterKey, photos: [], more: false, error: "Could not load the photos" }),
    );
    if (hasFilters(filters)) {
      api<Summary>(`/photos/summary${apiQuery(filters)}`).then(
        (summary) => current && setMatching({ key: filterKey, summary }),
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [filters, filterKey]);

  // Names for the species in the filter, when it came from a link or a reload; one that is gone leaves the filter.
  const missingKey = filters.species.filter((id) => !(id in species)).join(",");
  useEffect(() => {
    for (const id of missingKey.split(",").filter(Boolean).map(Number)) {
      api<Species>(`/species/${id}`).then(
        (found) => setSpecies((known) => ({ ...known, [id]: found })),
        () =>
          setParams(
            (now) => {
              const left = readFilters(now);
              return writeFilters(now, { ...left, species: left.species.filter((other) => other !== id) });
            },
            { replace: true },
          ),
      );
    }
  }, [missingKey, setParams]);

  const loadMore = useCallback(() => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    api<Photo[]>(`/photos${apiQuery(filters, { limit: PAGE, offset: photos.length })}`)
      .then(
        (list) =>
          setResult((shown) =>
            shown?.key !== filterKey
              ? shown // the filters changed meanwhile
              : {
                  ...shown,
                  photos: [...shown.photos, ...list.filter((p) => !shown.photos.some((s) => s.id === p.id))],
                  more: list.length === PAGE,
                },
          ),
        () =>
          setResult((shown) => (shown?.key === filterKey ? { ...shown, error: "Could not load more photos" } : shown)),
      )
      .finally(() => setLoadingMore(false));
  }, [more, loadingMore, filterKey, filters, photos.length]);

  // Load the next page when the "Load more" button scrolls into view; the button also works on its own.
  const loadMoreNow = useRef(loadMore);
  useEffect(() => {
    loadMoreNow.current = loadMore;
  });
  const sentinel = useCallback((button: HTMLButtonElement | null) => {
    if (!button || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreNow.current();
    });
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  // The open photo comes from the URL (?photo=). One that isn't in the loaded page (an older photo, a link) is
  // fetched on its own; one that doesn't exist is dropped from the URL.
  const listed = photos.find((p) => p.id === photoId);
  useEffect(() => {
    if (photoId !== null && loaded && !listed) api<Photo>(`/photos/${photoId}`).then(setFetched, close);
  }, [photoId, loaded, listed, close]);
  const selected = listed ?? (fetched?.id === photoId ? fetched : null);

  const empty = loaded && !error && photos.length === 0;
  const count =
    matching?.key === filterKey && total ? `${matching.summary.photos} of ${plural(total.photos, "photo")}` : undefined;

  return (
    <div className="flex flex-1">
      <div className="min-w-0 flex-1 space-y-5 p-4 md:p-6 xl:p-8">
        <div className="hidden items-center gap-3 md:flex">
          <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
          {total && (
            <span className="text-sm text-muted-foreground">
              {plural(total.photos, "photo")} · {plural(total.species, "species", "species")}
            </span>
          )}
          <Button asChild variant="outline" className="ml-auto">
            <Link to="/upload">
              <UploadIcon />
              Upload
            </Link>
          </Button>
        </div>

        {!(empty && !filtering) && (
          <FilterBar
            filters={filters}
            onChange={setFilters}
            cameras={cameras}
            species={species}
            onSpeciesPicked={(picked) => setSpecies((known) => ({ ...known, [picked.id]: picked }))}
            count={count}
          />
        )}
        {count && <p className="text-sm text-muted-foreground md:hidden">{count}</p>}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        {empty && !filtering && (
          <EmptyState
            icon={ImagesIcon}
            title="No photos yet."
            heading="h2"
            action={
              <Button asChild>
                <Link to="/upload">
                  <UploadIcon />
                  Upload photos
                </Link>
              </Button>
            }
          >
            Your photos show up here, newest first. Their date, camera and position are read from the files.
          </EmptyState>
        )}
        {empty && filtering && (
          <EmptyState
            icon={SearchXIcon}
            title="No photos match these filters"
            heading="h2"
            action={
              <Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          >
            Try fewer filters, or a wider date range.
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

        {more && (
          <div className="flex justify-center">
            <Button ref={sentinel} variant="outline" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {selected && (
        <ResponsivePanel title={photoTitle(selected)} onClose={close}>
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
            <PhotoDetail photo={selected} onChange={replace} />
          </Suspense>
        </ResponsivePanel>
      )}
    </div>
  );
}
