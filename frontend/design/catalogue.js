// The Catalogue's content, shared by catalogue.html and photo.html (the same page with a photo open).
import { CAMERAS, icon, photo, random, SPECIES, ui } from "./shell.js";

/** 36 sample photos, newest first: species (sometimes two, sometimes none), date, camera, position known. */
export const PHOTOS = (() => {
  const r = random(42);
  let day = Date.UTC(2026, 10, 14, 8, 42);
  return Array.from({ length: 36 }, (_, n) => {
    day -= Math.floor(r() * 3) * 86_400_000 + Math.floor(r() * 5) * 3_600_000;
    const s = Math.floor(r() * SPECIES.length);
    const species = n % 11 === 7 ? [] : n % 6 === 4 ? [s, (s + 3) % SPECIES.length] : [s];
    return { n, species, date: new Date(day), camera: CAMERAS[Math.floor(r() * 3)], located: n % 9 !== 5 };
  });
})();
PHOTOS[0].species = [0]; // the open photo in photo.html: a kingfisher

export const dateText = (d) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function tile(p, selected) {
  const [first, second] = p.species;
  const name =
    first === undefined
      ? `<span class="italic text-muted-foreground">No species yet</span>`
      : `${SPECIES[first][0]}${second === undefined ? "" : ` <span class="text-muted-foreground">+1</span>`}`;
  return `<button class="group overflow-hidden rounded-xl border bg-card text-left shadow-xs ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}">
    <span class="relative block aspect-square w-full" style="background:${photo(p.n)}">${
      p.located
        ? ""
        : `<span class="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium text-warning shadow-xs">${icon("mapPin", "size-3")}No position</span>`
    }</span>
    <span class="block px-3 py-2">
      <span class="block truncate text-sm font-medium">${name}</span>
      <span class="block truncate text-xs text-muted-foreground">${dateText(p.date)} · ${p.camera}</span>
    </span></button>`;
}

const filterButton = (iconName, text, active = false) =>
  `<button class="${ui.outline} ${active ? "border-primary/40 bg-accent text-accent-foreground" : ""}">${icon(iconName, "size-4")}${text}${
    active ? icon("x", "size-3.5") : icon("chevronDown", "size-4 text-muted-foreground")
  }</button>`;

/** Heading, filter bar and grid. `selected`: index of the open photo, `narrowGrid`: fewer columns beside a panel. */
export function catalogue({ selected = -1, narrowGrid = false } = {}) {
  const cols = narrowGrid
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4"
    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
  return `
    <div class="mb-5 hidden items-baseline gap-3 md:flex">
      <h1 class="text-2xl font-semibold tracking-tight">Catalogue</h1>
      <span class="text-sm text-muted-foreground">312 photos · 58 species</span>
    </div>
    <div class="mb-5 flex flex-col gap-2 md:flex-row md:items-center">
      <label class="relative block ${narrowGrid ? "md:w-64" : "md:w-80"}">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">${icon("search", "size-4")}</span>
        <input class="${ui.input} pl-9" placeholder="Species, in English, Portuguese or Latin" aria-label="Species">
      </label>
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        ${filterButton("calendar", "Any date")}
        ${filterButton("camera", "Nikon Z 8", true)}
        ${filterButton("mapPin", "Any position")}
      </div>
      ${narrowGrid ? "" : `<span class="hidden text-sm text-muted-foreground md:ml-auto md:inline">104 of 312 photos</span>`}
    </div>
    <div class="grid ${cols} gap-3">${PHOTOS.map((p, i) => tile(p, i === selected)).join("")}</div>`;
}
