// Shared frame for the static mockups (plan 0007 §3): the navigation, icons, sample data and placeholder photos.
// Not part of the app: `vite build` only builds index.html, and nothing in src/ imports this.
import "./mockup.css";
import { __iconData as arrowLeft } from "lucide-react/icons/arrow-left";
import { __iconData as bird } from "lucide-react/icons/bird";
import { __iconData as calendar } from "lucide-react/icons/calendar";
import { __iconData as camera } from "lucide-react/icons/camera";
import { __iconData as check } from "lucide-react/icons/check";
import { __iconData as chevronDown } from "lucide-react/icons/chevron-down";
import { __iconData as circleAlert } from "lucide-react/icons/circle-exclamation-point";
import { __iconData as images } from "lucide-react/icons/images";
import { __iconData as imageUp } from "lucide-react/icons/image-up";
import { __iconData as locateFixed } from "lucide-react/icons/locate-fixed";
import { __iconData as logOut } from "lucide-react/icons/log-out";
import { __iconData as map } from "lucide-react/icons/map";
import { __iconData as mapPin } from "lucide-react/icons/map-pin";
import { __iconData as minus } from "lucide-react/icons/minus";
import { __iconData as monitor } from "lucide-react/icons/monitor";
import { __iconData as moon } from "lucide-react/icons/moon";
import { __iconData as plus } from "lucide-react/icons/plus";
import { __iconData as search } from "lucide-react/icons/search";
import { __iconData as sun } from "lucide-react/icons/sun";
import { __iconData as upload } from "lucide-react/icons/upload";
import { __iconData as user } from "lucide-react/icons/user";
import { __iconData as x } from "lucide-react/icons/x";
import { __iconData as zoomIn } from "lucide-react/icons/zoom-in";

const ICONS = {
  arrowLeft,
  bird,
  calendar,
  camera,
  check,
  chevronDown,
  circleAlert,
  images,
  imageUp,
  locateFixed,
  logOut,
  map,
  mapPin,
  minus,
  monitor,
  moon,
  plus,
  search,
  sun,
  upload,
  user,
  x,
  zoomIn,
};

