import type { Shot } from "@/lib/exif";

// Small files in each format EXIF lives in, for tests: TIFF blocks, JPEGs, CR3 boxes, RAF.

export type Entry = { tag: number; type: number; value: string | number; count?: number };
export const ASCII = 2;
export const SHORT = 3;
export const LONG = 4;
export const ascii = (tag: number, value: string): Entry => ({ tag, type: ASCII, value });

/** A TIFF block: IFD0 (with a pointer to the Exif IFD when `exif` is given), then the Exif IFD, then the strings. */
export function tiff({ little = true, magic = 42, ifd0 = [] as Entry[], exif = null as Entry[] | null } = {}) {
  const buffer = new ArrayBuffer(4096);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, magic, little);
  view.setUint32(4, 8, little);
  let data = 2048;
  const writeIfd = (at: number, entries: Entry[]) => {
    view.setUint16(at, entries.length, little);
    entries.forEach((entry, i) => {
      const e = at + 2 + i * 12;
      view.setUint16(e, entry.tag, little);
      view.setUint16(e + 2, entry.type, little);
      if (typeof entry.value === "number") {
        view.setUint32(e + 4, entry.count ?? 1, little);
        view.setUint32(e + 8, entry.value, little);
        return;
      }
      const raw = [...new TextEncoder().encode(entry.value), 0];
      view.setUint32(e + 4, entry.count ?? raw.length, little);
      if (raw.length <= 4) bytes.set(raw, e + 8);
      else {
        view.setUint32(e + 8, data, little);
        bytes.set(raw, data);
        data += raw.length;
      }
    });
    return at + 2 + entries.length * 12 + 4;
  };
  const exifAt = 512;
  writeIfd(8, exif ? [...ifd0, { tag: 0x8769, type: LONG, value: exifAt }] : ifd0);
  if (exif) writeIfd(exifAt, exif);
  return bytes.slice(0, data);
}

export const IFD0 = [ascii(0x010f, "NIKON CORPORATION"), ascii(0x0110, "NIKON Z 8")];
export const EXIF = [ascii(0x9003, "2026:05:14 08:42:10"), ascii(0x9291, "37")];
export const SHOT: Shot = { taken: "2026:05:14 08:42:10", subsec: "37", make: "NIKON CORPORATION", model: "NIKON Z 8" };

/** A JPEG: SOI, the given segments, then the start of the image. */
export function jpeg(...segments: { marker: number; body: Uint8Array }[]) {
  const parts: number[] = [0xff, 0xd8];
  for (const { marker, body } of segments)
    parts.push(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  parts.push(0xff, 0xda, 0, 2);
  return new Uint8Array(parts);
}
export const exifSegment = (block: Uint8Array) => ({
  marker: 0xe1,
  body: new Uint8Array([...new TextEncoder().encode("Exif\0\0"), ...block]),
});

/** An ISO base media box. */
export function box(type: string, ...content: Uint8Array[]) {
  const length = 8 + content.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(length);
  new DataView(out.buffer).setUint32(0, length);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const c of content) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
export const hex = (value: string) => new Uint8Array(value.match(/../g)!.map((b) => parseInt(b, 16)));
export const CANON = hex("85c0b687820f11e08111f4ce462b6a48");
export const ftyp = () => box("ftyp", new TextEncoder().encode("crx \0\0\0\x01"));

/** A Fujifilm RAF: its magic, the embedded JPEG's offset at byte 84, then that JPEG. */
export function raf(embedded: Uint8Array) {
  const out = new Uint8Array(100 + embedded.length);
  out.set(new TextEncoder().encode("FUJIFILMCCD-RAW 0201"));
  new DataView(out.buffer).setUint32(84, 100);
  out.set(embedded, 100);
  return out;
}

export const file = (bytes: Uint8Array, name = "x", type = "") => new File([new Uint8Array(bytes)], name, { type });

/** A JPEG as a camera writes it next to its RAW: its date and model in EXIF. */
export const cameraJpeg = (taken: string, model = "NIKON Z5_2", subsec?: string) =>
  jpeg(
    exifSegment(
      tiff({
        ifd0: [ascii(0x010f, "NIKON CORPORATION"), ascii(0x0110, model)],
        exif: [ascii(0x9003, taken), ...(subsec ? [ascii(0x9291, subsec)] : [])],
      }),
    ),
  );
