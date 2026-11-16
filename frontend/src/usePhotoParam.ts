import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/** Marks a history entry this app pushed to open a photo, so closing can step back to the entry before it. */
type OpenedHere = { openedHere: true };
const openedHere = (state: unknown): state is OpenedHere =>
  typeof state === "object" && state !== null && "openedHere" in state;

/**
 * The open photo, kept in the URL as `?photo=<id>` (plan 0007 D7): Back closes it, a link opens it, reloading
 * keeps it. Opening pushes one history entry; switching to another photo replaces it, so Back closes the panel
 * rather than stepping through every photo looked at.
 */
export function usePhotoParam() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const raw = params.get("photo");
  const photoId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

  const open = useCallback(
    (id: number) => {
      const next = new URLSearchParams(params);
      next.set("photo", String(id));
      setParams(next, { replace: photoId !== null, state: { openedHere: true } satisfies OpenedHere });
    },
    [params, photoId, setParams],
  );

  const close = useCallback(() => {
    // Opened from this page: go back, so Back afterwards doesn't reopen it. Arrived with the link: just drop it.
    if (openedHere(location.state)) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("photo");
    setParams(next, { replace: true });
  }, [location.state, navigate, params, setParams]);

  return { photoId, open, close };
}