/** An inline lucide icon as SVG markup. */
export function icon(name, cls = "size-5") {
  const body = ICONS[name].node
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .filter(([k]) => k !== "key")
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const SPECIES = [
  ["Common kingfisher", "Guarda-rios", "Alcedo atthis"],
  ["Grey heron", "Garça-real", "Ardea cinerea"],
  ["Eurasian hoopoe", "Poupa", "Upupa epops"],
  ["European robin", "Pisco-de-peito-ruivo", "Erithacus rubecula"],
  ["Greater flamingo", "Flamingo-comum", "Phoenicopterus roseus"],
  ["White stork", "Cegonha-branca", "Ciconia ciconia"],
  ["Iberian magpie", "Charneco", "Cyanopica cooki"],
  ["Black-winged stilt", "Pernilongo", "Himantopus himantopus"],
  ["Eurasian spoonbill", "Colhereiro", "Platalea leucorodia"],
  ["European bee-eater", "Abelharuco", "Merops apiaster"],
  ["Little egret", "Garça-branca-pequena", "Egretta garzetta"],
  ["Sardinian warbler", "Toutinegra-de-cabeça-preta", "Curruca melanocephala"],
];
export const CAMERAS = ["Nikon Z 8", "Canon EOS R5", "Sony ILCE-7M4"];

/** Deterministic pseudo-random numbers, so every render of a mockup is identical. */
export function random(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// Out-of-focus backgrounds like a telephoto shot: reeds, water, sky, earth.
const SCENES = [
  [
    [95, 120, 60],
    [160, 170, 90],
    [60, 80, 40],
  ],
  [
    [70, 110, 130],
    [150, 185, 195],
    [40, 70, 90],
  ],
  [
    [140, 110, 70],
    [200, 175, 120],
    [90, 70, 45],
  ],
  [
    [80, 100, 70],
    [190, 200, 150],
    [50, 60, 45],
  ],
  [
    [120, 140, 160],
    [210, 220, 225],
    [90, 105, 120],
  ],
];
const rgb = ([r, g, b], d = 0) => `rgb(${r + d} ${g + d} ${b + d})`;

/** A CSS background standing in for photo `n`: a blurred scene with a darker subject in focus. */
export function photo(n) {
  const r = random(n * 7919 + 13);
  const [base, light, dark] = SCENES[n % SCENES.length];
  const bx = 30 + r() * 40,
    by = 35 + r() * 30,
    size = 18 + r() * 14;
  const spots = Array.from(
    { length: 4 },
    () => `radial-gradient(circle at ${r() * 100}% ${r() * 100}%, ${rgb(light, 20)} 0, transparent ${8 + r() * 12}%)`,
  );
  return [
    `radial-gradient(ellipse ${size}% ${size * 0.8}% at ${bx}% ${by}%, ${rgb(dark, -25)} 0, ${rgb(dark)} 55%, transparent 100%)`,
    ...spots,
    `linear-gradient(${150 + r() * 60}deg, ${rgb(light)} 0%, ${rgb(base)} 55%, ${rgb(dark)} 100%)`,
  ].join(",");
}

/** OpenStreetMap tiles around a point, as Leaflet would draw them, for map mockups. */
export function tiles(el, { lat, lon, zoom }) {
  const n = 2 ** zoom;
  const fx = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const { width, height } = el.getBoundingClientRect();
  const x0 = Math.floor(fx - width / 512) - 1,
    x1 = Math.ceil(fx + width / 512);
  const y0 = Math.floor(fy - height / 512) - 1,
    y1 = Math.ceil(fy + height / 512);
  let html = "";
  for (let tx = x0; tx <= x1; tx++)
    for (let ty = y0; ty <= y1; ty++) {
      const left = width / 2 + (tx - fx) * 256,
        top = height / 2 + (ty - fy) * 256;
      html += `<img src="https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png" alt="" class="absolute max-w-none" style="left:${left}px;top:${top}px;width:256px;height:256px">`;
    }
  el.insertAdjacentHTML("afterbegin", `<div class="absolute inset-0 overflow-hidden">${html}</div>`);
  return {
    toPx: (la, lo) => {
      const r2 = (la * Math.PI) / 180;
      const y = ((1 - Math.log(Math.tan(r2) + 1 / Math.cos(r2)) / Math.PI) / 2) * n;
      return [width / 2 + (((lo + 180) / 360) * n - fx) * 256, height / 2 + (y - fy) * 256];
    },
  };
}

export const MAP_ATTRIBUTION = `<div class="absolute bottom-0 right-0 z-10 bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">© OpenStreetMap contributors</div>`;
export const MAP_ZOOM = `<div class="absolute left-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border bg-card shadow-sm">
     <span class="grid size-9 place-items-center border-b">${icon("plus", "size-4")}</span>
     <span class="grid size-9 place-items-center">${icon("minus", "size-4")}</span></div>`;

const TABS = [
  ["catalogue", "Catalogue", "images"],
  ["species", "Species", "bird"],
  ["upload", "Upload", "upload"],
  ["map", "Map", "map"],
  ["near-me", "Near me", "locateFixed"],
];

const EMAIL = "matias@example.org";
export const avatar = (cls = "size-8 text-sm") =>
  `<span class="${cls} grid place-items-center rounded-full bg-primary font-semibold text-primary-foreground">M</span>`;

export const logo = (cls = "size-8") => `<img src="/logo.svg" alt="" class="${cls}">`;

function sidebar(active) {
  const item = ([id, label, name]) => {
    const on = id === active;
    return `<a ${on ? 'aria-current="page"' : ""} class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium xl:flex-row xl:gap-3 xl:px-3 xl:text-sm ${
      on ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70"
    }">${icon(name)}<span>${label}</span></a>`;
  };
  return `<nav aria-label="Main" class="hidden md:flex sticky top-0 h-dvh w-20 xl:w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3">
    <div class="mb-6 flex items-center justify-center gap-2 xl:justify-start xl:px-2">${logo("size-9")}<span class="hidden xl:inline text-lg font-semibold tracking-tight">Birdography</span></div>
    <div class="flex flex-col gap-1">${TABS.map(item).join("")}</div>
    <div class="mt-auto flex items-center justify-center gap-3 rounded-lg p-2 xl:justify-start ${active === "profile" ? "bg-sidebar-accent" : ""}">
      ${avatar()}<span class="hidden xl:block min-w-0 flex-1 truncate text-sm">${EMAIL}</span>
      <span class="hidden xl:block text-muted-foreground">${icon("chevronDown", "size-4")}</span></div>
  </nav>`;
}

function phoneBars(active, title) {
  const tab = ([id, label, name]) => {
    const on = id === active;
    return `<a ${on ? 'aria-current="page"' : ""} class="flex flex-1 flex-col items-center gap-1 pt-2 text-[11px] font-medium ${on ? "text-primary" : "text-muted-foreground"}">
      <span class="grid h-7 w-14 place-items-center rounded-full ${on ? "bg-accent" : ""}">${icon(name)}</span>${label}</a>`;
  };
  return {
    top: `<header class="md:hidden sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      ${logo("size-7")}<h1 class="flex-1 text-lg font-semibold">${title}</h1>${avatar()}</header>`,
    bottom: `<nav aria-label="Main" class="md:hidden fixed inset-x-0 bottom-0 z-20 flex h-16 border-t bg-background pb-[env(safe-area-inset-bottom)]">${TABS.map(tab).join("")}</nav>`,
  };
}

/**
 * Wrap the page's <main> in the app frame. <body data-tab="catalogue" data-title="Catalogue">; `data-bare` for
 * the login page. `?theme=dark` renders the dark theme.
 */
export function frame() {
  const params = new URLSearchParams(location.search);
  document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
  const { tab, title, bare } = document.body.dataset;
  if (bare !== undefined) return;
  const main = document.querySelector("main");
  const bars = phoneBars(tab, title);
  const shell = document.createElement("div");
  shell.className = "flex min-h-dvh";
  shell.innerHTML = sidebar(tab);
  const column = document.createElement("div");
  column.className = "flex min-w-0 flex-1 flex-col pb-16 md:pb-0";
  column.insertAdjacentHTML("afterbegin", bars.top);
  main.replaceWith(shell);
  column.append(main);
  column.insertAdjacentHTML("beforeend", bars.bottom);
  shell.append(column);
}

/** Fill every `[data-icon]` element with its icon. */
export function icons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]"))
    el.innerHTML = icon(el.dataset.icon, el.dataset.cls ?? "size-5");
}

/** Class lists matching shadcn's Button, Input, Card and Badge (radix-nova), for static markup. */
export const ui = {
  button:
    "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs",
  outline:
    "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-sm font-medium shadow-xs",
  ghost: "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium",
  iconButton: "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground",
  input:
    "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs placeholder:text-muted-foreground",
  card: "rounded-xl border bg-card text-card-foreground shadow-sm",
  badge: "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
  label: "text-sm font-medium",
};

/** A page: the HTML boilerplate is the same for every mockup, only the body differs. */
export function page(build) {
  frame();
  build();
  icons();
}
