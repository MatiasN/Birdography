import { useEffect, useState, type ChangeEvent } from "react";
import { api, photoUrl, type Photo } from "../api";

const ACCEPT = "image/*,.dng,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf";

export default function Photos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = () => api<Photo[]>("/photos").then(setPhotos);

  useEffect(() => {
    load();
  }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    setUploading(true);
    for (const file of event.target.files ?? []) {
      const body = new FormData();
      body.append("file", file);
      await api("/photos", { method: "POST", body });
    }
    event.target.value = "";
    setUploading(false);
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <label className="inline-block cursor-pointer bg-emerald-700 text-white rounded px-4 py-2 hover:bg-emerald-800">
        {uploading ? "Uploading..." : "Upload photos"}
        <input type="file" multiple accept={ACCEPT} hidden onChange={upload} />
      </label>

      {photos.length === 0 && <p className="text-stone-500">No photos yet.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {photos.map((photo) => (
          <figure key={photo.id} className="bg-white rounded overflow-hidden shadow-sm">
            <img src={photoUrl(photo)} alt="" loading="lazy" className="aspect-square w-full object-cover bg-stone-200" />
            <figcaption className="px-2 py-1 text-xs text-stone-500 truncate">
              {photo.taken_at ? new Date(photo.taken_at).toLocaleDateString() : "No date"}
              {photo.camera && ` · ${photo.camera}`}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
