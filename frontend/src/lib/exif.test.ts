import { describe, expect, it } from "vitest";
import { checkPair, comparePair, readShot, type Shot } from "@/lib/exif";
import {
  ASCII,
  ascii,
  box,
  CANON,
  EXIF,
  exifSegment,
  file,
  ftyp,
  hex,
  IFD0,
  jpeg,
  LONG,
  raf,
  SHORT,
  SHOT,
  tiff,
} from "@/test/exif";

describe("readShot", () => {
  it("reads a JPEG's Exif segment, past other segments", async () => {
    const app0 = { marker: 0xe0, body: new TextEncoder().encode("JFIF\0") };
    const xmp = { marker: 0xe1, body: new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0") };
    expect(await readShot(file(jpeg(app0, xmp, exifSegment(tiff({ ifd0: IFD0, exif: EXIF })))))).toEqual(SHOT);
  });

  it("knows a JPEG without EXIF, or with broken segments, can't tell", async () => {
    expect(await readShot(file(jpeg({ marker: 0xe0, body: new Uint8Array([1, 2]) })))).toBeNull();
    expect(await readShot(file(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0])))).toBeNull(); // not a marker
    expect(await readShot(file(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))).toBeNull(); // ends at once
    expect(await readShot(file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40])))).toBeNull(); // cut short
  });

  it("reads big-endian TIFF, other magic numbers (ORF, RW2) and short inline strings", async () => {
    const shot = await readShot(
      file(tiff({ little: false, magic: 0x4f52, ifd0: [ascii(0x010f, "OM"), ascii(0x0110, "OM-1")], exif: EXIF })),
    );
    expect(shot).toEqual({ ...SHOT, make: "OM", model: "OM-1" });
  });

  it("falls back to CreateDate, and leaves out what is missing", async () => {
    expect(await readShot(file(tiff({ ifd0: IFD0, exif: [ascii(0x9004, "2026:05:14 08:42:10")] })))).toEqual({
      ...SHOT,
      subsec: null,
    });
    expect(await readShot(file(tiff({ ifd0: IFD0 })))).toEqual({ ...SHOT, taken: null, subsec: null }); // no Exif IFD
    expect(await readShot(file(tiff()))).toEqual({ taken: null, subsec: null, make: null, model: null });
  });

  it("skips tags it doesn't need, odd types and sizes, and blank strings", async () => {
    const shot = await readShot(
      file(
        tiff({
          ifd0: [
            { tag: 0x0100, type: SHORT, value: 4000 }, // ImageWidth: not wanted
            { tag: 0x010f, type: SHORT, value: 1 }, // Make with a type that isn't ASCII
            { tag: 0x0110, type: ASCII, value: "", count: 0 }, // empty
            { tag: 0x8769, type: LONG, value: 3000 }, // an Exif IFD pointer past the end of the file
          ],
        }),
      ),
    );
    expect(shot).toEqual({ taken: null, subsec: null, make: null, model: null });
    const blank = await readShot(file(tiff({ ifd0: [ascii(0x010f, "   "), { ...ascii(0x0110, "Z 8"), count: 300 }] })));
    expect(blank).toEqual({ taken: null, subsec: null, make: null, model: null }); // blank, and a length too long
  });

  it("reads a Fujifilm RAF through its embedded JPEG", async () => {
    const shot = await readShot(
      file(raf(jpeg(exifSegment(tiff({ ifd0: [ascii(0x010f, "FUJIFILM"), ascii(0x0110, "X-T5")], exif: EXIF }))))),
    );
    expect(shot).toEqual({ ...SHOT, make: "FUJIFILM", model: "X-T5" });
  });

  it("reads a CR3's CMT1 and CMT2 boxes, past other boxes", async () => {
    const canon = box("uuid", CANON, box("CMT1", tiff({ ifd0: IFD0 })), box("CMT2", tiff({ ifd0: EXIF })));
    const other = box("uuid", hex("00112233445566778899aabbccddeeff"));
    const cr3 = new Uint8Array([...ftyp(), ...box("moov", box("mvhd"), other, canon)]);
    expect(await readShot(file(cr3))).toEqual(SHOT);
    // Without CMT2 there is no date; without CMT1, no metadata at all.
    const noDate = new Uint8Array([...ftyp(), ...box("moov", box("uuid", CANON, box("CMT1", tiff({ ifd0: IFD0 }))))]);
    expect(await readShot(file(noDate))).toEqual({ ...SHOT, taken: null, subsec: null });
    const badCmt2 = box("uuid", CANON, box("CMT1", tiff({ ifd0: IFD0 })), box("CMT2", new Uint8Array([1, 2])));
    expect(await readShot(file(new Uint8Array([...ftyp(), ...box("moov", badCmt2)])))).toEqual({
      ...SHOT,
      taken: null,
      subsec: null,
    });
    const empty = new Uint8Array([...ftyp(), ...box("moov", box("uuid", CANON, box("CMT3")))]);
    expect(await readShot(file(empty))).toBeNull();
  });

  it("can't tell from a CR3 without the boxes it needs", async () => {
    expect(await readShot(file(new Uint8Array([...ftyp(), ...box("mdat")])))).toBeNull(); // no moov
    expect(await readShot(file(new Uint8Array([...ftyp(), ...box("moov", box("trak"))])))).toBeNull(); // no Canon uuid
    const broken = new Uint8Array([...ftyp(), 0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76]); // a box claiming 4 bytes
    expect(await readShot(file(broken))).toBeNull();
    const badCmt = new Uint8Array([
      ...ftyp(),
      ...box("moov", box("uuid", CANON, box("CMT1", new Uint8Array([1, 2, 3])))),
    ]);
    expect(await readShot(file(badCmt))).toBeNull(); // CMT1 isn't a TIFF
  });

  it("can't tell from a file in no format it knows, or a broken one", async () => {
    expect(await readShot(file(new TextEncoder().encode("just some text, no image")))).toBeNull();
    expect(await readShot(file(new Uint8Array()))).toBeNull();
    expect(await readShot(file(new Uint8Array([0x49, 0x49, 42, 0])))).toBeNull(); // TIFF header without IFD offset
    const tooMany = tiff();
    new DataView(tooMany.buffer).setUint16(8, 5000, true); // an IFD count no real file has
    expect(await readShot(file(tooMany))).toEqual({ taken: null, subsec: null, make: null, model: null });
    const cut = tiff({ ifd0: IFD0 }).slice(0, 20); // the IFD's first entry is cut off
    expect(await readShot(file(cut))).toEqual({ taken: null, subsec: null, make: null, model: null });
    const pointerCut = tiff({ ifd0: [{ tag: 0x8769, type: LONG, value: 512 }] }).slice(0, 8 + 2 + 10); // mid-value
    expect(await readShot(file(pointerCut))).toEqual({ taken: null, subsec: null, make: null, model: null });
    const rafCut = new TextEncoder().encode("FUJIFILMCCD-RAW 0201"); // ends before the JPEG offset
    expect(await readShot(file(rafCut))).toBeNull();
  });

  it("reads values that straddle its 64 KB chunks", async () => {
    const padding = new Uint8Array(64 * 1024 - 20);
    const app = { marker: 0xe2, body: padding }; // pushes the Exif segment across the first chunk's end
    expect(await readShot(file(jpeg(app, exifSegment(tiff({ ifd0: IFD0, exif: EXIF })))))).toEqual(SHOT);
  });
});

