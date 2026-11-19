import { DATE_FORMAT } from "@/api";

/**
 * The Catalogue's filters (plan 0008 §6), kept in the URL next to `?photo=`, so Back undoes a change and a link or
 * a reload keeps them: `?species=1,4&from=2026-01-01&to=2026-11-17&make=Nikon&model=Z%208&located=false`.
 */
export type Filters = {
  species: number[];
  from: string | null; // YYYY-MM-DD, the day on the camera's clock
  to: string | null;
  make: string | null;
  model: string | null;
  located: boolean | null;
};

export const NO_FILTERS: Filters = { species: [], from: null, to: null, make: null, model: null, located: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["species", "from", "to", "make", "model", "located"] as const;

const day = (value: string | null) => (value !== null && DAY.test(value) ? value : null);

/** The filters in these search params; malformed values are ignored. */
export function readFilters(params: URLSearchParams): Filters {
  const species = (params.get("species") ?? "")
    .split(",")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
  const located = params.get("located");
  return {
    species: [...new Set(species)],
    from: day(params.get("from")),
    to: day(params.get("to")),
    make: params.get("make") || null,
    model: params.get("model") || null,
    located: located === "true" ? true : located === "false" ? false : null,
  };
}

/** `params` with the filters replaced by these; anything else (the open photo) is kept. */
export function writeFilters(params: URLSearchParams, filters: Filters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of KEYS) next.delete(key);
  if (filters.species.length > 0) next.set("species", filters.species.join(","));
  if (filters.from) next.set("from", filters.from);
  if (filters.to) next.set("to", filters.to);
  if (filters.make) next.set("make", filters.make);
  if (filters.model) next.set("model", filters.model);
  if (filters.located !== null) next.set("located", String(filters.located));
  return next;
}

/** The API's query parameters for these filters (plus `extra`), as `?…`, or "" when there are none. */
export function apiQuery(filters: Filters, extra: Record<string, string | number> = {}): string {
  const query = new URLSearchParams();
  for (const id of filters.species) query.append("species_id", String(id));
  if (filters.from) query.set("date_from", filters.from);
  if (filters.to) query.set("date_to", filters.to);
  if (filters.make) query.set("camera_make", filters.make);
  if (filters.model) query.set("camera_model", filters.model);
  if (filters.located !== null) query.set("located", String(filters.located));
  for (const [key, value] of Object.entries(extra)) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const hasFilters = (filters: Filters) => apiQuery(filters) !== "";

/** "14 Nov 2026" for a YYYY-MM-DD day, in the browser's language. */
export const dayLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, DATE_FORMAT);

/** What the date filter's button says. */
export function dateLabel({ from, to }: Pick<Filters, "from" | "to">): string {
  if (from && to) return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
  if (from) return `From ${dayLabel(from)}`;
  if (to) return `Until ${dayLabel(to)}`;
  return "Any date";
}

/** YYYY-MM-DD of a local date. */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
