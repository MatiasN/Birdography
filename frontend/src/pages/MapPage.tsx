import { divIcon, type LeafletKeyboardEvent, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomInIcon } from "lucide-react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import ResponsivePanel from "@/components/ResponsivePanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePhotoParam } from "@/usePhotoParam";
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
import InvalidateOnResize from "../InvalidateOnResize";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "../map";
import PhotoDetail from "../PhotoDetail";

/**
 * Every marker is a MARKER_PX circle: a thumbnail for one photo, a count for a group. The white ring stays white in
 * the dark theme because the tiles stay light (D9).
 */
const icon = (item: MapItem) =>
  divIcon({
    className: "",
    iconSize: [MARKER_PX, MARKER_PX],
    html:
      item.kind === "photo"
        ? // A background, not an <img>: Leaflet's CSS forces `width: auto` on images in the marker pane, which
          // would stretch the circle to the photo's aspect ratio.
          `<span class="block size-full rounded-full bg-muted bg-cover bg-center border-2 border-white shadow-md" style="background-image: url('${fileUrl(item.id)}')"></span>`
        : `<span class="size-full rounded-full grid place-items-center bg-primary text-primary-foreground text-xs font-semibold border-2 border-white shadow-md">${countLabel(item.count)}</span>`,
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
    const split = index.splitZoom(item);
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
  const { photoId, open: openPhoto, close: closePhoto } = usePhotoParam();

  const index = useMemo(() => (points ? new PhotoClusters(points) : null), [points]);

  const load = useCallback(() => api<Point[]>("/photos/points").then(setPoints), []);
  useEffect(() => void load(), [load]);

  // The open photo comes from the URL (?photo=), so a link or a reload opens it too.
  useEffect(() => {
    if (photoId !== null) api<Photo>(`/photos/${photoId}`).then(setPhoto, closePhoto); // gone: drop it from the URL
  }, [photoId, closePhoto]);
  const shown = photo?.id === photoId ? photo : null; // the fetched photo, once it matches the URL

  const closeGroup = useCallback(() => setGroup(null), []);

  function changed(fresh: Photo) {
    setPhoto(fresh);
    setGroup(null); // its photos may have moved
    void load();
  }

  const zoomIn = group?.zoomIn;

  return (
    <div className="flex flex-1">
      {/* isolate: Leaflet's controls (z-index 1000) stay inside the map instead of covering the phone sheet. */}
      <div className="relative isolate h-[calc(100dvh-7.5rem)] min-w-0 flex-1 md:h-dvh">
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} maxZoom={MAX_ZOOM} className="size-full">
          <TileLayer url={OSM} attribution={ATTRIBUTION} maxZoom={MAX_ZOOM} />
          <InvalidateOnResize />
          {index && <Markers index={index} onPhoto={openPhoto} onGroup={setGroup} />}
        </MapContainer>

        {index?.size === 0 && (
          <Card className="absolute top-3 left-1/2 z-[1010] -translate-x-1/2 px-4 py-2 text-muted-foreground">
            No photos with a position yet.
          </Card>
        )}
      </div>

      {/* One panel at a time: a photo opened from a group takes its place, and closing it brings the group back. */}
      {shown ? (
        <ResponsivePanel title="Photo details" onClose={closePhoto}>
          <PhotoDetail photo={shown} onChange={changed} />
        </ResponsivePanel>
      ) : (
        group && (
          <ResponsivePanel
            key={group.key}
            title={`${group.photoIds.length} photos here`}
            onClose={closeGroup}
            actions={
              zoomIn && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    zoomIn();
                    setGroup(null);
                  }}
                >
                  <ZoomInIcon />
                  Zoom in
                </Button>
              )
            }
          >
            <GroupPanel photoIds={group.photoIds} onOpen={openPhoto} />
          </ResponsivePanel>
        )
      )}
    </div>
  );
}
