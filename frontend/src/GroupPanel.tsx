import { useState } from "react";
import { Button } from "@/components/ui/button";

// Give the panel a `key` per group: the page count then starts over for each one.
import { fileUrl } from "./api";

/** Thumbnails shown at first; big groups reveal more on demand so the browser doesn't load thousands at once. */
export const PAGE = 60;

type Props = {
  photoIds: number[];
  onOpen: (photoId: number) => void;
};

/** The photos behind a group marker on the map, shown inside the page's panel or sheet. */
export default function GroupPanel({ photoIds, onOpen }: Props) {
  const [shown, setShown] = useState(PAGE);
  const rest = photoIds.length - shown;

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-3 gap-2">
        {photoIds.slice(0, shown).map((id, i) => (
          <button
            key={id}
            type="button"
            aria-label={`Photo ${i + 1} of ${photoIds.length}`}
            onClick={() => onOpen(id)}
            className="aspect-square overflow-hidden rounded-lg bg-muted outline-none hover:ring-2 hover:ring-primary focus-visible:ring-3 focus-visible:ring-ring"
          >
            <img src={fileUrl(id)} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      {rest > 0 && (
        <Button variant="outline" className="w-full" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(rest, PAGE)} more of {rest}
        </Button>
      )}
    </div>
  );
}
