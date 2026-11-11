import { divIcon, type LeafletKeyboardEvent, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { api, fileUrl, type Photo } from "../api";
import {
  countLabel,
  MARKER_PX,
  MAX_ZOOM,
  PhotoClusters,
  type Bounds,
  type GroupItem,
  type MapItem,
  type Point,
} from "../clusters";
import GroupPanel from "../GroupPanel";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "../map";
import PhotoDetail from "../PhotoDetail";

/** Every marker is a MARKER_PX circle: a thumbnail for one photo, a count for a group. */
const icon = (item: MapItem) =>
  divIcon({
    className: "",
    iconSize: [MARKER_PX, MARKER_PX],
    html:
      item.kind === "photo"
        ? // A background, not an <img>: Leaflet's CSS forces `width: auto` on images in the marker pane, which
          // would stretch the circle to the photo's aspect ratio.
          `<span class="block w-full h-full rounded-full bg-cover bg-center border-2 border-white shadow bg-stone-300" style="background-image: url('${fileUrl(item.id)}')"></span>`
        : `<span class="w-full h-full rounded-full grid place-items-center bg-emerald-700 text-white text-xs font-semibold border-2 border-white shadow">${countLabel(item.count)}</span>`,
  });

/** A group marker the user clicked: its photos, and a way to zoom until it splits (none for a single spot). */
type Group = { key: string; photoIds: number[]; zoomIn?: () => void };

type MarkersProps = { index: PhotoClusters; onPhoto: (id: number) => void; onGroup: (group: Group) => void };

type View = { bounds: Bounds; zoom: number };

const viewOf = (map: LeafletMap): View => {
  const b = map.getBounds();
  return { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() };
};

/** The markers in view, redrawn whenever the map stops moving. Frames every photo the first time there are some. */
function Markers({ index, onPhoto, onGroup }: MarkersProps) {
  const map = useMap();
  const [view, setView] = useState(() => viewOf(map));
  const items = useMemo(() => index.at(view.bounds, view.zoom), [index, view]);
  const framed = useRef(false);

  useMapEvents({ moveend: () => setView(viewOf(map)) });

  // First photos: frame them all (that move redraws the markers). Later reloads keep the user's view.
  useEffect(() => {
    if (!framed.current && index.box) {
      framed.current = true;
      map.fitBounds(index.box, { padding: [MARKER_PX, MARKER_PX], maxZoom: 12 });
    }
  }, [map, index]);

  const open = (item: MapItem) => (item.kind === "photo" ? onPhoto(item.id) : openGroup(item));

  function openGroup(item: GroupItem) {
    const split = item.splitZoom;
    onGroup({
      key: item.key,
      photoIds: index.photosIn(item),
      zoomIn: split === null ? undefined : () => map.flyTo([item.lat, item.lon], split),
    });
  }

  return items.map((item) => (
    <Marker
      key={item.key}
      position={[item.lat, item.lon]}
      icon={icon(item)}
      title={item.kind === "photo" ? "Open photo" : `${item.count} photos`}
      eventHandlers={{
        click: () => open(item),
        // Leaflet makes markers focusable buttons, but leaves Enter and Space to us.
        keydown: (event: LeafletKeyboardEvent) => {
          if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") {
            event.originalEvent.preventDefault();
            open(item);
          }
        },
      }}
    />
  ));
}

export default function MapPage() {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);

  const index = useMemo(() => (points ? new PhotoClusters(points) : null), [points]);

  const load = useCallback(() => api<Point[]>("/photos/points").then(setPoints), []);
  useEffect(() => void load(), [load]);

  const openPhoto = useCallback((id: number) => void api<Photo>(`/photos/${id}`).then(setPhoto), []);
  const closeGroup = useCallback(() => setGroup(null), []);
  const closePhoto = useCallback(() => setPhoto(null), []);

  function changed(fresh: Photo) {
    setPhoto(fresh);
    setGroup(null); // its photos may have moved
    void load();
  }

  const zoomIn = group?.zoomIn;

  return (
    <div className="relative flex-1 flex">
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} maxZoom={MAX_ZOOM} className="flex-1 min-h-[70vh]">
        <TileLayer url={OSM} attribution={ATTRIBUTION} maxZoom={MAX_ZOOM} />
        {index && <Markers index={index} onPhoto={openPhoto} onGroup={setGroup} />}
      </MapContainer>

      {index?.size === 0 && (
        <p className="absolute z-[1010] top-3 left-1/2 -translate-x-1/2 bg-white rounded shadow px-3 py-1 text-sm text-stone-600">
          No photos with a position yet.
        </p>
      )}

      {group && (
        <GroupPanel
          key={group.key}
          photoIds={group.photoIds}
          onZoom={
            zoomIn &&
            (() => {
              zoomIn();
              setGroup(null);
            })
          }
          onOpen={openPhoto}
          onClose={closeGroup}
          listening={!photo}
        />
      )}

      {photo && <PhotoDetail photo={photo} onChange={changed} onClose={closePhoto} />}
    </div>
  );
}
