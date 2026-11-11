/** Stand-in for react-leaflet: Leaflet needs layout and SVG/canvas APIs jsdom doesn't have. Use with
 * `vi.mock("react-leaflet", () => import("./test/leaflet"))`.
 *
 * - CircleMarker renders as an element carrying its props.
 * - `clickMap(lat, lon)` fires the map click handler (useMapEvents `click`). */
import { act } from "@testing-library/react";
import type { ReactNode } from "react";

type LatLng = [number, number];
type Click = (event: { latlng: { lat: number; lng: number } }) => void;

let onClick: Click | undefined;

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

export const Popup = ({ children }: { children: ReactNode }) => <div data-testid="popup">{children}</div>;

export function useMapEvents(handlers: { click?: Click }) {
  if (handlers.click) onClick = handlers.click;
  return null;
}

export function clickMap(lat: number, lng: number) {
  if (!onClick) throw new Error("no map is listening for clicks");
  const click = onClick;
  act(() => click({ latlng: { lat, lng } }));
}
