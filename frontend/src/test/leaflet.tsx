/** Stand-in for react-leaflet: Leaflet needs layout and SVG/canvas APIs jsdom doesn't have. Use with
 * `vi.mock("react-leaflet", () => import("./test/leaflet"))`.
 *
 * - CircleMarker and Marker render as elements carrying their props; a Marker is a button showing its icon's HTML.
 * - `clickMap(lat, lon)` fires the map click handler (useMapEvents `click`).
 * - `fakeMap` is the map instance (useMap): its view is set with `fakeMap.view(bounds, zoom)`,
 *   which fires `moveend` like a pan or zoom; `fitBounds` and `flyTo` are spies. Reset it with `fakeMap.reset()`. */
import { act } from "@testing-library/react";
import type { DivIcon } from "leaflet";
import type { ReactNode } from "react";
import { vi } from "vitest";

type LatLng = [number, number];
type Click = (event: { latlng: { lat: number; lng: number } }) => void;
type Handlers = { click?: Click; moveend?: () => void };

let onClick: Click | undefined;
let onMove: (() => void) | undefined;

class FakeMap {
  bounds: [number, number, number, number] = [-180, -85, 180, 85];
  zoom = 6;
  fitBounds = vi.fn<(box: [LatLng, LatLng], options?: object) => void>();
  flyTo = vi.fn<(center: LatLng, zoom: number) => void>((_, zoom) => this.view(this.bounds, zoom));

  getBounds() {
    const [west, south, east, north] = this.bounds;
    return { getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north };
  }

  getZoom() {
    return this.zoom;
  }

  /** Pan or zoom to this view, as the user would; markers redraw on the `moveend` it fires. */
  view(bounds: [number, number, number, number], zoom: number) {
    this.bounds = bounds;
    this.zoom = zoom;
    const move = onMove;
    if (move) act(() => move());
  }

  reset() {
    this.bounds = [-180, -85, 180, 85];
    this.zoom = 6;
    this.fitBounds.mockClear();
    this.flyTo.mockClear();
  }
}

export const fakeMap = new FakeMap();

export function MapContainer({ children, center, zoom }: { children: ReactNode; center: LatLng; zoom: number }) {
  return (
    <div data-testid="map" data-center={center.join(",")} data-zoom={zoom}>
      {children}
    </div>
  );
}

export const TileLayer = () => null;

export function CircleMarker(props: { children?: ReactNode; center: LatLng; pathOptions?: { color?: string } }) {
  return (
    <div data-testid="marker" data-center={props.center.join(",")} data-color={props.pathOptions?.color}>
      {props.children}
    </div>
  );
}

export function Marker(props: {
  position: LatLng;
  icon: DivIcon;
  title?: string;
  eventHandlers?: { click?: () => void; keydown?: (event: { originalEvent: KeyboardEvent }) => void };
}) {
  return (
    <button
      type="button"
      data-testid="map-marker"
      data-position={props.position.join(",")}
      title={props.title}
      aria-label={props.title}
      onClick={() => props.eventHandlers?.click?.()}
      onKeyDown={(event) => props.eventHandlers?.keydown?.({ originalEvent: event.nativeEvent })}
      dangerouslySetInnerHTML={{ __html: typeof props.icon.options.html === "string" ? props.icon.options.html : "" }}
    />
  );
}

export const Popup = ({ children }: { children: ReactNode }) => <div data-testid="popup">{children}</div>;

export const useMap = () => fakeMap;

export function useMapEvents(handlers: Handlers) {
  if (handlers.click) onClick = handlers.click;
  if (handlers.moveend) onMove = handlers.moveend;
  return fakeMap;
}

export function clickMap(lat: number, lng: number) {
  if (!onClick) throw new Error("no map is listening for clicks");
  const click = onClick;
  act(() => click({ latlng: { lat, lng } }));
}
