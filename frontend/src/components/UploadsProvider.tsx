import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  isJpeg,
  isRaw,
  json,
  sizeProblem,
  stem,
  uploadFile,
  type Health,
  type Photo,
  type Species,
} from "@/api";
import {
  CONCURRENT_UPLOADS,
  heldForPair,
  inProgress,
  UploadsContext,
  type UploadItem,
  type Uploads,
} from "@/hooks/useUploads";
import { checkPair } from "@/lib/exif";

/** Types every browser shows in an <img>; RAW, HEIC and TIFF don't. */
const SHOWN = /^image\/(jpeg|png|webp|gif|avif)$/;

/** What went wrong with an upload, as the row shows it. */
function failure(problem: unknown): Partial<UploadItem> {
  if (!(problem instanceof ApiError)) {
    return { status: "failed", problem: "The connection was lost", retryable: true };
  }
  if (problem.status === 413 && !("detail" in problem.body)) {
    // nginx's own page, not the API: the request was over its limit (CLIENT_MAX_BODY_SIZE)
    return { status: "failed", problem: "Too large for the server's request limit", retryable: false };
  }
  if (problem.status === 409) {
    const existing = problem.body.photo_id;
    return {
      status: "failed",
      problem: "Already in your catalogue",
      existingId: typeof existing === "number" ? existing : null,
      retryable: false,
    };
  }
  return { status: "failed", problem: problem.message, retryable: problem.status >= 500 || problem.status === 401 };
}

const withSpecies = (list: Species[], species: Species) =>
  list.some((s) => s.id === species.id) ? list : [...list, species];

/**
 * Holds the upload queue (plan 0008 §7) above the routes, so switching tabs doesn't stop it. Sends
 * CONCURRENT_UPLOADS files at a time, and asks before the browser tab is closed while files are still going.
 */