const other = (changes: Partial<Shot>) => ({ ...SHOT, ...changes });

describe("comparePair", () => {
  it("finds the two files of a pair the same", () => {
    expect(comparePair(SHOT, { ...SHOT })).toEqual({ state: "same" });
    expect(comparePair(SHOT, other({ subsec: null, make: null, model: null }))).toEqual({ state: "same" });
    expect(comparePair(SHOT, other({ taken: "2026:05:14 08:42:10.37" }))).toEqual({ state: "same" });
    expect(comparePair(SHOT, other({ make: "nikon corporation" }))).toEqual({ state: "same" }); // case
    expect(comparePair(SHOT, other({ make: null }))).toEqual({ state: "same" }); // only the model to compare
    expect(comparePair(other({ model: null }), SHOT)).toEqual({ state: "same" });
  });

  it("says why they may be two shots", () => {
    expect(comparePair(SHOT, other({ taken: "2026:05:14 08:42:12" }))).toEqual({
      state: "different",
      message: "The JPEG may not belong to this RAW: taken at 08:42:12, the RAW at 08:42:10",
    });
    expect(comparePair(SHOT, other({ subsec: "38" }))).toEqual({
      state: "different",
      message: "The JPEG may not belong to this RAW: taken the same second, but not at the same instant",
    });
    expect(comparePair(SHOT, other({ make: "Canon", model: "Canon EOS R5" }))).toEqual({
      state: "different",
      message:
        "The JPEG may not belong to this RAW: taken with a Canon Canon EOS R5, the RAW with a NIKON CORPORATION NIKON Z 8",
    });
    expect(comparePair(SHOT, other({ model: "NIKON Z 9" })).state).toBe("different"); // same make, other body
    expect(comparePair(SHOT, other({ make: "Canon", model: null })).state).toBe("different"); // other make
  });

  it("says when it can't tell", () => {
    expect(comparePair(null, SHOT)).toEqual({
      state: "unknown",
      message: "Couldn't check that the JPEG belongs to this RAW: the RAW can't be read here",
    });
    expect(comparePair(SHOT, null).state).toBe("unknown");
    expect(comparePair(other({ taken: null }), SHOT)).toEqual({
      state: "unknown",
      message: "Couldn't check that the JPEG belongs to this RAW: the RAW has no date",
    });
    expect(comparePair(SHOT, other({ taken: null })).state).toBe("unknown");
  });

  it("reads and compares two files", async () => {
    const block = tiff({ ifd0: IFD0, exif: EXIF });
    expect(await checkPair(file(block), file(jpeg(exifSegment(block))))).toEqual({ state: "same" });
  });
});
