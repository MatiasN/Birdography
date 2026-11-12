import Supercluster from "supercluster";

/** Diameter of every map marker, single photo or group, in screen pixels. */
export const MARKER_PX = 40;
/** Markers whose centres are closer than this join into one: overlapping, or less than half a marker apart. */
export const JOIN_PX = MARKER_PX * 1.5;
/** Deepest zoom of the map (OpenStreetMap's tiles stop at 19). */
export const MAX_ZOOM = 19;

/** A located photo, as `GET /photos/points` returns it (newest first). */
export type Point = { id: number; lat: number; lon: number };

/** A photo inside the index: its id and its place in the API's newest-first order. */
export type Leaf = { photo: number; rank: number };

export type PhotoItem = { kind: "photo"; key: string; id: number; lat: number; lon: number };
export type GroupItem = {
  kind: "group";
  key: string;
  lat: number;
  lon: number;
  count: number;
  /** The zoom it was drawn at; `PhotoClusters.splitZoom` looks deeper from there. */
  zoom: number;
  /** What the marker is made of: supercluster groups and single photos. */
  clusters: number[];
  photos: Leaf[];
};
export type MapItem = PhotoItem | GroupItem;

/** [west, south, east, north] in degrees, as Leaflet's bounds give them (longitudes may run past ±180). */
export type Bounds = [number, number, number, number];

/** One supercluster result, placed on screen: a group (`cluster`) or a single photo (`leaf`). */
type Raw = { lat: number; lon: number; x: number; y: number; count: number } & (
  { cluster: number; leaf?: undefined } | { cluster?: undefined; leaf: Leaf }
);
/** One marker as drawn: the result it sits on and every result joined into it (that one included). */
type Drawn = { anchor: Raw; parts: Raw[] };

/** Pixel position at `zoom` in Web Mercator, as Leaflet draws it (256 px tiles). */
function project(lat: number, lon: number, zoom: number): [number, number] {
  const world = 256 * 2 ** zoom;
  const phi = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * world, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * world];
}

/**
 * Groups markers that overlap or nearly touch on screen, in two steps:
 *
 * 1. supercluster joins photos whose markers would be closer than JOIN_PX at the current zoom.
 * 2. It places each group at the average position of its photos, which can drift onto a neighbour. A final pass
 *    therefore joins whatever would still overlap (centres closer than MARKER_PX) into the larger marker, so no
 *    two drawn markers ever overlap.
 *
 * Zooming in splits groups again, except photos taken at (nearly) the same spot, which stay together at MAX_ZOOM.
 */
export class PhotoClusters {
  private readonly index: Supercluster<Leaf>;
  readonly size: number;
  /** The box around every photo, to frame them all; null without photos. */
  readonly box: [[number, number], [number, number]] | null;
  /** The photos as given; a leaf's `rank` is its place here. */
  private readonly points: Point[];

  constructor(points: Point[], { joinPx = JOIN_PX }: { joinPx?: number } = {}) {
    // supercluster measures `radius` against `extent`, its tile size. Leaflet's tiles are 256 px, so with
    // extent 256 the radius is in screen pixels.
    this.index = new Supercluster<Leaf>({ radius: joinPx, extent: 256, maxZoom: MAX_ZOOM, minPoints: 2 });
    this.index.load(
      points.map((p, rank) => ({
        type: "Feature",
        properties: { photo: p.id, rank },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    );
    this.points = points;
    this.size = points.length;
    this.box = extent(points);
  }

  /** What to draw for the visible area at this zoom. */
  at(bounds: Bounds, zoom: number): MapItem[] {
    const z = Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom)));
    return this.layout(bounds, z).map(({ anchor, parts }) => this.toItem(anchor, parts, z));
  }

