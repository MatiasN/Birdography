import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Leaflet measures its container once; when a side panel opens beside the map, or a sheet animates in around it,
 * the container changes size and Leaflet would leave grey tiles. This redraws the map whenever it does.
 */
export default function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
