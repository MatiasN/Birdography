import { useEffect, useState, type ChangeEvent } from "react";
import {
  api,
  ApiError,
  hasFile,
  IMAGE_EXTENSIONS,
  photoUrl,
  sizeProblem,
  takenDate,
  type Health,
  type Photo,
} from "../api";

const ACCEPT = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
/** Large uploads get their thumbnail after the response; fetch the photo again once, after this delay. */
const THUMBNAIL_RETRY_MS = 2000;

export default function Photos() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [limits, setLimits] = useState<Health["limits"] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function replace(fresh: Photo) {
    setPhotos((current) => current.map((p) => (p.id === fresh.id ? fresh : p)));
  }

  const load = () => api<Photo[]>("/photos").then(setPhotos);

  useEffect(() => {
    load();
    api<Health>("/health").then((health) => setLimits(health.limits));
  }, []);

  function refreshLater(id: number) {
    setTimeout(() => {
      api<Photo>(`/photos/${id}`).then(replace);
    }, THUMBNAIL_RETRY_MS);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    setUploading(true);
    const problems: string[] = [];
    const pending: number[] = [];
    for (const file of event.target.files ?? []) {
      const problem = limits && sizeProblem(file, limits);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      try {
        const photo = await api<Photo>("/photos", { method: "POST", body });
        if (!hasFile(photo, "thumbnail")) pending.push(photo.id);
      } catch (error) {
        const detail = error instanceof ApiError ? error.message : "upload failed";
        problems.push(`${file.name}: ${detail}`);
      }
    }
    event.target.value = "";
    setErrors(problems);
    setUploading(false);
    await load();
    pending.forEach(refreshLater);
  }

  return (
    <div className="p-4 space-y-4">
      <label className="inline-block cursor-pointer bg-emerald-700 text-white rounded px-4 py-2 hover:bg-emerald-800">
        {uploading ? "Uploading..." : "Upload photos"}
        <input type="file" multiple accept={ACCEPT} hidden onChange={upload} />
      </label>

      {errors.length > 0 && (
        <ul className="text-sm text-red-700 bg-red-50 rounded p-3 space-y-1">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {photos.length === 0 && <p className="text-stone-500">No photos yet.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {photos.map((photo) => (
          <figure key={photo.id} className="bg-white rounded overflow-hidden shadow-sm">
            <img
              src={photoUrl(photo)}
              alt=""
              loading="lazy"
              className="aspect-square w-full object-cover bg-stone-200"
            />
            <figcaption className="px-2 py-1 text-xs text-stone-500 truncate">
              {takenDate(photo) ?? "No date"}
              {photo.camera && ` · ${photo.camera}`}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