  /** The markers for the area at a whole zoom: supercluster's groups, then the overlap pass. */
  private layout(bounds: Bounds, z: number): Drawn[] {
    const raw: Raw[] = this.index.getClusters(normalize(bounds), z).map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const [x, y] = project(lat, lon, z);
      const props = feature.properties;
      return "cluster_id" in props
        ? { lat, lon, x, y, count: props.point_count, cluster: props.cluster_id }
        : { lat, lon, x, y, count: 1, leaf: props };
    });

    // Biggest first: a large group keeps its place and takes in small neighbours that would overlap it.
    const drawn: Drawn[] = [];
    for (const item of raw.toSorted((a, b) => b.count - a.count)) {
      const host = drawn.find(({ anchor }) => (anchor.x - item.x) ** 2 + (anchor.y - item.y) ** 2 < MARKER_PX ** 2);
      if (host) host.parts.push(item);
      else drawn.push({ anchor: item, parts: [item] });
    }
    return drawn;
  }

  private toItem(anchor: Raw, parts: Raw[], zoom: number): MapItem {
    const { lat, lon } = anchor;
    if (parts.length === 1 && anchor.leaf) {
      return { kind: "photo", key: `p${anchor.leaf.photo}`, id: anchor.leaf.photo, lat, lon };
    }
    const clusters = parts.flatMap((part) => (part.cluster === undefined ? [] : [part.cluster]));
    const photos = parts.flatMap((part) => (part.leaf ? [part.leaf] : []));
    return {
      kind: "group",
      key: `g${clusters.join(",")}|${photos.map((leaf) => leaf.photo).join(",")}`,
      lat,
      lon,
      count: parts.reduce((sum, part) => sum + part.count, 0),
      zoom,
      clusters,
      photos,
    };
  }

  /**
   * The zoom at which a group marker splits, for "Zoom in": the first level deeper at which its photos are drawn as
   * more than one marker, or null if that never happens on this map (photos at the same spot).
   *
   * supercluster names a level, and markers joined by the overlap pass split one level deeper (twice the distance),
   * but both are only a first guess: supercluster splits a group into groups placed at their photos' average, which
   * can be closer than a marker, and the overlap pass would join them back. So each level is laid out to check.
   * Asked when a group is opened, not for every marker on every redraw: with thousands of photos the check costs
   * tens of milliseconds.
   */
  splitZoom(group: GroupItem): number | null {
    const single = group.clusters.length === 1 && group.photos.length === 0;
    const guess = single ? this.index.getClusterExpansionZoom(group.clusters[0]) : group.zoom + 1;
    if (guess > MAX_ZOOM) return null; // photos at the same spot: nothing to check
    const mine = new Set(this.photosIn(group));
    const spots = [...group.photos, ...group.clusters.flatMap((id) => this.leaves(id))].map(
      (leaf) => this.points[leaf.rank],
    );
    let [west, south, east, north] = [180, 90, -180, -90];
    for (const { lat, lon } of spots) {
      [west, south, east, north] = [
        Math.min(west, lon),
        Math.min(south, lat),
        Math.max(east, lon),
        Math.max(north, lat),
      ];
    }
    // supercluster's levels nest: a result one level deeper lies wholly inside one result of the level above, so a
    // single photo of it tells whether it is part of this group.
    const isMine = (part: Raw) =>
      mine.has(part.leaf ? part.leaf.photo : this.index.getLeaves(part.cluster, 1)[0].properties.photo);
    for (let z = guess; z <= MAX_ZOOM; z++) {
      // Everything that can reach the group's markers at this zoom: its photos, and three markers around them.
      const pad = (3 * MARKER_PX * 360) / (256 * 2 ** z);
      const around: Bounds = [west - pad, south - pad, east + pad, north + pad];
      const holding = this.layout(normalize(around), z).filter(({ parts }) => parts.some(isMine));
      if (holding.length > 1) return z;
    }
    return null;
  }

  private leaves(cluster: number): Leaf[] {
    return this.index.getLeaves(cluster, Infinity).map((leaf) => leaf.properties);
  }

  /** Every photo behind a group marker, newest first. */
  photosIn(group: GroupItem): number[] {
    const leaves = group.clusters.flatMap((id) => this.leaves(id));
    return [...group.photos, ...leaves].toSorted((a, b) => a.rank - b.rank).map((leaf) => leaf.photo);
  }
}

/** Bring Leaflet's bounds into supercluster's range: longitudes within ±180 (west > east crosses the antimeridian),
 * the whole world once the view spans 360° or more. */
const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function normalize([west, south, east, north]: Bounds): Bounds {
  if (east - west >= 360) return [-180, clampLat(south), 180, clampLat(north)];
  return [wrapLon(west), clampLat(south), wrapLon(east), clampLat(north)];
}

/** [[south, west], [north, east]] around every point, for the first view; null when there are none. */
export function extent(points: Point[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  // A loop, not Math.min(...array): spreading tens of thousands of arguments overflows the call stack.
  let [south, west, north, east] = [90, 180, -90, -180];
  for (const { lat, lon } of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return [
    [south, west],
    [north, east],
  ];
}

/** 7 -> "7", 1234 -> "1.2k", 25300 -> "25k": short enough for a marker. */
export function countLabel(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? Math.floor(thousands * 10) / 10 : Math.round(thousands)}k`;
}
