import { createContext, useContext } from "react";
import type { Health, Photo, Species } from "@/api";
import type { PairCheck } from "@/lib/exif";

/** Files sent at the same time: enough to keep the line busy with 50 MB RAW files without starving ExifTool. */
export const CONCURRENT_UPLOADS = 2;

export type UploadStatus = "waiting" | "uploading" | "done" | "failed";

/** One file in the upload queue (plan 0008 §7). */
export type UploadItem = {
  key: number;
  file: File;
  /** The camera JPEG of a RAW+JPEG pair, sent with the RAW to become its preview. */
  companion: File | null;
  /** An object URL for files the browser can show (JPEG, PNG, WebP…); RAW and HEIC get an icon instead. */
  preview: string | null;
  /** Sent with the upload; changing them afterwards saves them on the photo. */
  species: Species[];
  status: UploadStatus;
  /** Share of the file sent, 0 to 1. */
  progress: number;
  photo: Photo | null;
  /**
   * For a pair: whether the JPEG looks like the same shot as the RAW, read in the browser before anything is sent
   * (`lib/exif.ts`). "checking" while the files are read.
   */
  pairCheck: PairCheck | "checking" | null;
  /** The user chose to upload a pair whose files look different as one photo anyway. */
  pairKept: boolean;
  /** Why it failed. */
  problem: string | null;
  /** Already uploaded: the user's own copy, to open. */
  existingId: number | null;
  /** Worth trying again: a lost connection or a server error, not a refusal. */
  retryable: boolean;
  /** A species change on an uploaded photo that didn't save. */
  speciesProblem: string | null;
};

export type Uploads = {
  items: UploadItem[];
  /** Species for every file still waiting, and for files added later. */
  batch: Species[];
  /** Queue files; those over the limits fail at once, without being sent. */
  add: (files: File[], limits: Health["limits"] | null) => void;
  addBatchSpecies: (species: Species) => void;
  removeBatchSpecies: (id: number) => void;
  /** A file's species; while it is being sent they can't change (the row doesn't offer it). */
  setSpecies: (item: UploadItem, species: Species[]) => void;
  retry: (key: number) => void;
  /** Split a pair that hasn't been sent (waiting, held, or failed) into two files, each uploaded on its own. */
  unpair: (key: number, limits: Health["limits"] | null) => void;
  /** Upload a pair whose files look like different shots as one photo all the same. */
  keepPair: (key: number) => void;
  /** Drop the files that are done or failed from the list. */
  clearFinished: () => void;
};

/** A pair not sent yet because its files are being compared, or look like two shots and the user hasn't chosen. */
export const heldForPair = (item: UploadItem) =>
  item.pairCheck === "checking" || (item.pairCheck?.state === "different" && !item.pairKept);

/** Waiting or being sent. */
export const inProgress = (item: UploadItem) => item.status === "waiting" || item.status === "uploading";

export const UploadsContext = createContext<Uploads | null>(null);

/** The upload queue, which lives above the routes so it keeps going on other tabs. */
export function useUploads(): Uploads {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error("useUploads needs an UploadsProvider above it");
  return uploads;
}
