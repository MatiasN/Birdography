# RAW test fixtures

Real camera files from [raw.pixls.us](https://raw.pixls.us/), all dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Used by `tests/test_raw_samples.py`; their
expected values are in `RAW_SAMPLES` in `tests/conftest.py`.

| File | Camera | Original | Shrunk | Embedded preview | Source |
|------|--------|---------:|-------:|------------------|--------|
| `nikon_z5_2.nef` | Nikon Z5_2 | 6 174 720 | 2 166 784 | 3984×2656 | [7737](https://raw.pixls.us/getfile.php/7737/nice/Nikon%20-%20Z5_2%20-%208bit%20compressed%20(3:2).NEF) |
| `canon_eos_r6_mark_iii.cr3` | Canon EOS R6 Mark III | 7 065 300 | 1 919 053 | 4320×2880 | [8964](https://raw.pixls.us/getfile.php/8964/nice/Canon%20-%20EOS%20R6%20Mark%20III%20-%20CRAW%20(3:2).CR3) |
| `sony_ilce_7s.arw` | Sony ILCE-7S | 6 160 384 | 881 152 | 1616×1080 | [1582](https://raw.pixls.us/getfile.php/1582/nice/Sony%20-%20ILCE-7S%20-%2014bit%2014bit%20compressed%20(3:2).ARW) |
| `canon_eos_5d_mark_iii_adobe.dng` | Canon EOS 5D Mark III via Adobe DNG Converter | 2 484 836 | 828 884 | 3960×2640 | [1033](https://raw.pixls.us/getfile.php/1033/nice/Adobe%20DNG%20Converter%20-%20Canon%20EOS%205D%20Mark%20III%20-%20Lossy%20JPEG%20compression,%20rgb%20(3:2).DNG) |

## Shrunk, not original

The files are cut down to what Birdography reads: headers, all metadata and every embedded JPEG. The sensor
data is dropped. That is most of each file, and nothing here decodes it. Raw converters will reject these
files, but ExifTool still reads exactly the same tags as from the originals and reports no new warnings.

- **NEF, ARW, DNG** (TIFF-based): cut where the first sensor strip or tile starts. In all three, every other
  block comes before that point.
- **CR3**: the camera JPEG is the first sample of `mdat`, followed by two sensor tracks and the CTMD metadata
  track. A plain cut after the JPEG would lose the 135 CTMD tags (white balance, AF, bracketing…), so the
  CTMD sample is moved right behind the JPEG, and its chunk offset and the `mdat` size are patched. The sensor
  tracks are left pointing past the end of the file.

## Regenerating

```bash
cd backend && python tests/fixtures/raw/shrink.py
```

The script downloads the originals, checks them against the sha256 published by raw.pixls.us, shrinks them,
and verifies the tag equality described above before writing anything. Its output is deterministic: running
it again must leave `git status` clean. To add a sample, add its URL and sha256 to `SOURCES` in `shrink.py`
and an entry to `RAW_SAMPLES`.
