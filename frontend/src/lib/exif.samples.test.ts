import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readShot } from "@/lib/exif";

const RAW = "../backend/tests/fixtures/raw";
const sample = (name: string) => new File([readFileSync(`${RAW}/${name}`)], name);

describe("readShot on real camera files", () => {
  it.each([
    ["nikon_z5_2.nef", { taken: "2025:04:27 17:57:05", subsec: "66", make: "NIKON CORPORATION", model: "NIKON Z5_2" }],
    [
      "canon_eos_r6_mark_iii.cr3",
      { taken: "2026:01:22 15:41:52", subsec: "26", make: "Canon", model: "Canon EOS R6 Mark III" },
    ],
    ["sony_ilce_7s.arw", { taken: "2017:07:13 16:58:28", subsec: null, make: "SONY", model: "ILCE-7S" }],
    [
      "canon_eos_5d_mark_iii_adobe.dng",
      { taken: "2017:01:05 13:53:29", subsec: "75", make: "Canon", model: "Canon EOS 5D Mark III" },
    ],
  ])("reads %s as ExifTool does", async (name, expected) => {
    expect(await readShot(sample(name))).toEqual(expected);
  });
});
