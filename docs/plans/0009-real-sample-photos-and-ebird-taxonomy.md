# Plan 0009: Real sample photos, and the eBird taxonomy

Status: done (2026-11-19) · Roadmap: [Phase 2](../../ROADMAP.md#phase-2-locations--species) · Date: 2026-11-19

Three parts:

- **A. Dev seeder with real photos:** `devtools.seed` makes its photos from the 14 bird photos in `docs/samples/`
  instead of gradients, each tagged with the species it actually shows.
- **B. Built-in species list** (Phase 2, first item): the eBird taxonomy loaded with English, Portuguese and
  scientific names, eBird code, taxonomic order, family and order.
- **C. Screenshots and README:** `scripts/screenshots.sh` retaken on the seeded real photos, with eBird's names.

They are built in the order **A → B → C** (D1), not the order above. The screenshots come from the dev stack, so
they need the real photos first, and taking them after B means they show eBird's names and the full species search.

## 1. Current state

- **Seeder** (`backend/devtools/seed.py`): `jpeg()` draws a gradient in the hotspot's colours with `#n` and
  "Spot n" on it. `SPECIES` lists 18 Portuguese birds with hand-typed names; `pick_species` gives 8% of photos no
  species, 12% two and the rest one, chosen at random with no link to the image. `devtools/` is bind-mounted into
  the dev backend by `compose.dev.yml` and is not copied into the production image (the Dockerfile copies `app/` only).
- **Screenshots** (`scripts/screenshots.sh` + `screenshots.mjs`): 9 WebPs. The Upload shots also make gradient
  JPEGs with Pillow for the RAW+JPEG pair and the "fresh" uploads. The Catalogue shot opens whichever tile is second.
- **Species:** `species` already has every column the taxonomy needs (`ebird_code` String(16) unique,
  `taxon_order` Numeric(10,2), `family`, `order_name`, `name_en`, `name_pt`), from migration 0009. Nothing fills
  `ebird_code`, `taxon_order` or `order_name` yet. `GET /species?q=` matches `%q%` against the three names (accent-
  and case-insensitive), sorted by scientific name, 50 at a time. The Catalogue's species filter and the Upload
  picker both use it.
- **Samples** (`docs/samples/`, untracked, 5.4 MB): 14 JPEGs, 1920 px on the long edge, no EXIF at all. The names
  (`<user>-<bird>-<id>_1920.jpg`) are Pixabay's download pattern.

### The photos, identified

The file names say what kind of bird each photo shows, and four needed a look at the photo itself. The names below are
eBird's (2026 taxonomy, checked against the API on 2026-11-19), in the locales D10 recommends:

| File | eBird code | English (en_UK) | Portuguese (pt_PT) | Scientific |
|---|---|---|---|---|
| arminep-grey-heron | `graher1` | Grey Heron | Garça-real | *Ardea cinerea* |
| bernhardjaeck-cormorant | `grecor` | Great Cormorant | Corvo-marinho-comum | *Phalacrocorax carbo* |
| dienaturreise-wren | `winwre4` | Eurasian Wren | Carriça | *Nannus troglodytes* |
| erik_karits-european-crested-tit | `cretit2` | Crested Tit | Chapim-de-poupa | *Lophophanes cristatus* |
| gruendercoach-robin, netti_nu_nu-robin | `eurrob1` | European Robin | Pisco-de-peito-ruivo | *Erithacus rubecula* |
| juergen57bs-chaffinch | `comcha` | Common Chaffinch | Tentilhão | *Fringilla coelebs* |
| lancier-swan | `whoswa` | Whooper Swan | Cisne-bravo | *Cygnus cygnus* |
| max_gindele_photography-blue-tit | `blutit` | Eurasian Blue Tit | Chapim-azul | *Cyanistes caeruleus* |
| schauhi-sparrow | `houspa` | House Sparrow | Pardal-do-telhado | *Passer domesticus* |
| sharkolot-long-tailed-tit | `lottit1` | Long-tailed Tit | Chapim-rabilongo | *Aegithalos caudatus* |
| taligar-kingfisher | `comkin1` | Common Kingfisher | Guarda-rios | *Alcedo atthis* |
| tim_bastian-stork | `whisto1` | White Stork | Cegonha-branca | *Ciconia ciconia* |
| wildfaces-egyptian-vulture | `egyvul1` | Egyptian Vulture | Britango | *Neophron percnopterus* |

Notes: the "swan" is a **Whooper Swan**, not a Mute Swan (yellow wedge on the bill); the cormorant is a Great
Cormorant; the sparrow is a male House Sparrow; the stork is a White Stork. eBird calls the European Crested Tit
just "Crested Tit". eBird puts the wren in *Nannus*, not *Troglodytes*. The 14 photos cover 13 species, with two robins.

## 2. Part A: seeder with real photos

- **Samples move** to `backend/devtools/samples/` (D2). That folder is already mounted in the dev backend, CI's
  backend tests can read it, and the production image doesn't include it. A `CREDITS.md` there lists each file's
  photographer, Pixabay ID and link, and the licence (D3).
- **`SAMPLES`** replaces `SPECIES`: file name → (eBird code, scientific, en_UK, pt_PT, family, order, taxon order),
  the table above. `ensure_species` creates them with their eBird code, so when B's import runs later it matches
  them by code and nothing is duplicated. If the taxonomy is already loaded, it finds them and creates nothing.
- **Photo n** picks a sample from its own seeded stream and is tagged with **that sample's species**. 8% stay
  untagged ("to identify"). No photo gets two species, because none of the samples shows two (D5).
- **Variation** so 300 photos aren't 14 copies: a random crop keeping 75–100% of each side, mirrored half the time,
  then scaled so the long edge is `--image-px`. The crop keeps the sample's shape, so the stork and the blue tit stay
  portrait (D7). All of it comes from the photo's seed, so photo 137 stays the same image every run.
- **No text on the image** (D6). The number stays in the file name (`dev-00137.jpg`) and the EXIF
  `ImageDescription`, which keeps a bad photo traceable. The EXIF (GPS, time, camera, lens, settings) is written
  as it is today.
- **`scripts/dev.sh`:** unchanged apart from the help text. `seed --replace` swaps an existing dev account to the new photos.

## 3. Part B: built-in species list from eBird

### 3.1 Where the data comes from

`GET https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&locale=<l>`, one request each for `en_UK` and `pt_PT`
(about 6 MB of JSON and 18,631 entries each; the scientific name, code, order and family come with every locale).
**No API key is needed** (checked 2026-11-19). It is fetched when the import runs and is not committed (D8). For
installs without internet access, `--file` takes saved copies.

Of the 18,631 entries, 11,201 are `category: species`, and only those are loaded (D9). The rest are subspecies
groups (`issf`, 4,542), `slash`, `spuh`, `hybrid`, `form`, `intergrade` and `domestic`, which aren't species you
tag a photo with. Phase 4's eBird CSV import can map those to their species through `reportAs`.

All values fit the existing columns: the longest scientific name is 71 characters, the longest pt_PT name 94, the
longest code 8, and `taxonOrder` goes up to 36,127 with no fractions. **No migration needed.**

pt_PT has a name for every species. Only 100 are the same as the English one, and those are names like Emu, Dodo
or Kagu, which Portuguese uses as they are, so nothing needs treating as missing.

### 3.2 The import

`python -m app.cli import-taxonomy [--file en_UK.json --file pt_PT.json]`, in `app/taxonomy.py`, using
`urllib.request` (no new dependency). In one transaction:

| Case | What happens |
|---|---|
| eBird code already on a row | Names, scientific name, family, order and taxon order updated to eBird's |
| No code match, same scientific name (any case) | Row adopted: code and all fields filled in, **names replaced by eBird's** (D11) |
| No match | New row |
| Row in the trash | Updated like the others but stays in the trash |
| Species added by hand, not in eBird | Left untouched; listed in the output, so a typo (e.g. *Troglodytes troglodytes*) can be fixed by hand |
| Code on a row but no longer in the taxonomy (lumped or split) | Kept, reported |
| A renamed species whose new scientific name another row already has | That one is skipped and reported; the rest goes ahead |

Output: taxonomy version (from `/ref/taxonomy/versions`), then counts of added, updated, adopted, left alone,
gone from eBird and skipped. Running it again with the same taxonomy changes nothing. eBird publishes a new
taxonomy each autumn, and running the command again updates to it.

### 3.3 When it runs (D12)

- **Dev:** `scripts/dev.sh up` runs `import-taxonomy --if-missing` **before** the seed. It skips the import when
  the table already holds at least as many eBird-coded species as the taxonomy has, so the seeder's 13 species
  don't count as "loaded". The download is cached under `.dev/taxonomy/`, so `reset` doesn't fetch it again.
- **Installs:** one step in the README quick start and in CONTRIBUTING's upgrade notes. It doesn't run on its own
  at backend start, so the app never calls out unless the admin asks it to.

### 3.4 Search with 11,000 species (D14, D15)

The search worked for 20 species but needs ranking for 11,000, where "robin" matches dozens:

- **Ranking:** species you have photographed first, then names *starting with* the query (any of the three names,
  or any word in them), then taxonomic order. With this, "robin" puts European Robin first for this catalogue,
  and "garç" puts Garça-real near the top.
- **Hyphens:** treated as spaces on both sides, so "garca real" finds Garça-real.
- **Catalogue filter:** `GET /species?photographed=true` returns only species with at least one of your photos.
  Filtering by a species you have never photographed always gives an empty grid. The Upload picker keeps the
  full list.
- **List order without `q`:** taxonomic order (field-guide order), then scientific name for hand-added species
  without one.
- "Add as a new species" stays in the picker, for birds eBird doesn't have yet or for hand-added names.

## 4. Part C: screenshots and README

- `screenshots.sh`: the Upload shots' JPEGs come from the samples instead of `linear_gradient`. The JPEG half of
  the held RAW+JPEG pair, and the "fresh" uploads, use the kingfisher, which matches the "Common Kingfisher" the
  script picks for the batch.
- `screenshots.mjs`: the Catalogue shots open a chosen photo (the first tile showing Common Kingfisher) instead of
  `nth(1)`, so the hero image doesn't depend on which sample landed in the second tile.
- All 9 WebPs retaken (light, dark, phone), after A and B, on a `seed --replace`d account.
- README: the feature tour mentions the built-in eBird species list. Credits: a line for the sample photos
  (pointing to `CREDITS.md`) and the eBird/Clements taxonomy citation that eBird's terms ask for. The quick start
  adds `import-taxonomy`.
- The mockups in `docs/design/` stay frozen (plan 0008 D13) and are not re-rendered.
- ROADMAP: the built-in species list item ticked, with a link to this plan.

## 5. Tests (the 100% gate stays)

- **Seeder:** every seeded photo's species is the one its sample shows. Untagged photos are about 8%, and none have
  two species. The crop and mirror depend only on the seed. Every photo is a different file. Portrait samples stay
  portrait. EXIF reads back as before. `test_species_per_photo_…` is rewritten for the one-species rule.
- **Import:** a small hand-made fixture of eBird entries in both locales, covering a species, an `issf`, a `spuh`,
  a hybrid, a renamed species and a lumped one. The network call is monkeypatched, so tests never depend on eBird. Every case in §3.2's table, a second run changing nothing, `--file`, and an HTTP error giving a clear
  message.
- **API:** the ranking order, `photographed=true`, hyphen-insensitive matching.
- **Frontend:** the Catalogue's filter sends `photographed=true` and the Upload picker doesn't.
- **dev.sh:** ShellCheck. Manual run of `reset` → `up` covering seed, import and cache reuse.

## 6. Pre-implementation checks

1. **eBird API terms of use:** storing the taxonomy locally and the exact attribution text for the README.
2. **Search speed:** `EXPLAIN ANALYZE` of the ranked search over 11,201 species with a 300-photo catalogue, per
   keystroke. If it is much over ~30 ms, a `pg_trgm` index on a normalised name column (would need a migration).
3. **The NEF's embedded preview** in the Upload screenshot. If it shows a test chart rather than a bird, it may look
   odd next to the kingfisher; decide then whether that matters.
4. **Import time** in the dev stack (two 6 MB downloads and 11,201 upserts), so `up` doesn't grow by much.

## 7. Implementation order

One commit (and PR) per step, CI green each time:

1. **Part A:** samples moved with `CREDITS.md`, seeder on real photos, tests.
2. **Part B, import:** `app/taxonomy.py`, `import-taxonomy` command, `dev.sh up` step and cache, tests.
3. **Part B, search:** ranking, hyphens, `photographed=true`, Catalogue filter; ROADMAP item ticked.
4. **Part C:** screenshot scripts, the 9 WebPs, README and CONTRIBUTING.

## 8. Out of scope

- The Species page and the Near me tab (later Phase 2 items). This plan only gives them the data.
- Subspecies groups and other non-species categories (D9).
- Family common names in English and Portuguese (`familyComName`), for the Species page or Phase 3's stats.
  `family` holds the scientific family name for now.
- Updating the taxonomy on a schedule.
- Merging a hand-added species into an eBird one from the UI.

## 9. Decisions (confirmed 2026-11-19)

| # | Decision |
|---|---|
| D1 | Order A → B → C. |
| D2 | Samples move to `backend/devtools/samples/`. |
| D3 | Credits in `backend/devtools/samples/CREDITS.md` (photographer, Pixabay ID, link, licence); the README says the photo credits are there. |
| D4 | eBird's names. Where a photo can't be told apart to the species, the one most likely in Portugal is used. None of the 14 needed that: the swan's bill pattern makes it a Whooper Swan even though Mute Swan is the swan usually seen in Portugal. |
| D5 | No photos with two species in the seed; 8% untagged. |
| D6 | No `#n` on the image; the number stays in the file name and EXIF. |
| D7 | Random crop of 75–100% of each side plus a mirror, keeping portrait or landscape. |
| D7a | The seed's default goes from 300 photos to **100** (`--photos`, `SEED_PHOTOS`, docs). |
| D8 | No bundled snapshot (2026-11-19): eBird's terms don't clearly allow redistributing the taxonomy (its Help Center: downloaded data "cannot be redistributed in its original format"), so the import downloads it from the eBird API when it runs (§3.1). This needs internet the first time; a folder of saved downloads (`--dir`) covers installs without it. |
| D9 | `category: species` only (11,201). |
| D10 | `en_UK` and `pt_PT`. |
| D11 | Rows matched by scientific name take eBird's names. Hand-added species not in eBird are left as they are. |
| D11a | **New:** merging a hand-added species into an eBird one (when you later find out which species it was). Its photos move to the eBird species, keeping their position in each photo's list and dropping duplicates, then the hand-added one goes to the trash. An API endpoint `POST /species/{id}/merge-into/{target}` plus a CLI command; UI placement decided in step 3. |
| D12 | CLI command run by `dev.sh up`, plus a README step; not automatic at backend start. How it gets its data depends on D8. |
| D13 | Scientific family name in `family`, order in `order_name`. |
| D14 | Ranking: your species first, then prefix matches, then taxonomic order; hyphens as spaces; the Catalogue filter offers only species you have photographed. |
| D15 | Default list order: taxonomic order, then scientific name. |
| D16 | **New:** a profile setting for the main name language (English, Portuguese or scientific), used everywhere a species name is shown or picked; the other two stay as the secondary line. Stored per user (`users.species_name_language`, a migration), default English. Built with step 3. |

## 10. Implementation notes (2026-11-19)

- **Step 1, seeder** (`355582b`): as §2. Every seed species checked against the downloaded taxonomy (codes, both
  names, family, order, taxonomic order): all 13 match. About 0.05 s to make a photo, 210 KB at 1600 px.
- **Step 2, import** (`1841101`): `app/taxonomy.py` and `import-taxonomy [--dir DIR] [--if-missing]`, with stdlib
  `urllib` (no new dependency). `--dir` covers both the dev cache and offline installs (§3.1's `--file`); the dev
  stack mounts `.dev/taxonomy` at `/taxonomy`, created by `dev.sh` so it belongs to the user. The import runs
  *before* the seed, and `--if-missing` checks that every species of the taxonomy has its code in the table (the
  seed's 13 don't count as loaded). First run in the dev stack: 11,188 added, the seed's 13 unchanged, about 15 s
  including the two downloads; later `up`s skip it. A code eBird changed for the same scientific name is followed.
- **Step 3, search, language and merge** (`8028d23`):
  - Pre-check 2: the ranked search over 11,201 species answers in 25–40 ms per request through the API, so no
    index. Escapes `%` and `_` in the text.
  - D16: `users.species_name_language` (migration 0014, check constraint), `PATCH /auth/me`, a *Species names*
    card on the profile with an example. `speciesName`/`speciesOtherNames` take the language; components get it
    from `useSpeciesNames()`, fed by a context in `Layout`. A species with no common names no longer repeats the
    scientific name on its second line.
  - D11a: `POST /species/{id}/merge-into/{target}` and `merge-species`; only species without an eBird code can be
    merged away. The photo details show a merge button next to hand-added species (photos now carry
    `ebird_code`), opening a picker without "Add as new".
- **Step 4, screenshots:** the Upload tab's JPEGs are the kingfisher sample. The Catalogue and phone photo shots open
  the first tile with a species rather than a fixed one (the first Kingfisher is below the fold with seed 42).
  Pre-check 3: the held pair shows the camera JPEG's thumbnail, so the NEF's own preview never appears.
- Tests: backend 326 (was 300), frontend 261 (was 252), both at 100%.
