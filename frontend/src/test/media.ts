import { vi } from "vitest";

/**
 * A controllable `matchMedia`. `prefers-color-scheme: dark` matches while `dark` is true; width queries
 * (`min-width`) match while `wide` is true, i.e. the desktop layout. `set()` / `setWide()` change them and fire
 * `change`, like a device switching theme or a window being resized.
 */
export function stubMatchMedia(initiallyDark = false, initiallyWide = false) {
  let dark = initiallyDark;
  let wide = initiallyWide;
  const listeners = new Set<() => void>();
  const matches = (query: string) => (query.includes("dark") ? dark : query.includes("min-width") ? wide : false);
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  const notify = () => listeners.forEach((listener) => listener());
  return {
    set(value: boolean) {
      dark = value;
      notify();
    },
    setWide(value: boolean) {
      wide = value;
      notify();
    },
    listeners,
  };
}
