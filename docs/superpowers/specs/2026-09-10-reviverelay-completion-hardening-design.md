# ReviveRelay Completion Hardening Design

**Date:** 2026-09-10  
**Status:** Approved  
**Scope:** ReviveRelay 0.6.x completion line. The current immutable private-review candidate is 0.6.4.

## Context and audited baseline

ReviveRelay is no longer at the stage where a broad rewrite is justified. The product has a mature userscript, isolated review backend, automated release/provenance controls, subscription and verification rules, recovery paths, and a private review channel. The remaining work is completion work: prove runtime behavior, close evidence gaps, fix only demonstrated defects, reconcile release truth, and promote an accepted immutable candidate.

The live baseline on 2026-09-10 is:

- Public stable remains 0.4.4 and must stay untouched until the production gate.
- Private review is 0.6.4.
- The active completion branch is `fix/reviverelay-trial-persistence` in `.worktrees/fix-reviverelay-trial-persistence`.
- The active completion branch is 76 commits ahead of `origin/main`; the earlier recovery anchor remains at main commit `1cd94a6`.
- The 0.6.4 automated-verification report records a frozen review artifact built from `b6b3d24b0616c9b3f7c9607f72dd5f0a72e55274` with SHA-256 `f2ff7166e6912c6a449790412d1a82947087a64efc5eafb647971ff76e3c7a73`.
- Real Torn desktop acceptance has now proved that one physical click on **ReviveRelay → Revive Me!** produced exactly one `POST /v1/requests` and created the expected certified request.
- The review checklist still has substantial manual, notification, TornPDA, product, API-boundary, privacy, transaction, subscription, screenshot, and Torn-review gates open.

These are baseline facts, not completion claims. Every acceptance result used for promotion must be tied to the exact candidate bytes being promoted.

## Goal

Finish ReviveRelay 0.6.x as a professional, release-ready product without destabilizing working architecture. Completion means there is one accepted immutable candidate whose automated checks, desktop behavior, real TornPDA behavior, security/privacy boundaries, subscription behavior, notification behavior, repository state, release metadata, and rollback procedure are all evidenced and internally consistent.

## Non-goals

This pass does not add new product features, redesign the UI for novelty, replace the current backend architecture, introduce new payment methods, expand Torn scraping, add unattended Torn actions, centralize unnecessary credentials, or refactor working code merely because a different structure is aesthetically attractive. New ideas discovered during the pass go to a future backlog unless they are necessary to correct a release-blocking defect.

## Completion doctrine

ReviveRelay uses **feature freeze plus evidence-driven change** for this pass.

A change is allowed only when it does one of the following:

1. fixes a reproduced acceptance or security defect;
2. closes a testable lifecycle, state-semantics, privacy, credential, or release-integrity gap;
3. makes release evidence truthful and reproducible; or
4. is required to pass real desktop or TornPDA acceptance.

Every shipping change is test-first where practicable, minimal in scope, followed by the relevant focused tests and the full release gate. Documentation-only evidence may be added without changing the immutable candidate.

## Version and immutable-candidate policy

Published review artifacts are immutable.

- Stable stays at 0.4.4 until explicit production approval.
- If completion requires only documentation and acceptance evidence, 0.6.4 remains the candidate.
- If any shipping userscript, server, release-contract, or runtime behavior changes, the next unused patch candidate is created, normally 0.6.5.
- A published 0.6.4 artifact is never silently rebuilt or overwritten in place.
- Manual evidence gathered against an older candidate is reused only when the changed surface provably cannot affect that evidence; otherwise the affected acceptance path is rerun.

## Locked architecture and trust invariants

The approved 0.6.x architecture remains authoritative:

- The backend is the source of truth for entitlement, payment verification, certified-request state, and server-originated alert truth.
- The client displays entitlement truth; it does not manufacture paid state, trial state, price, duration, merchant identity, or successful payment state.
- Requester access remains free; Reviver Pro remains governed by the approved one-time trial and prepaid subscription model.
- Actual Torn game actions remain manual user actions where required by Torn policy.
- The userscript does not bypass CAPTCHA, scrape unfocused/hidden Torn pages, or perform non-API Torn requests as background automation.
- The client must not load arbitrary remote executable code, use `eval`, or leak review-only secrets into public artifacts.
- Review and stable channels remain isolated so review behavior cannot silently alter stable 0.4.4.
- Cached data may improve continuity but cannot override newer authoritative state.

## Dormancy invariant

A disabled, unlicensed, revoked, or context-inapplicable ReviveRelay client must become genuinely dormant.

Dormant does not mean destroying every listener. A small reactivation surface is permitted when it is necessary to notice navigation, mount the sidebar control, restore settings, or safely re-evaluate state. What is forbidden is unnecessary ongoing work while the feature is inactive, including repeated API polling, notification delivery, queue refresh loops, high-frequency DOM scans, duplicate MutationObservers, or timers that exist only to service functionality the user has disabled or cannot use.

The lifecycle audit must classify each observer, interval, timeout, event listener, and recurring network path as one of:

