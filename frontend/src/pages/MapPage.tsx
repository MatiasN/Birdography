import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { api, photoUrl, type Photo } from "../api";
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, OSM } from "../map";

export default function MapPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    api<Photo[]>("/photos?limit=200").then((all) => setPhotos(all.filter((p) => p.lat !== null)));
  }, []);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="flex-1 min-h-[70vh]">
      <TileLayer url={OSM} attribution={ATTRIBUTION} />
      {photos.map((photo) => (
        <CircleMarker key={photo.id} center={[photo.lat!, photo.lon!]} radius={7} pathOptions={{ color: "#047857" }}>
          <Popup>
            <img src={photoUrl(photo)} alt="" className="w-40" />
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
