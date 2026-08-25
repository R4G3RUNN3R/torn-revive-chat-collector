# ReviveRelay Isolated VPS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the first production-capable ReviveRelay backend foundation on `new-voidsmith` with a physically separate PostgreSQL container, credentials, private network, storage, backups, API/worker runtime, and localhost-only Caddy origin.

**Architecture:** ReviveRelay runs as its own Docker Compose project under `/srv/voidsmith/torn-platform/reviverelay`. PostgreSQL joins only `reviverelay_db_internal` (`internal: true`); API and worker join both that network and `reviverelay_egress`; no existing Voidsmith container joins either ReviveRelay network. PostgreSQL publishes no host port. The API publishes only `127.0.0.1:18730`, with Caddy as the only public ingress.

**Tech Stack:** Docker Compose, PostgreSQL 16 Alpine, Node.js 20, Caddy 2, Bash verification/backup scripts, existing ReviveRelay Node server.

**Spec:** `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

## Global Constraints

- HARD STOP: do not deploy ReviveRelay if database isolation from every other Voidsmith application cannot be proven.
- Target host is only `new-voidsmith`; never modify `old-nexis`.
- ReviveRelay must use a dedicated PostgreSQL container, dedicated database, dedicated database user, dedicated password, dedicated persistent volume/path, dedicated private DB network, dedicated migrations, backups, and restore procedure.
- PostgreSQL must have no published host port.
- ReviveRelay must receive no DungeonMasterOS, Nexis, CIEL, Guacamole, or other application database credentials.
- Existing services must not join ReviveRelay Docker networks.
- Secrets must live outside Git under `/srv/voidsmith/shared/secrets/reviverelay/` with restrictive permissions.
- API origin must bind only to `127.0.0.1:18730`.
- Paid tier remains disabled until transaction verification and compliance gates are complete.
- Google Sheets is non-authoritative and one-way only.

---

### Task 0: Prove Isolation Is Achievable Before Deployment

**Files:**
- Create: `/srv/voidsmith/torn-platform/reviverelay/ops/verify-isolation.sh`

**Produces:** A fail-closed isolation gate that exits non-zero if ReviveRelay shares its DB network, DB storage, DB credentials, or published DB port with another application.

- [ ] **Step 1: Write the failing pre-deployment isolation check**

The script must require the future network `reviverelay_db_internal`, database container `reviverelay-db`, and localhost API listener. Before deployment it must fail because those resources do not exist.

- [ ] **Step 2: Run it and verify RED**

Run: `bash ops/verify-isolation.sh`
Expected: non-zero with `reviverelay_db_internal missing`.

- [ ] **Step 3: Preserve the current Docker topology as evidence**

Record container names, network memberships, host listeners for `5432` and `18730`, and existing named volumes in `ops/preflight-2026-08-25.txt`. Do not record secret values.

### Task 1: Establish Local Server Workspace

**Files:**
- Create: `/srv/voidsmith/torn-platform/reviverelay/repo/`
- Create worktree: `/srv/voidsmith/torn-platform/reviverelay/worktrees/isolated-vps-foundation/`

**Produces:** An isolated local Git worktree for the infrastructure changes.

- [ ] **Step 1: Clone `R4G3RUNN3R/torn-revive-chat-collector` into `repo/` if absent.**
- [ ] **Step 2: Create branch `local/reviverelay-isolated-vps-foundation` in an isolated worktree.**
- [ ] **Step 3: Install root and server dependencies with `npm ci`.**
- [ ] **Step 4: Run existing root and server tests.**
Expected: baseline tests pass before infrastructure modifications. If they fail, stop and debug before continuing.

### Task 2: Create Dedicated Secrets and Storage Boundaries

**Files:**
- Create: `/srv/voidsmith/shared/secrets/reviverelay/runtime.env` mode `0600`
- Create: `/srv/voidsmith/torn-platform/reviverelay/data/postgres/`
- Create: `/srv/voidsmith/torn-platform/reviverelay/backups/postgres/`
- Create: `/srv/voidsmith/torn-platform/reviverelay/logs/`

**Produces:** Dedicated ReviveRelay-only runtime secrets and data paths.

- [ ] **Step 1: Generate independent random values for `REVIVERELAY_DB_PASSWORD`, `API_KEY_ENCRYPTION_KEY`, and `SESSION_TOKEN_PEPPER`.**
- [ ] **Step 2: Write only ReviveRelay variables to `runtime.env`; do not copy any existing application environment file.**
- [ ] **Step 3: Verify no variable name or value references Nexis, DungeonMasterOS, CIEL, or Guacamole database endpoints/users.**
- [ ] **Step 4: Set secret file/directory permissions to owner-only access.**

### Task 3: Correct the Compose Topology

**Files:**
- Modify: `deploy/docker-compose.yml`
- Create: `deploy/verify-compose-isolation.sh`

**Produces:** Compose topology with a DB-only private network and separate API/worker egress.

- [ ] **Step 1: Write a failing static compose test** that asserts:
  - `reviverelay-db` joins only `reviverelay_db_internal`.
  - `reviverelay-db` has no `ports:` mapping.
  - API/worker join both `reviverelay_db_internal` and `reviverelay_egress`.
  - API publishes exactly `127.0.0.1:18730:3100`.
  - storage path is under `/srv/voidsmith/torn-platform/reviverelay/data/postgres`.

- [ ] **Step 2: Run static test and verify RED against the current template.**

- [ ] **Step 3: Modify Compose to define:**

```yaml
networks:
  reviverelay_db_internal:
    name: reviverelay_db_internal
    internal: true
  reviverelay_egress:
    name: reviverelay_egress