- required bootstrap/reactivation infrastructure;
- active-feature work that must start and stop with feature state; or
- unnecessary/duplicated work to remove.

The test suite must prove stop/start idempotence and prevent duplicated timers, observers, listeners, requests, or notifications after Torn SPA navigation and remounting.

## Unknown and pending state invariant

ReviveRelay must never turn absence of knowledge into a false success or false failure.

The client and server-facing UI must distinguish at least:

- loading/pending;
- authoritative empty/no-data;
- authoritative success/eligible/active;
- unlicensed, revoked, denied, or unauthorized;
- transport/server failure;
- stale cached state; and
- unknown or not-yet-verified state.

Unknown, pending, transport failure, or stale cache must not be rendered or alerted as authoritative success or failure. Notification and action gates must wait for the state required by their business rule. Stale data must be visibly stale when it is shown and must not overwrite newer authoritative data.

## Network and credential boundary

Completion includes an explicit inventory of every off-origin request and every sensitive credential class.

The audit covers:

- Torn API verification credentials and requested access levels;
- ReviveRelay verification credentials;
- subscription/invoice identity and merchant-side incoming-payment credential;
- review-support authorization;
- local browser storage;
- server-side encrypted storage;
- logs, diagnostics, telemetry, error surfaces, release manifests, and generated artifacts.

The review must prove that secrets are not written into release artifacts, public source bundles, browser-visible diagnostics, URLs, or unsanitized logs; that cross-origin client traffic is allowlisted to intended ReviveRelay services; and that merchant/payment verification credentials never enter the userscript.

## Desktop acceptance

Desktop acceptance is performed against the exact immutable review candidate in a real supported browser on Torn, not merely a DOM unit test.

Required evidence includes:

- install/update and boot;
- sidebar mount/re-mount through Torn SPA navigation;
- requester create/cancel lifecycle;
- self-revive protection;
- grouping/filter/sort and queue refresh;
- verification and revoked/unauthorized behavior;
- trial, expired-trial, unlicensed, and paid entitlement states;
- subscription invoice flow under controlled review conditions;
- notification permission, one-shot/timed behavior, deduplication, disabled suppression, no-data/pending/invalid behavior, and non-leakage on denied/revoked state;
- responsive layout, keyboard/focus behavior, and readable error states;
- no duplicate listeners, requests, notifications, or actions after remount/reload.

The Chrome review/extension-style surface must be identified precisely. The repository currently contains review/CSP verification for a packaged HTML surface but no first-class browser-extension source tree was found in the audited worktree. Completion documentation must therefore state what actual artifact or harness was tested instead of pretending an extension package exists in the repository.

## Real TornPDA acceptance

TornPDA acceptance must use the real TornPDA app/in-app browser on a physical device or otherwise genuine TornPDA runtime. A narrow desktop viewport is not TornPDA acceptance.

The TornPDA matrix covers install/update compatibility, boot, sidebar/control availability, requester flow, queue presentation, filters/sorting, verification states, subscription states that can safely be exercised, dormant/disabled behavior, navigation/remount behavior, error states, and any notification behavior TornPDA actually supports.

If a platform capability differs from desktop, the difference is documented as an explicit compatibility rule rather than hidden behind a fake parity claim.

## Repository and release truth

The active completion branch is materially ahead of `origin/main`, so release completion includes repository reconciliation.

Rules:

- Preserve the existing recovery anchor and do not rewrite remote history.
- Do not force-push.
- Reconcile only after the accepted candidate and its evidence are known.
- Before any source publication, prove the accepted release commit, artifact hash, branch graph, generated release metadata, and public-source readiness agree.
- Remote source publication is an external side effect and remains behind explicit approval.

## Promotion and rollback

Production promotion is a hard gate.

No stable symlink, stable endpoint, production client artifact, canonical source branch, paid public launch state, or Torn-facing publication is changed merely because automated tests pass. Promotion requires:

1. clean accepted source state;
2. complete automated release gate;
3. required desktop acceptance;
4. required real TornPDA acceptance;
5. security/privacy/network/credential sign-off;
6. completed release checklist with any Torn-review dependency explicitly recorded;
7. verified backup/rollback path; and
8. explicit owner approval for the production action.

After promotion, public version, artifact hash, stable endpoint, health, install path, source provenance, and rollback path are verified immediately. Any regression triggers rollback before further investigation.

## Canonical Source of Truth

The Voidsmith canonical Source of Truth is consulted before material infrastructure changes. It is updated only after a durable release, deployment, or project-status change has actually occurred. Planning and private acceptance work do not rewrite the canonical production state.

## Definition of complete

ReviveRelay Completion Hardening is complete only when the accepted immutable 0.6.x candidate has clean automated verification, real desktop evidence, real TornPDA evidence, no unresolved release-blocking security/privacy/lifecycle/state findings, truthful repository and release metadata, a proven rollback path, the production hard gate has been explicitly approved and executed successfully, and the canonical Source of Truth has been updated and re-verified afterward.
