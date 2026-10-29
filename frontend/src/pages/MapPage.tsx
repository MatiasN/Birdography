import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { api, photoUrl, type Photo } from "../api";

const OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export default function MapPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    api<Photo[]>("/photos?limit=200").then((all) => setPhotos(all.filter((p) => p.lat !== null)));
  }, []);

  return (
    <MapContainer center={[39.5, -8]} zoom={6} className="flex-1 min-h-[70vh]">
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
