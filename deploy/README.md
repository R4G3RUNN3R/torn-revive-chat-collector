# ReviveRelay deployment

ReviveRelay runs on `new-voidsmith` under `/srv/voidsmith/torn-platform/reviverelay` and is intentionally isolated from every other Voidsmith database.

## Runtime layout

- application snapshot: `/srv/voidsmith/torn-platform/reviverelay/app`
- PostgreSQL data: `/srv/voidsmith/torn-platform/reviverelay/data/postgres`
- PostgreSQL backups: `/srv/voidsmith/torn-platform/reviverelay/backups/postgres`
- logs/operations: `/srv/voidsmith/torn-platform/reviverelay/logs` and `ops`
- production secrets: `/srv/voidsmith/shared/secrets/reviverelay/runtime.env`

The secret directory must be mode `0700` and `runtime.env` mode `0600`. Never copy another project's environment file into ReviveRelay.

## Database isolation

`reviverelay-db` is a dedicated PostgreSQL 16 service with its own database, database user, password, data path, migrations and backups.

It joins only:

- `reviverelay_db_internal` (`internal: true`)

It has no host-published PostgreSQL port and no outbound internet route.

`reviverelay-api` and `reviverelay-worker` join:

- `reviverelay_db_internal` so they can reach only the ReviveRelay database
- `reviverelay_egress` so they can call Torn over HTTPS

No existing Voidsmith service may join either ReviveRelay network. ReviveRelay must receive no DungeonMasterOS, Nexis, CIEL, Guacamole or other-project database credentials.

## API ingress

The API container publishes only:

`127.0.0.1:18730 -> container port 3100`

There is no direct public application listener. Caddy/HTTPS is added only after `reviverelay.voidsmithindustries.com` DNS resolves to the new VPS.

## Validate Compose

```bash
docker compose \
  -p reviverelay \
  --env-file /srv/voidsmith/shared/secrets/reviverelay/runtime.env \
  -f /srv/voidsmith/torn-platform/reviverelay/app/deploy/docker-compose.yml \
  config -q
```

## Runtime isolation check

Run:

```bash
/srv/voidsmith/torn-platform/reviverelay/ops/verify-isolation.sh
```

The check fails closed if PostgreSQL exposes a host port, joins an unexpected network, a non-ReviveRelay service joins a ReviveRelay network, the API is not loopback-only, or the dedicated secret boundary is violated.

## Backups

```bash
sh /srv/voidsmith/torn-platform/reviverelay/app/deploy/backup.sh
```

Backups are gzip-compressed PostgreSQL dumps stored only under `/srv/voidsmith/torn-platform/reviverelay/backups/postgres`.

Verify a backup by restoring it into a disposable isolated PostgreSQL container:

```bash
/srv/voidsmith/torn-platform/reviverelay/ops/restore-test.sh /path/to/reviverelay-YYYYmmdd-HHMMSS.sql.gz
```

The restore test never writes to another Voidsmith database.

## Public launch gates

- Keep `PAID_TIER_ENABLED=false` until the protected transaction verification and compliance gates are complete.
- Do not point the userscript at this API until HTTPS/DNS are verified.
- Google Sheets may receive one-way administrative exports only; it is never authoritative.

## Immutable client releases

`deploy/publish-client-release.sh` publishes verified client artifacts into `/srv/voidsmith/torn-platform/reviverelay/releases/client/<version>/`. Existing version directories are never overwritten or deleted. Publication verifies the automatic/manual SHA-256 values from `release-manifest.json`, stages files into a temporary directory, atomically renames the immutable version, and only then advances `current` and the stable `manifest.json` copy.

The later public mapping is deliberately separate from release creation:

- `/install/reviverelay-auto.user.js` -> `releases/client/current/reviverelay-auto.user.js`
- `/install/reviverelay-auto.meta.js` -> `releases/client/current/reviverelay-auto.meta.js`
- `/install/reviverelay-manual.user.js` -> `releases/client/current/reviverelay-manual.user.js`
- `/v1/client/version` -> API-validated `releases/client/manifest.json`

No public Caddy/DNS route is created by the publish script.
