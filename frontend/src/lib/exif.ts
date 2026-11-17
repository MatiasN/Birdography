/**
 * Just enough EXIF reading in the browser to tell whether a RAW and a JPEG are the same shot (plan 0008 D12),
 * before they are uploaded together: the capture time, its sub-second part, and the camera's Make and Model.
 *
 * Reads only the parts of the files it needs (a few kilobytes), through `Blob.slice`, so a 70 MB RAW isn't loaded
 * into memory. Understands JPEG (APP1 Exif), the TIFF-based RAWs (NEF, NRW, CR2, ARW, DNG, PEF, ORF, RW2), Canon's
 * CR3 (ISO base media, with TIFF blocks in its CMT1/CMT2 boxes) and Fujifilm's RAF (whose embedded JPEG carries
 * the EXIF). Anything else, or a file it can't make sense of, gives `null`: "can't tell", never an error.
 */

export type Shot = {
  /** "2025:04:27 17:57:05", as EXIF writes it; null when the file has no capture time. */
  taken: string | null;
  subsec: string | null;
  make: string | null;
  model: string | null;
};

const TAG = {
  make: 0x010f,
  model: 0x0110,
  exifIfd: 0x8769,
  dateTimeOriginal: 0x9003,
  createDate: 0x9004,
  subsecOriginal: 0x9291,
} as const;
const ASCII = 2;
const LONG = 4;
/** The UUID of the CR3 box that holds the CMT1 (IFD0) and CMT2 (Exif) TIFF blocks. */
const CANON_UUID = "85c0b687820f11e08111f4ce462b6a48";
const CHUNK = 64 * 1024;

/** Random access to a file, in cached 64 KB chunks, so a pointer far into it costs one more slice. */
class Source {
  private chunks = new Map<number, Promise<Uint8Array>>();

  constructor(private readonly file: Blob) {}

  get size() {
    return this.file.size;
  }

  private chunk(index: number) {
    let chunk = this.chunks.get(index);
    if (!chunk) {
      chunk = this.file
        .slice(index * CHUNK, (index + 1) * CHUNK)
        .arrayBuffer()
        .then((buffer) => new Uint8Array(buffer));
      this.chunks.set(index, chunk);
    }
    return chunk;
  }

  /** `length` bytes at `offset`; shorter (or empty) where the file ends. */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.size);
    if (offset < 0 || offset >= end) return new Uint8Array();
    const out = new Uint8Array(end - offset);
    for (let index = Math.floor(offset / CHUNK); index * CHUNK < end; index++) {
      const chunk = await this.chunk(index);
      const start = index * CHUNK;
      const from = Math.max(offset, start);
      out.set(chunk.subarray(from - start, Math.min(end, start + CHUNK) - start), from - offset);
    }
    return out;
  }
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** A TIFF structure starting at `base` in the source: its byte order and IFD reading. */
class Tiff {
  private constructor(
    private readonly source: Source,
    private readonly base: number,
    private readonly little: boolean,
  ) {}

  static async at(source: Source, base: number): Promise<Tiff | null> {
    const order = text(await source.bytes(base, 2));
    if (order !== "II" && order !== "MM") return null;
    return new Tiff(source, base, order === "II");
  }

  private async number(offset: number, size: 2 | 4): Promise<number | null> {
    const bytes = await this.source.bytes(this.base + offset, size);
    if (bytes.length < size) return null;
    const view = new DataView(bytes.buffer);
    return size === 2 ? view.getUint16(0, this.little) : view.getUint32(0, this.little);
  }

  /** The offset of IFD0, from the header. ORF ("IIRO") and RW2 ("IIU\0") use their own magic numbers there. */
  firstIfd() {
    return this.number(4, 4);
  }

  /** The tags of the IFD at `offset` we care about: ASCII values as text, LONGs (the Exif IFD pointer) as numbers. */
  async ifd(offset: number): Promise<Map<number, string | number>> {
    const tags = new Map<number, string | number>();
    const count = await this.number(offset, 2);
    if (count === null || count > 1000) return tags; // not an IFD
    const wanted = new Set<number>(Object.values(TAG));
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      const tag = await this.number(entry, 2);
      const type = await this.number(entry + 2, 2);
      const length = await this.number(entry + 4, 4);
      if (tag === null || type === null || length === null) break;
      if (!wanted.has(tag)) continue;
      if (type === LONG) {
        const value = await this.number(entry + 8, 4);
        if (value !== null) tags.set(tag, value);
      } else if (type === ASCII && length > 0 && length < 256) {
        const at = length <= 4 ? entry + 8 : await this.number(entry + 8, 4);
        if (at === null) continue;
        const value = text(await this.source.bytes(this.base + at, length))
          .replace(/\0.*$/s, "")
          .trim();
        if (value) tags.set(tag, value);
      }
    }
    return tags;
  }
}

type Found = Partial<Record<keyof Shot, string>>;

const ascii = (tags: Map<number, string | number>, tag: number) => {
  const value = tags.get(tag);
  return typeof value === "string" ? value : undefined;
};

/** Make and Model from an IFD0, and the date from the Exif IFD it points at (or from `exifAt`, as in CR3). */
async function readTiff(source: Source, base: number, exifBase?: number): Promise<Found | null> {
  const tiff = await Tiff.at(source, base);
  const first = tiff && (await tiff.firstIfd());
  if (!tiff || first === null) return null;
  const ifd0 = await tiff.ifd(first);
  const found: Found = { make: ascii(ifd0, TAG.make), model: ascii(ifd0, TAG.model) };
  let exif: Map<number, string | number> | null = null;
  if (exifBase !== undefined) {
    const exifTiff = await Tiff.at(source, exifBase);
    const at = exifTiff && (await exifTiff.firstIfd());
    exif = exifTiff && at !== null ? await exifTiff.ifd(at) : null;
  } else {
    const pointer = ifd0.get(TAG.exifIfd);
    exif = typeof pointer === "number" ? await tiff.ifd(pointer) : null;
  }
  if (exif) {
    found.taken = ascii(exif, TAG.dateTimeOriginal) ?? ascii(exif, TAG.createDate);
    found.subsec = ascii(exif, TAG.subsecOriginal);
  }
  return found;
}

