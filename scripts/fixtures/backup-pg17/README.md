# A backup from the PostGIS 17 image

`scripts/backup.sh --db-only` run on 2026-11-12 against `postgis/postgis:17-3.5`, the database image Birdography
used until November 2026, with schema revision 0012 and one account (`fixture@example.com`,
`fixture-password-123`), no photos. Its dump names the extensions that image installed into every database:
`postgis`, `postgis_topology`, `fuzzystrmatch` and `postgis_tiger_geocoder`, which PostGIS 3.7 no longer ships.

The CI `deploy` job restores it with `scripts/restore.sh --force` on the current image, so the upgrade path of
installs made before the move to PostgreSQL 18 (CONTRIBUTING.md → Upgrading PostgreSQL) stays tested. It is not
used by pytest.

To regenerate it, start a stack on the old image (a throwaway compose file with `postgis/postgis:17-3.5` and
`db-data:/var/lib/postgresql/data`), create the account, run `scripts/backup.sh --db-only` with `COMPOSE` pointing
at that stack, and copy `db.dump` and `manifest.json` here.
