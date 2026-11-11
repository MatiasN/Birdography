import { useEffect, useState } from "react";

// Give the panel a `key` per group: the page count then starts over for each one.
import { fileUrl } from "./api";

/** Thumbnails shown at first; big groups reveal more on demand so the browser doesn't load thousands at once. */
export const PAGE = 60;

type Props = {
  photoIds: number[];
  /** Zoom in until the group splits; absent when it never does (photos taken at the same spot). */
  onZoom?: () => void;
  onOpen: (photoId: number) => void;
  onClose: () => void;
  /** False while a photo opened from the panel is on top: Escape then closes only that. */
  listening?: boolean;
};

/** The photos behind a group marker on the map. */
export default function GroupPanel({ photoIds, onZoom, onOpen, onClose, listening = true }: Props) {
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, listening]);

  const rest = photoIds.length - shown;

  return (
    <section
      aria-label="Photos at this spot"
      className="absolute z-[1010] inset-x-2 bottom-2 max-h-[55%] sm:inset-x-auto sm:right-2 sm:top-2 sm:bottom-2 sm:max-h-none sm:w-80 flex flex-col bg-white rounded shadow-lg"
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b">
        <h2 className="font-semibold text-sm">{photoIds.length} photos</h2>
        {onZoom && (
          <button onClick={onZoom} className="ml-auto text-sm px-2 py-1 rounded hover:bg-emerald-100">
            Zoom in
          </button>
        )}
        <button onClick={onClose} className={`${onZoom ? "" : "ml-auto "}text-sm px-2 py-1 rounded hover:bg-stone-100`}>
          Close
        </button>
      </header>
      <div className="overflow-y-auto p-2">
        <div className="grid grid-cols-3 gap-1">
          {photoIds.slice(0, shown).map((id, i) => (
            <button
              key={id}
              type="button"
              aria-label={`Photo ${i + 1} of ${photoIds.length}`}
              onClick={() => onOpen(id)}
              className="aspect-square bg-stone-200 rounded overflow-hidden hover:ring-2 hover:ring-emerald-600"
            >
              <img src={fileUrl(id)} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
        {rest > 0 && (
          <button
            onClick={() => setShown(shown + PAGE)}
            className="mt-2 w-full text-sm py-1 rounded border border-stone-300 hover:bg-stone-100"
          >
            Show {Math.min(rest, PAGE)} more of {rest}
          </button>
        )}
      </div>
    </section>
  );
}