/** The TIFF inside a JPEG's APP1 "Exif" segment. */
async function readJpeg(source: Source, start: number): Promise<Found | null> {
  let at = start + 2; // after SOI
  while (at + 4 <= source.size) {
    const marker = await source.bytes(at, 4);
    if (marker[0] !== 0xff || marker[1] === 0xda || marker[1] === 0xd9) return null; // not a marker, or the image
    const length = (marker[2] << 8) | marker[3];
    if (marker[1] === 0xe1 && text(await source.bytes(at + 4, 6)) === "Exif\0\0") return readTiff(source, at + 10);
    at += 2 + length;
  }
  return null;
}

/** Boxes of an ISO base media file inside [start, end): type and where its content is. */
async function boxes(source: Source, start: number, end: number) {
  const found: { type: string; start: number; end: number }[] = [];
  for (let at = start; at + 8 <= end;) {
    const head = await source.bytes(at, 8);
    const size = new DataView(head.buffer).getUint32(0);
    if (size < 8) break; // 0 (to the end) and 1 (64-bit) don't occur before the metadata we need
    found.push({ type: text(head.subarray(4, 8)), start: at + 8, end: Math.min(at + size, end) });
    at += size;
  }
  return found;
}

async function readCr3(source: Source): Promise<Found | null> {
  const moov = (await boxes(source, 0, source.size)).find((box) => box.type === "moov");
  for (const box of moov ? await boxes(source, moov.start, moov.end) : []) {
    if (box.type !== "uuid") continue;
    const uuid = [...(await source.bytes(box.start, 16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (uuid !== CANON_UUID) continue;
    const inner = await boxes(source, box.start + 16, box.end);
    const cmt1 = inner.find((b) => b.type === "CMT1");
    const cmt2 = inner.find((b) => b.type === "CMT2");
    return cmt1 ? readTiff(source, cmt1.start, cmt2?.start) : null;
  }
  return null;
}

/** What a file says about when and with what it was taken; null when its format isn't one this reads. */
export async function readShot(file: Blob): Promise<Shot | null> {
  const source = new Source(file);
  try {
    const head = await source.bytes(0, 16);
    let found: Found | null = null;
    if (head[0] === 0xff && head[1] === 0xd8) found = await readJpeg(source, 0);
    else if (text(head.subarray(4, 12)) === "ftypcrx ") found = await readCr3(source);
    else if (text(head.subarray(0, 15)) === "FUJIFILMCCD-RAW") {
      const offset = new DataView((await source.bytes(84, 4)).buffer).getUint32(0);
      found = await readJpeg(source, offset);
    } else found = await readTiff(source, 0);
    if (!found) return null;
    return {
      taken: found.taken ?? null,
      subsec: found.subsec ?? null,
      make: found.make ?? null,
      model: found.model ?? null,
    };
  } catch {
    return null; // a truncated or odd file: can't tell
  }
}

/** The outcome of comparing the two files of a pair. */
export type PairCheck =
  | { state: "same" }
  /** Probably not the same shot: the upload waits until the user keeps the pair or separates it. */
  | { state: "different"; message: string }
  /** Nothing to compare (a format this doesn't read, or no date): said, but the pair goes ahead. */
  | { state: "unknown"; message: string };

const differs = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() !== b.trim().toLowerCase();
const camera = (shot: Shot) => [shot.make, shot.model].filter(Boolean).join(" ").trim();
const time = (taken: string) => taken.slice(11, 19);

/** The browser's version of the server's `exif.pair_warning`, with the same wording. */
export function comparePair(raw: Shot | null, jpeg: Shot | null): PairCheck {
  if (!raw || !jpeg) {
    const which = raw ? "JPEG" : "RAW";
    return {
      state: "unknown",
      message: `Couldn't check that the JPEG belongs to this RAW: the ${which} can't be read here`,
    };
  }
  if (!raw.taken || !jpeg.taken) {
    const which = raw.taken ? "JPEG" : "RAW";
    return { state: "unknown", message: `Couldn't check that the JPEG belongs to this RAW: the ${which} has no date` };
  }
  if (raw.taken.slice(0, 19) !== jpeg.taken.slice(0, 19)) {
    return {
      state: "different",
      message: `The JPEG may not belong to this RAW: taken at ${time(jpeg.taken)}, the RAW at ${time(raw.taken)}`,
    };
  }
  if (raw.subsec && jpeg.subsec && raw.subsec !== jpeg.subsec) {
    return {
      state: "different",
      message: "The JPEG may not belong to this RAW: taken the same second, but not at the same instant",
    };
  }
  // Make and Model each count only when both files have them: a JPEG missing one of them isn't another camera.
  if (differs(raw.make, jpeg.make) || differs(raw.model, jpeg.model)) {
    return {
      state: "different",
      message: `The JPEG may not belong to this RAW: taken with a ${camera(jpeg)}, the RAW with a ${camera(raw)}`,
    };
  }
  return { state: "same" };
}

/** Read both files and compare them. */
export async function checkPair(raw: Blob, jpeg: Blob): Promise<PairCheck> {
  const [rawShot, jpegShot] = await Promise.all([readShot(raw), readShot(jpeg)]);
  return comparePair(rawShot, jpegShot);
}
