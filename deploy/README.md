# ReviveRelay deployment

ReviveRelay is deployed on the new Voidsmith VPS under `/srv/voidsmith/reviverelay` and uses its own PostgreSQL service, credentials, storage, backups, logs, and private Docker network.

## Create the project directories

```bash
sudo mkdir -p /srv/voidsmith/reviverelay/{app,config,data/postgres,backups,logs}
sudo chown -R "$USER":"$USER" /srv/voidsmith/reviverelay
chmod 700 /srv/voidsmith/reviverelay/config
```

Copy `deploy/.env.example` to `/srv/voidsmith/reviverelay/config/.env`, replace every dummy secret, then protect it:

```bash
chmod 600 /srv/voidsmith/reviverelay/config/.env
```

## Isolation rules

The `reviverelay-db` service is the only PostgreSQL instance ReviveRelay may use. Its port is not published to the host or public internet. `reviverelay-api` and `reviverelay-worker` reach it only through the private `reviverelay_internal` Docker network.

ReviveRelay must never receive database credentials, service names, or network membership belonging to DungeonMasterOS, Nexis, or any other Voidsmith product. The only intentional shared resource is the VPS host itself.

The API is published only to `127.0.0.1:3100` by default so the host reverse proxy can provide HTTPS without exposing the application container directly.

## Validate before starting

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config
```

Confirm the database has no host `ports:` mapping:

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config | sed -n '/reviverelay-db:/,/reviverelay-api:/p'
```

Confirm only ReviveRelay services are attached to the private database network after startup:

```bash
docker network inspect reviverelay_internal
```

Confirm no unrelated database or network names are present:

```bash
grep -Ei 'dungeonmaster|nexis' deploy/docker-compose.yml && exit 1 || true
```

## Backups

ReviveRelay backups belong only under `/srv/voidsmith/reviverelay/backups`. The supplied backup script talks only to the private `reviverelay-db` service and writes a gzip-compressed PostgreSQL dump named `reviverelay-YYYYmmdd-HHMMSS.sql.gz`.

From the deployed repository:

```bash
sh deploy/backup.sh
```

By default the script expects:

- project root: `/srv/voidsmith/reviverelay`
- application copy: `/srv/voidsmith/reviverelay/app`
- compose file: `/srv/voidsmith/reviverelay/app/deploy/docker-compose.yml`
- environment file: `/srv/voidsmith/reviverelay/config/.env`
- backup directory: `/srv/voidsmith/reviverelay/backups`

The paths can be overridden with the corresponding `REVIVERELAY_*` environment variables when testing or relocating ReviveRelay. The backup is first written to a temporary file and renamed only after `pg_dump | gzip` completes successfully, so an interrupted dump is not presented as a valid backup.

## Restore

Restore accepts exactly one `.sql.gz` backup path and targets only the `reviverelay-db` database service:

```bash
sh deploy/restore.sh /srv/voidsmith/reviverelay/backups/reviverelay-20260824-001500.sql.gz
```

Calling the restore script without exactly one backup path fails before Docker is contacted. `psql` runs with `ON_ERROR_STOP=1`, so the restore stops on the first SQL error instead of cheerfully continuing through a damaged database like nothing happened.

Before any production restore, stop or put the API and worker into maintenance mode so they are not writing to the database while it is being restored. Backups and restores must never reuse credentials, volumes, commands, or database services from another Voidsmith product.
