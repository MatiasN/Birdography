import { describe, expect, it } from "vitest";
import {
  countLabel,
  extent,
  JOIN_PX,
  MARKER_PX,
  MAX_ZOOM,
  normalize,
  PhotoClusters,
  type GroupItem,
  type MapItem,
  type Point,
} from "./clusters";

const WORLD: [number, number, number, number] = [-180, -85, 180, 85];

/** Longitude difference that is `px` screen pixels at `zoom` on the equator (Leaflet: 256 px per tile). */
const degreesFor = (px: number, zoom: number) => (px / (256 * 2 ** zoom)) * 360;

/** Small seeded generator, so the random clouds below are the same on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Screen position at `zoom`, as Leaflet draws it. */
function pixel(lat: number, lon: number, zoom: number): [number, number] {
  const world = 256 * 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * world, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * world];
}

const groupOf = (items: MapItem[]) => {
  const group = items.find((item): item is GroupItem => item.kind === "group");
  if (!group) throw new Error("no group drawn");
  return group;
};

describe("PhotoClusters", () => {
  it("merges markers that overlap or nearly touch, and only those", () => {
    expect(JOIN_PX).toBeGreaterThan(MARKER_PX); // anything overlapping joins, with a margin
    const zoom = 10;
    const close = degreesFor(JOIN_PX * 0.95, zoom);
    const apart = degreesFor(JOIN_PX * 1.05, zoom);

    const near = new PhotoClusters([
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: close },
    ]);
    expect(near.at(WORLD, zoom)).toEqual([expect.objectContaining({ kind: "group", count: 2 })]);

    const separate = new PhotoClusters([
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: apart },
    ]);
    expect(separate.at(WORLD, zoom).map((item) => item.kind)).toEqual(["photo", "photo"]);
  });

  it("never draws two markers that overlap, and keeps every photo exactly once", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = random(seed);
      // Dense clumps (a hide, a reserve) plus scattered photos: what supercluster's averaging finds hardest.
      const points: Point[] = Array.from({ length: 400 }, (_, id) => {
        const clump = id % 5;
        const spread = clump < 3 ? 0.02 : 2;
        return {
          id,
          lat: 37 + clump * 0.05 + (next() - 0.5) * spread,
          lon: -8 + clump * 0.07 + (next() - 0.5) * spread,
        };
      });
      const clusters = new PhotoClusters(points);
      for (let zoom = 0; zoom <= MAX_ZOOM; zoom++) {
        const items = clusters.at(WORLD, zoom);
        const centres = items.map((item) => pixel(item.lat, item.lon, zoom));
        let closest = Infinity;
        for (let a = 0; a < centres.length; a++) {
          for (let b = a + 1; b < centres.length; b++) {
            closest = Math.min(closest, Math.hypot(centres[a][0] - centres[b][0], centres[a][1] - centres[b][1]));
          }
        }
        expect(closest, `seed ${seed}, zoom ${zoom}`).toBeGreaterThanOrEqual(MARKER_PX);
        const ids = items.flatMap((item) => (item.kind === "photo" ? [item.id] : clusters.photosIn(item)));
        expect(ids.toSorted((x, y) => x - y)).toEqual(points.map((p) => p.id));
        expect(items.reduce((sum, item) => sum + (item.kind === "photo" ? 1 : item.count), 0)).toBe(points.length);
      }
    }
  });

  it("joins markers that still overlap after clustering, and zooms one level to split them", () => {
    // A join radius smaller than a marker makes supercluster leave overlapping markers for the final pass.
    const zoom = 10;
    const clusters = new PhotoClusters(
      [
        { id: 1, lat: 0, lon: 0 },
        { id: 2, lat: 0, lon: degreesFor(MARKER_PX * 0.5, zoom) },
      ],
      { joinPx: MARKER_PX * 0.25 },
    );
    const group = groupOf(clusters.at(WORLD, zoom));
    expect(group).toMatchObject({ count: 2, zoom, clusters: [] });
    expect(clusters.splitZoom(group)).toBe(zoom + 1);
    expect(clusters.photosIn(group)).toEqual([1, 2]);
    expect(clusters.at(WORLD, zoom + 1).map((item) => item.kind)).toEqual(["photo", "photo"]);
    // Fully zoomed in there is no deeper level to split them at.
    const deepest = new PhotoClusters(
      [
        { id: 1, lat: 0, lon: 0 },
        { id: 2, lat: 0, lon: degreesFor(MARKER_PX * 0.5, MAX_ZOOM) },
      ],
      { joinPx: MARKER_PX * 0.25 },
    );
    expect(deepest.splitZoom(groupOf(deepest.at(WORLD, MAX_ZOOM)))).toBeNull();
  });

  it("splits a group when zooming in far enough, and says at which zoom", () => {
    const zoom = 10;
    const clusters = new PhotoClusters([
      { id: 1, lat: 0, lon: 0 },
      { id: 2, lat: 0, lon: degreesFor(JOIN_PX * 0.9, zoom) }, // joined at 10, twice as far apart at 11
    ]);
    const group = groupOf(clusters.at(WORLD, zoom));
    expect(clusters.splitZoom(group)).toBe(zoom + 1);
    expect(group.clusters).toHaveLength(1);
    expect(clusters.at(WORLD, zoom + 1)).toEqual([
      { kind: "photo", key: "p1", id: 1, lat: 0, lon: 0 },
      { kind: "photo", key: "p2", id: 2, lat: 0, lon: expect.closeTo(degreesFor(JOIN_PX * 0.9, zoom)) },
    ]);
  });

  it("zooms in to where a group really splits, past the level supercluster names", () => {
    // Found by searching random clouds: supercluster splits this group at 13 into two groups whose average positions
    // are less than a marker apart, so the overlap pass draws them as one marker again there.
    const points: Point[] = [
      { id: 1, lat: 38.006386, lon: -9.000079 },
      { id: 2, lat: 38.002179, lon: -8.993447 },
      { id: 3, lat: 37.998032, lon: -8.998864 },
      { id: 4, lat: 38.000138, lon: -8.995328 },
    ];
    const clusters = new PhotoClusters(points);
    const group = groupOf(clusters.at(WORLD, 10));
    expect(group).toMatchObject({ count: 4, clusters: [expect.any(Number)] });
    const markersAt = (zoom: number) => clusters.at(WORLD, zoom).length;
    expect(markersAt(13)).toBe(1); // where supercluster says it splits: still one marker
    expect(clusters.splitZoom(group)).toBe(14);
    expect(markersAt(14)).toBeGreaterThan(1); // one press is enough
  });

  it("never offers to zoom in when even the deepest level draws the group as one marker", () => {
    // supercluster separates the two photos at the deepest zoom, but they are 0.3 markers apart there.
    const clusters = new PhotoClusters(
      [
        { id: 1, lat: 0, lon: 0 },
        { id: 2, lat: 0, lon: degreesFor(MARKER_PX * 0.3, MAX_ZOOM) },
      ],
      { joinPx: MARKER_PX * 0.25 },
    );
    expect(clusters.splitZoom(groupOf(clusters.at(WORLD, MAX_ZOOM - 1)))).toBeNull();
  });

  it("keeps photos taken at the same spot together even fully zoomed in", () => {
    const clusters = new PhotoClusters([
      { id: 1, lat: 37, lon: -8 },
      { id: 2, lat: 37, lon: -8 },
      { id: 3, lat: 37, lon: -8 },
    ]);
    const group = groupOf(clusters.at(WORLD, MAX_ZOOM));
    expect(group).toMatchObject({ count: 3, lat: expect.closeTo(37), lon: expect.closeTo(-8) });
    expect(clusters.splitZoom(group)).toBeNull();
    // Zooms beyond the map's range (or fractional ones) are brought into it.
    expect(clusters.at(WORLD, MAX_ZOOM + 3)).toHaveLength(1);
    expect(clusters.at(WORLD, -2)).toHaveLength(1);
  });

  it("lists a group's photos newest first, as the API sent them", () => {
    const points: Point[] = [30, 10, 20, 40].map((id) => ({ id, lat: 37, lon: -8 }));
    const clusters = new PhotoClusters(points);
    const group = groupOf(clusters.at(WORLD, 5));
    expect(group.count).toBe(4);
    expect(clusters.photosIn(group)).toEqual([30, 10, 20, 40]);
  });

  it("only returns what is in view", () => {
    const clusters = new PhotoClusters([
      { id: 1, lat: 37, lon: -8 }, // Portugal
      { id: 2, lat: -33.9, lon: 151.2 }, // Sydney
    ]);
    expect(clusters.at([-10, 36, -7, 38], 8).map((item) => item.key)).toEqual(["p1"]);
    expect(clusters.size).toBe(2);
  });

  it("handles no photos", () => {
    const clusters = new PhotoClusters([]);
    expect(clusters.at(WORLD, 3)).toEqual([]);
    expect(clusters.size).toBe(0);
    expect(clusters.box).toBeNull();
  });
});