```

`reviverelay-db` uses only `reviverelay_db_internal`. API/worker use both.

- [ ] **Step 4: Run `docker compose config` and the static isolation test; both must pass.**

### Task 4: Bring Up PostgreSQL Alone and Prove Separation

**Files:**
- Runtime only; no application data from another service is imported.

**Produces:** Healthy isolated PostgreSQL instance.

- [ ] **Step 1: Start only `reviverelay-db`.**
- [ ] **Step 2: Verify container health.**
- [ ] **Step 3: Inspect `reviverelay_db_internal` and require exactly the expected ReviveRelay DB member at this stage.**
- [ ] **Step 4: Verify no host listener exists on `5432`.**
- [ ] **Step 5: Verify `guacamole-postgres-1` is not on `reviverelay_db_internal`.**
- [ ] **Step 6: From a disposable container attached only to `guacamole_guac-internal`, verify `reviverelay-db` cannot be resolved/reached.**
- [ ] **Step 7: From a disposable container attached only to `reviverelay_egress`, verify `reviverelay-db` cannot be resolved/reached.**

Any failure in Steps 3-7 is a HARD STOP.

### Task 5: Deploy Existing API and Worker Against Only ReviveRelay DB

**Files:**
- Modify deployment config only as required for `/srv/voidsmith/torn-platform/reviverelay` paths.

**Produces:** API/worker connected to ReviveRelay PostgreSQL and able to reach Torn API outbound.

- [ ] **Step 1: Run database migrations against `reviverelay-db`.**
- [ ] **Step 2: Start API and worker.**
- [ ] **Step 3: Verify API health locally on `127.0.0.1:18730`.**
- [ ] **Step 4: Verify worker heartbeat/job loop starts without credential errors.**
- [ ] **Step 5: Verify API/worker resolve `reviverelay-db`.**
- [ ] **Step 6: Verify DB does not resolve/reach other application DB service names.**
- [ ] **Step 7: Verify API/worker have outbound HTTPS capability while PostgreSQL remains isolated.**

### Task 6: Caddy Origin Routing Without DNS Cutover

**Files:**
- Modify: `/srv/voidsmith/infrastructure/caddy/Caddyfile`

**Produces:** Caddy route for `reviverelay.voidsmithindustries.com` to localhost API only.

- [ ] **Step 1: Back up the current Caddyfile.**
- [ ] **Step 2: Add reverse proxy to `127.0.0.1:18730`.**
- [ ] **Step 3: Validate Caddy configuration before reload.**
- [ ] **Step 4: Reload Caddy and verify local Host-header routing.**

Do not add/change DNS until the local route and health endpoint pass.

### Task 7: Backup and Restore Verification

**Files:**
- Create/modify: `/srv/voidsmith/torn-platform/reviverelay/ops/backup.sh`
- Create/modify: `/srv/voidsmith/torn-platform/reviverelay/ops/restore-test.sh`

**Produces:** ReviveRelay-only database backup and disposable restore proof.

- [ ] **Step 1: Create a timestamped `pg_dump` from only `reviverelay-db`.**
- [ ] **Step 2: Verify the dump is non-empty and belongs to the `reviverelay` database workflow.**
- [ ] **Step 3: Restore into a disposable PostgreSQL container/volume that is not any production database.**
- [ ] **Step 4: Compare schema/table counts between production ReviveRelay and restored ReviveRelay.**
- [ ] **Step 5: Destroy only the disposable restore container/volume.**

### Task 8: Final Isolation Gate and Local Commit

**Files:**
- Update: `ops/verify-isolation.sh`
- Create: `ops/isolation-report-2026-08-25.txt`

**Produces:** Evidence that the deployed foundation meets the user's hard separation rule.

- [ ] **Step 1: Run complete application/server tests.**
- [ ] **Step 2: Run `docker compose config`.**
- [ ] **Step 3: Run dynamic isolation gate.** It must prove:
  - DB has no published port.
  - DB is only on `reviverelay_db_internal`.
  - no non-ReviveRelay container is on either ReviveRelay network.
  - API is only published to `127.0.0.1:18730`.
  - ReviveRelay secret file contains no other-project database identifiers.
  - data/backup paths are ReviveRelay-specific.
- [ ] **Step 4: Record non-secret evidence in `ops/isolation-report-2026-08-25.txt`.**
- [ ] **Step 5: Commit locally on `local/reviverelay-isolated-vps-foundation`.**

DNS publication is a later gated step after this foundation is verified. No userscript endpoint is switched during this plan.

## Execution note — public ingress gate

On 2026-08-25, `reviverelay.voidsmithindustries.com` had no A record. The internal foundation was therefore completed without modifying Caddy. The HTTPS/Caddy step remains intentionally gated until DNS points to the new VPS, so Caddy is not asked to obtain a certificate for a non-resolving hostname.
