import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { api, photoUrl, position, type Photo } from "../api";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "../map";

export default function MapPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    void api<Photo[]>("/photos?limit=200").then(setPhotos);
  }, []);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="flex-1 min-h-[70vh]">
      <TileLayer url={OSM} attribution={ATTRIBUTION} />
      {photos.map((photo) => {
        const at = position(photo);
        return (
          at && (
            <CircleMarker key={photo.id} center={at} radius={7} pathOptions={{ color: "#047857" }}>
              <Popup>
                <img src={photoUrl(photo)} alt="" className="w-40" />
              </Popup>
            </CircleMarker>
          )
        );
      })}
    </MapContainer>
  );
}