describe("normalize", () => {
  it("leaves ordinary bounds alone", () => {
    expect(normalize([-10, 30, 10, 40])).toEqual([-10, 30, 10, 40]);
  });

  it("wraps longitudes panned past the antimeridian", () => {
    expect(normalize([170, 0, 190, 10])).toEqual([170, 0, -170, 10]);
    expect(normalize([-200, 0, -170, 10])).toEqual([160, 0, -170, 10]);
  });

  it("covers the whole world once the view is 360° wide or more", () => {
    expect(normalize([-300, -100, 300, 100])).toEqual([-180, -90, 180, 90]);
  });
});

describe("extent", () => {
  it("is the box around every point", () => {
    expect(
      extent([
        { id: 1, lat: 37, lon: -8 },
        { id: 2, lat: 41, lon: -9 },
        { id: 3, lat: 38, lon: -6 },
      ]),
    ).toEqual([
      [37, -9],
      [41, -6],
    ]);
  });

  it("is null without points", () => {
    expect(extent([])).toBeNull();
  });

  it("copes with very many points", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => ({ id: i, lat: (i % 180) - 90, lon: (i % 360) - 180 }));
    expect(extent(many)).toEqual([
      [-90, -180],
      [89, 179],
    ]);
  });
});

describe("countLabel", () => {
  it.each([
    [2, "2"],
    [999, "999"],
    [1000, "1k"],
    [1234, "1.2k"],
    [9999, "9.9k"],
    [25_300, "25k"],
  ])("%i -> %s", (count, label) => {
    expect(countLabel(count)).toBe(label);
  });
});
