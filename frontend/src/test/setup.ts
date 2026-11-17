import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Browser APIs jsdom lacks that Radix (menus, sheets, tooltips) and the theme code call. Plain stand-ins:
// layout and pointer capture don't exist in jsdom, so there is nothing to observe or capture.
class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResizeObserver;

/** Give jsdom's Element a method it lacks, leaving it alone if a future jsdom implements it. */
function polyfill<K extends keyof Element>(name: K, value: Element[K]) {
  if (!(name in Element.prototype))
    Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
}
polyfill("hasPointerCapture", () => false);
polyfill("setPointerCapture", () => undefined);
polyfill("releasePointerCapture", () => undefined);
polyfill("scrollIntoView", () => undefined);

/** A light-themed device unless a test stubs `matchMedia` itself (see `stubMatchMedia` in test/media.ts). */
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) satisfies MediaQueryList;

// Object URLs for the Upload tab's previews: jsdom has no blob URLs, so hand out stand-in names.
let objectUrls = 0;
if (!("createObjectURL" in URL)) {
  Object.assign(URL, { createObjectURL: () => `blob:test/${++objectUrls}`, revokeObjectURL: () => undefined });
}