export default function UploadsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [batch, setBatch] = useState<Species[]>([]);
  const nextKey = useRef(1);
  const started = useRef(new Set<number>());

  const update = useCallback((key: number, changes: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  // Start waiting files while fewer than CONCURRENT_UPLOADS are being sent.
  useEffect(() => {
    const sending = items.filter((item) => item.status === "uploading").length;
    const next = items
      .filter((item) => item.status === "waiting" && !heldForPair(item) && !started.current.has(item.key))
      .slice(0, CONCURRENT_UPLOADS - sending);
    for (const item of next) {
      started.current.add(item.key);
      update(item.key, { status: "uploading", progress: 0 });
      uploadFile(
        item.file,
        item.companion,
        item.species.map((s) => s.id),
        (progress) => update(item.key, { progress }),
      ).then(
        (photo) => update(item.key, { status: "done", progress: 1, photo, species: photo.species }),
        (problem: unknown) => update(item.key, failure(problem)),
      );
    }
  }, [items, update]);

  const busy = items.some(inProgress);
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const newItem = useCallback(
    (file: File, companion: File | null, limits: Health["limits"] | null): UploadItem => {
      const problems = [file, ...(companion ? [companion] : [])].map((f) => limits && sizeProblem(f, limits));
      const shown = companion ?? file; // a pair's JPEG stands in for the RAW, which the browser can't show
      return {
        key: nextKey.current++,
        file,
        companion,
        preview: SHOWN.test(shown.type) ? URL.createObjectURL(shown) : null,
        species: batch,
        status: problems.some(Boolean) ? "failed" : "waiting",
        progress: 0,
        photo: null,
        pairCheck: companion ? "checking" : null,
        pairKept: false,
        problem: problems.find((problem) => problem !== null) ?? null,
        existingId: null,
        retryable: false,
        speciesProblem: null,
      };
    },
    [batch],
  );

  /** Compare a pair's files and record the outcome, unless the pair was separated or changed meanwhile. */
  const check = useCallback((key: number, raw: File, jpeg: File) => {
    void checkPair(raw, jpeg).then((pairCheck) =>
      setItems((list) => list.map((i) => (i.key === key && i.companion === jpeg ? { ...i, pairCheck } : i))),
    );
  }, []);

  /**
   * Queue files. A RAW and a JPEG with the same name (DSC_0001.NEF + DSC_0001.JPG) are a RAW+JPEG pair (D12): one
   * photo, the JPEG becoming its preview. A JPEG also joins a RAW with its name that is still waiting from before.
   */
  const add = useCallback<Uploads["add"]>(
    (files, limits) => {
      const jpegs = new Map(files.filter(isJpeg).map((file) => [stem(file), file]));
      const waitingRaws = new Map(
        items
          .filter((i) => i.status === "waiting" && !started.current.has(i.key) && isRaw(i.file) && !i.companion)
          .map((i) => [stem(i.file), i]),
      );
      const paired = new Set(
        files
          .filter(isRaw)
          .map((raw) => jpegs.get(stem(raw)))
          .filter((f) => f !== undefined),
      );
      const joins = new Map<number, Partial<UploadItem>>(); // changes to a waiting RAW a JPEG joins
      const joinedPairs: [number, File, File][] = [];
      const added: UploadItem[] = [];
      for (const file of files) {
        if (paired.has(file)) continue; // goes with its RAW
        if (isRaw(file)) {
          added.push(newItem(file, jpegs.get(stem(file)) ?? null, limits));
          continue;
        }
        const raw = isJpeg(file) ? waitingRaws.get(stem(file)) : undefined;
        if (raw === undefined || joins.has(raw.key)) {
          added.push(newItem(file, null, limits));
          continue;
        }
        const problem = limits && sizeProblem(file, limits);
        joinedPairs.push([raw.key, raw.file, file]);
        joins.set(raw.key, {
          companion: file,
          preview: SHOWN.test(file.type) ? URL.createObjectURL(file) : null,
          problem,
          status: problem ? "failed" : "waiting",
          pairCheck: "checking",
        });
      }
      setItems((list) => [...list.map((i) => ({ ...i, ...joins.get(i.key) })), ...added]);
      // Compared only once queued, so a pair waits in the list ("Checking…") rather than out of sight.
      for (const i of added) if (i.companion) check(i.key, i.file, i.companion);
      for (const [key, raw, jpeg] of joinedPairs) check(key, raw, jpeg);
    },
    [items, newItem, check],
  );

  const unpair = useCallback<Uploads["unpair"]>((key, limits) => {
    const jpegKey = nextKey.current++;
    setItems((list) => {
      const pair = list.find((i) => i.key === key);
      if (!pair?.companion || pair.status === "uploading" || pair.status === "done") return list;
      // Each file on its own, checked against its own limit again: a pair can fail on its JPEG alone.
      const single = (file: File, extra: Partial<UploadItem>): UploadItem => {
        const problem = limits && sizeProblem(file, limits);
        return {
          ...pair,
          ...extra,
          file,
          companion: null,
          pairCheck: null,
          pairKept: false,
          status: problem ? "failed" : "waiting",
          problem,
          retryable: false,
          progress: 0,
        };
      };
      const raw = single(pair.file, { preview: null });
      const jpeg = single(pair.companion, { key: jpegKey });
      return list.flatMap((i) => (i === pair ? [raw, jpeg] : [i]));
    });
    started.current.delete(key);
  }, []);

  const keepPair = useCallback((key: number) => update(key, { pairKept: true }), [update]);

  const addBatchSpecies = useCallback((species: Species) => {
    setBatch((list) => withSpecies(list, species));
    setItems((list) =>
      list.map((item) => (item.status === "waiting" ? { ...item, species: withSpecies(item.species, species) } : item)),
    );
  }, []);

  const removeBatchSpecies = useCallback((id: number) => {
    setBatch((list) => list.filter((s) => s.id !== id));
    setItems((list) =>
      list.map((item) =>
        item.status === "waiting" ? { ...item, species: item.species.filter((s) => s.id !== id) } : item,
      ),
    );
  }, []);

  const setSpecies = useCallback<Uploads["setSpecies"]>(
    (item, species) => {
      const { key } = item;
      if (!item.photo) {
        update(key, { species }); // not sent yet: they go with the file
        return;
      }
      const ids = species.map((s) => s.id);
      api<Photo>(`/photos/${item.photo.id}`, json("PATCH", { species_ids: ids })).then(
        (photo) => update(key, { photo, species: photo.species, speciesProblem: null }),
        (problem: unknown) =>
          update(key, {
            speciesProblem: problem instanceof ApiError ? problem.message : "Could not save the species",
          }),
      );
    },
    [update],
  );

  const retry = useCallback(
    (key: number) => {
      started.current.delete(key);
      update(key, { status: "waiting", progress: 0, problem: null, retryable: false });
    },
    [update],
  );

  const clearFinished = useCallback(() => {
    for (const item of items) if (!inProgress(item) && item.preview) URL.revokeObjectURL(item.preview);
    setItems((list) => list.filter(inProgress));
  }, [items]);

  const value = useMemo<Uploads>(
    () => ({
      items,
      batch,
      add,
      addBatchSpecies,
      removeBatchSpecies,
      setSpecies,
      retry,
      unpair,
      keepPair,
      clearFinished,
    }),
    [items, batch, add, addBatchSpecies, removeBatchSpecies, setSpecies, retry, unpair, keepPair, clearFinished],
  );
  return <UploadsContext value={value}>{children}</UploadsContext>;
}
