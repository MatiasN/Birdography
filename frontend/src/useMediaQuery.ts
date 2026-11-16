import { useSyncExternalStore } from "react";

/** The width from which pages get the desktop layout (Tailwind's `md`, plan 0007 D2). */
export const WIDE = "(min-width: 768px)";

/** Whether a media query matches, kept up to date as the window or the device changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}
