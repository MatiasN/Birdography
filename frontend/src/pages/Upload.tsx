import {
  CheckIcon,
  CircleAlertIcon,
  FileImageIcon,
  ImageUpIcon,
  PlusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  UnlinkIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import SpeciesPicker from "@/components/SpeciesPicker";
import { Button } from "@/components/ui/button";
import { heldForPair, inProgress, useUploads, type UploadItem } from "@/hooks/useUploads";
import { api, fileSize, IMAGE_EXTENSIONS, speciesName, type Health, type Species } from "@/api";
import { cn } from "cn";

const ACCEPT = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** A species on a file or on the batch, with its remove button unless it can't change any more. */
function Chip({ species, onRemove, small }: { species: Species; onRemove?: () => void; small?: boolean }) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background pr-0.5 pl-2.5 text-accent-foreground",
        small ? "py-0 text-xs" : "py-0.5 text-sm",
        !onRemove && "pr-2.5",
      )}
    >
      {speciesName(species)}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("rounded-full", small ? "size-5" : "size-6")}
          aria-label={`Remove ${speciesName(species)}`}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

function Status({ item }: { item: UploadItem }) {
  const { retry } = useUploads();
  if (item.status === "waiting") {
    const text = item.pairCheck === "checking" ? "Checking…" : heldForPair(item) ? "Waiting for you" : "Waiting";
    return <span className="text-muted-foreground">{text}</span>;
  }
  if (item.status === "uploading") {
    const percent = Math.round(item.progress * 100);
    return (
      <span className="flex w-24 flex-col items-end gap-1">
        <span className="tabular-nums">{percent}%</span>
        <progress
          aria-label={`Uploading ${item.file.name}`}
          value={percent}
          max={100}
          className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
        />
      </span>
    );
  }
  if (item.status === "done") {
    return (
      <span className="flex flex-col items-end gap-1 text-right">
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckIcon className="size-4" aria-hidden="true" />
            Done
          </span>
          <Button asChild variant="link" size="sm" className="h-auto px-0">
            <Link to={`/catalogue?photo=${item.photo?.id}`}>Open</Link>
          </Button>
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1 text-right">
      <span className="inline-flex items-center gap-1 text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
        {item.problem}
      </span>
      {item.existingId !== null && (
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link to={`/catalogue?photo=${item.existingId}`}>Open</Link>
        </Button>
      )}
      {item.retryable && (
        <Button variant="outline" size="sm" onClick={() => retry(item.key)}>
          <RotateCwIcon />
          Retry
        </Button>
      )}
    </span>
  );
}

/**
 * What the browser found comparing a pair's files: a notice that holds the pair when they look like two shots,
 * until the user keeps or separates them; a quiet note when it couldn't tell, or after keeping.
 */
function PairNotice({ item, onSeparate }: { item: UploadItem; onSeparate: () => void }) {
  const { keepPair } = useUploads();
  const check = item.pairCheck;
  if (!check || check === "checking" || check.state === "same") return null;
  if (check.state === "unknown" || item.pairKept || item.status !== "waiting") {
    return (
      <p className="text-xs text-muted-foreground">
        {check.message}
        {item.pairKept && "; uploaded as a pair, as you chose"}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm text-foreground"
    >
      <p className="flex items-start gap-1.5">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>{check.message}. Upload them as one photo anyway, or each on its own?</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => keepPair(item.key)}>
          Upload as a pair
        </Button>
        <Button size="sm" variant="outline" onClick={onSeparate}>
          <UnlinkIcon />
          Separate
        </Button>
      </div>
    </div>
  );
}

function Row({ item, limits }: { item: UploadItem; limits: Health["limits"] | null }) {
  const { setSpecies, unpair } = useUploads();
  const separate = () => unpair(item.key, limits);
  const [adding, setAdding] = useState(false);
  // Species go with the file; while it is being sent they can't change, and a refused file has no photo to change.
  const editable = item.status === "waiting" || item.status === "done" || (item.status === "failed" && item.retryable);

  return (
    <li className="space-y-2 py-3">
      <div className="flex gap-3">
        {item.preview ? (
          <img src={item.preview} alt="" className="size-14 shrink-0 rounded-md bg-muted object-cover" />
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <FileImageIcon className="size-6" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-medium">
            {item.file.name}
            {item.companion && <span className="text-muted-foreground"> + {item.companion.name}</span>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {fileSize(item.file.size)}
            {item.companion && ` + ${fileSize(item.companion.size)}`}
            {item.companion && <span>· RAW+JPEG pair, the JPEG becomes the preview</span>}
            {item.companion && (item.status === "waiting" || item.status === "failed") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs"
                aria-label={`Upload ${item.file.name} and ${item.companion.name} separately`}
                onClick={separate}
              >
                <UnlinkIcon />
                Separate
              </Button>
            )}
          </p>
          {(item.species.length > 0 || editable) && (
            <ul aria-label={`Species of ${item.file.name}`} className="flex flex-wrap items-center gap-1.5">
              {item.species.map((species) => (
                <Chip
                  key={species.id}
                  small
                  species={species}
                  onRemove={
                    editable
                      ? () =>
                          setSpecies(
                            item,
                            item.species.filter((other) => other.id !== species.id),
                          )
                      : undefined
                  }
                />
              ))}
              {editable && !adding && (
                <li>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-label={`Add species to ${item.file.name}`}
                    onClick={() => setAdding(true)}
                  >
                    <PlusIcon />
                    Species
                  </Button>
                </li>
              )}
            </ul>
          )}
          {adding && editable && (
            <div className="flex items-start gap-2">
              <SpeciesPicker
                className="flex-1"
                label={`Species for ${item.file.name}`}
                focusOnMount
                exclude={item.species.map((s) => s.id)}
                onPick={(species) => {
                  setAdding(false);
                  setSpecies(item, [...item.species, species]);
                }}
              />
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Done
              </Button>
            </div>
          )}
          {item.speciesProblem && <p className="text-xs text-destructive">{item.speciesProblem}</p>}
        </div>
        <div className="shrink-0 pt-0.5 text-sm">
          <Status item={item} />
        </div>
      </div>
      {/* Full width under the row, so the notice isn't squeezed beside the status on a phone. */}
      <PairNotice item={item} onSeparate={separate} />
    </li>
  );
}

/**
 * The Upload tab (plan 0008 §7): drop photos or choose them, give them species for the whole batch or one by one,
 * and watch each file go. The queue itself lives in UploadsProvider, so it keeps going on other tabs.
 */
export default function Upload() {
  const { items, batch, add, addBatchSpecies, removeBatchSpecies, clearFinished } = useUploads();
  const [limits, setLimits] = useState<Health["limits"] | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<Health>("/health").then(
      (health) => setLimits(health.limits),
      () => undefined,
    );
  }, []);

  const done = items.filter((item) => item.status === "done").length;
  const held = items.filter(
    (item) => item.status === "waiting" && heldForPair(item) && item.pairCheck !== "checking",
  ).length;
  const finished = items.some((item) => !inProgress(item));

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add([...event.dataTransfer.files], limits);
  }

  return (
    <div
      className="flex-1 space-y-5 p-4 md:p-6 xl:p-8"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={drop}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">Upload</h1>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {done} of {items.length} uploaded
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {finished && (
            <Button variant="ghost" onClick={clearFinished}>
              Clear finished
            </Button>
          )}
          {done > 0 && (
            <Button asChild variant="outline">
              <Link to="/catalogue">View in catalogue</Link>
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors",
          dragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
          <ImageUpIcon className="size-6" aria-hidden="true" />
        </span>
        <p className="hidden font-medium md:block">Drop photos here</p>
        <Button onClick={() => picker.current?.click()} aria-label="Choose photos">
          <span className="md:hidden">Choose photos</span>
          <span className="hidden md:inline">Browse files</span>
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="file-input"
          onChange={(event) => {
            add([...(event.target.files ?? [])], limits);
            event.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, TIFF, HEIC, WebP and RAW
          {limits && ` · up to ${limits.upload_mb} MB, ${limits.raw_upload_mb} MB for RAW`}. Date, camera and position
          are read from the files.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Species for every photo in this batch</h2>
        {batch.length > 0 && (
          <ul aria-label="Species for every photo in this batch" className="flex flex-wrap gap-2">
            {batch.map((species) => (
              <Chip key={species.id} species={species} onRemove={() => removeBatchSpecies(species.id)} />
            ))}
          </ul>
        )}
        <SpeciesPicker
          className="md:max-w-md"
          label="Add a species for the batch"
          exclude={batch.map((s) => s.id)}
          onPick={addBatchSpecies}
        />
        <p className="text-xs text-muted-foreground">
          Search in English, Portuguese or Latin. They go to every photo still waiting; change one photo's species in
          the list below.
        </p>
      </section>

      {held > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
          {held === 1 ? "A RAW+JPEG pair looks" : `${held} RAW+JPEG pairs look`} like two different shots. Nothing is
          sent for {held === 1 ? "it" : "them"} until you choose below.
        </p>
      )}

      {items.length > 0 && (
        <ul aria-label="Files" className="divide-y rounded-xl border bg-card px-4 text-card-foreground">
          {items.map((item) => (
            <Row key={item.key} item={item} limits={limits} />
          ))}
        </ul>
      )}
    </div>
  );
}
