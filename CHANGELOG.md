# Changelog

## 1.0.1 - Notifications, sound and profile badges (review)

### Added

- Notifications no longer need the panel: one visible Torn tab per browser (the one that polls) notifies once per event. Requesters are told when a reviver accepts (time to pay), when payment is verified, when they are revived, when a revive fails and when a refund is verified. Revivers are told when payment arrives (revive now) and when a refund is owed.
- A short, soft chime plays for accepted, revived, refund verified, payment received and refund owed. One Settings toggle turns all sound off.
- Settings → Notifications adds notifications on/off, one toggle per event type, sound, quiet hours, opt-in silent new-queue-request notices for revivers (at most one a minute, count only) and an opt-out for profile badges. A 0.7 "desktop notifications off" choice carries over.
- An "RR verified requester/reviver" chip appears next to a player's name on their Torn profile when ReviveRelay has verified them. It is looked up only while you are signed in and the profile is visible, and cached for 10 minutes across page loads.
- A newer ReviveRelay version is announced once by notification, even with the panel closed. If another tab found it, the tab that polls announces it.
- An open panel keeps re-checking a pending Pro invoice once it expires, at most every 15 s for up to 3 minutes, so it shows EXPIRED soon after the server records it (the server checks for expired invoices once a minute).
- The first check after installing, or after more than 10 minutes without one, is silent: it records what is already open, and only later changes notify. There is no burst of notifications for transactions that were already under way.

### Changed

- New-request notifications for revivers are now opt-in and silent (0.7 had them on by default), and they give only the queue count.

### Removed

- The opt-in Diagnostics option (off by default in 0.7.x and 1.0.0) and its error reports. ReviveRelay 1.0.1 sends no diagnostics.

### Fixed

- After a failed poll, a new polling tab polls at once instead of waiting a full cadence.
- A chime blocked by the browser's autoplay rule no longer leaves an audio context behind for every event: one is reused for the page and resumed on the next chime.
- A background tab no longer uses up the 5 s "Revived" display before you look at it.
- The panel no longer re-fetches a reviver transaction that has closed, and reopening it on an idle pill clears an old "Needs attention" line.
- TornPDA notifications show fixed at the bottom of the screen even before the panel has been opened on the page (they were an unstyled button at the end of the page).

### Known limitations

- Notifications and sound need a visible Torn tab (or TornPDA in the foreground): hidden tabs do no work, so with every Torn tab in the background nothing is checked or announced until one is shown again. There is no tab-title fallback.
- Duplicate notifications are possible only if two tabs poll at once (a browser without BroadcastChannel, or several TornPDA tabs).
- With two TornPDA tabs open, each notification may appear twice and both tabs poll, because tab leadership is off on TornPDA.
- The new requester and reviver sheets, and hospital-list "RR" badges, come in 1.1. Everyday requests, the reviver queue and transactions still open in the panel from the pill.
- "Revived" shows for 5 s from when each tab first displays it; this is kept per tab and in memory, so a tab opened or reloaded within 30 s of the revive shows it again for up to 5 s.
- For a reviver, a failed transaction that needs reporting shows "Needs attention" on the pill only while the Queue count is not shown.
- There is no in-app way to report a problem yet: the panel says what happened and asks you to report it to the ReviveRelay operator.
- The first chime may be blocked by the browser's autoplay policy until you interact with the page; the notification itself still arrives.
- A state that repeats on one transaction is announced only once. For example, if a retried revive fails a second time, the requester is not told again to choose retry or refund; the pill and panel still show it.
- If the server has not marked an expired Pro invoice EXPIRED within 3 minutes of its expiry, the open panel stops re-checking and shows it as pending until the panel is next refreshed.
- Events that happen while no Torn tab has checked for more than 10 minutes are not announced: the next check takes a silent baseline. The pill and panel still show the current state.
- The whole file is 229.5 KB; the light core is 108.0 KB.

### Release status

1.0.1 is a Beta/Review candidate on the review channel. Stable remains 0.4.4; 0.7.3 remains the rollback.

## 1.0.0 - Lite engine and header pill (review)

### Changed

- ReviveRelay now lives in one pill in Torn's header (launcher position when the header slot is missing). It shows where your revive is: Revive me · n online, Waiting, Pay <reviver>, <reviver> is reviving, Revived, Refunded, Needs attention, and for revivers Queue · n or the transaction that needs them.
- The header pill replaces the left-sidebar "ReviveRelay → Revive Me!" button and the floating `RR` launcher from 0.7.3.
- The panel opens from the pill, and its Request tab has a **Request certified revive** button.
- One scheduler per tab replaces the nine 0.7 timers. Background tabs no longer poll; one tab per browser polls the new `/v1/state` endpoint for all tabs, and hidden tabs make no requests. Polling adapts: 60 s idle, 20 s for revivers, 5 s with an open request or transaction, with back-off when offline.
- The last known state paints instantly from cache (marked as syncing) and is never shown for a different Torn account.
- Finished revives show briefly ("Revived", "Refunded"); problems show "Needs attention".
- An expired session shows "Sign in again" and stops polling until you reconnect.
- The existing panel (requests, reviver queue, Torn API key, Reviver Pro, invoices, settings, diagnostics, account deletion) opens from the pill and no longer polls on its own.

### Server

- `/v1/state` adds `recentlyClosed` (outcomes for 30 s, reportable failures for 1 hour) and `serverTime`.

### Known limitations (until 1.1 or Plan 3b)

- New-request desktop notifications for revivers only fire while the panel is open.
- "Update available" is only visible inside the panel.
- A Pro invoice that expires keeps showing PENDING until the panel is reopened.
- "Revived" shows for 5 s from when each tab first displays it; this is kept per tab and in memory, so a tab opened or reloaded within 30 s of the revive shows it again for up to 5 s.
- For a reviver, a failed transaction that needs reporting shows "Needs attention" on the pill only while the Queue count is not shown; with the queue visible the pill keeps showing Queue · n.
- There is no in-app way to report a problem yet: when the pill opens on "Needs attention", the panel says what happened and asks you to report it to the ReviveRelay operator.
- The whole file is 230.5 KB in 1.0; the light core is 109.7 KB. 1.1 targets 110 KB or less for the whole file, once the old panel is replaced.

### Release status

1.0.0 is a Beta/Review candidate on the review channel. Stable remains 0.4.4; 0.7.3 remains the rollback.

## 0.7.3 - TornPDA bootstrap launcher hardening

### Fixed

- The TornPDA/mobile `RR` recovery launcher no longer depends on the one-time startup runtime classification succeeding first.
- ReviveRelay now recognizes TornPDA's `__PDA_platformReadyPromise` as an early runtime signal, matching TornPDA's own helper bootstrap behavior.
- The recovery launcher is mounted before full ReviveRelay initialization on TornPDA/mobile contexts and remains visible independently of persisted minimized state.
- A failed initialization leaves the RR recovery launcher available; tapping it retries initialization instead of leaving the userscript invisible.
- TornPDA platform-ready events and the platform-ready promise reconcile the mobile panel/launcher after delayed bridge injection.
- Critical launcher positioning/visibility styles are applied inline with `!important` so Torn/mobile page CSS cannot trivially hide the recovery control.

### Comparative evidence

- The fix adopts the robust UI-recovery pattern observed in MoDuL's Pythagoras userscript: mount an independent launcher/root under `document.body` and synchronize it separately from the main application panel.
- Desktop behavior remains unchanged; the recovery launcher is targeted at detected TornPDA and coarse/narrow mobile contexts.

### Release status

0.7.3 is a Beta/Review candidate. Stable remains 0.4.4 and TornPDA compatibility remains Unknown until genuine Android/iOS device acceptance.

## 0.7.2 - One-click safe update handoff

### Changed

- Settings now exposes **Check & install update**. A manual check validates the trusted ReviveRelay distribution metadata and, when a newer Beta/Review build exists, immediately opens the canonical Voidsmith installer for the userscript manager or TornPDA to handle.
- The existing **Install update** action remains available after discovery as a retry/fallback.
- Review-channel update handoff now uses the company-approved public installer authority at `https://voidsmithindustries.com/torn/install/reviverelay.user.js` rather than opening the mutable review-distribution URL directly.
- Background startup/12-hour update checks remain non-intrusive: they notify about a newer version but do not open the installer without an explicit user action.

### Security

- ReviveRelay still does not download-and-eval remote JavaScript, rewrite its own installed source, bypass the userscript manager, or silently install an update.
- The update manager continues to validate the expected ReviveRelay origin, release channel, version metadata and distribution URLs before any installer handoff.
- Installer navigation remains restricted to approved HTTPS Voidsmith/Torn hosts.

### Release status

0.7.2 is a Beta/Review candidate. Stable remains 0.4.4 and TornPDA compatibility remains pending genuine device acceptance.

## 0.7.1 - TornPDA launcher recovery hotfix

### Fixed

- TornPDA runtime detection now tolerates the app bridge and helper APIs becoming available at slightly different times instead of requiring every PDA signal in the same startup instant.
- A minimized ReviveRelay panel on TornPDA now exposes a dedicated 48px safe-area launcher, so the interface remains recoverable even when Torn's mobile layout has no desktop-style sidebar target for the existing restore gear.
- The TornPDA launcher clears persisted minimized state and restores the panel without depending on Torn sidebar markup.

### Verification

- Added regression coverage for staggered TornPDA runtime signals, the independent mobile launcher, safe-area/touch sizing and launcher-based panel restoration.
- Desktop sidebar behavior, server-side authority, entitlement logic, API-key handling and the Stable 0.4.4 line are unchanged.

### Release status

0.7.1 is a Beta/Review hotfix candidate. TornPDA compatibility remains pending genuine device acceptance and must not be represented as Stable until that acceptance is recorded.

## 0.7.0 - TornPDA runtime compatibility

### Added

- Shared browser runtime adapter so one ReviveRelay client supports desktop userscript managers and TornPDA without forking product logic.
- TornPDA runtime detection, native PDA_storage persistence, legacy GM-storage migration, PDA HTTP transport, in-app notification toasts and mobile resume reconciliation.
- TornPDA-specific responsive presentation with safe-area handling and touch-sized controls.
- Regression tests for native TornPDA storage, HTTP behavior, bounded native-request timeouts, bodyless DELETE handling, bodyless JSON POSTs, resume-event coalescing, notification stacking and desktop fallback behavior.

### Changed

- ReviveRelay persistent client state now flows through the platform storage adapter rather than direct GM calls.
- Account deletion uses authenticated POST /v1/account/delete with the same exact confirmation payload; the legacy DELETE /v1/account route remains for backwards compatibility.
- Verification-key revocation uses PDA-safe POST /v1/verification-credential/revoke while retaining the legacy DELETE route for backwards compatibility.
- ReviveRelay preserves native userscript update metadata plus validated automatic startup/12-hour update checks; applying an update remains a userscript-manager/TornPDA installer action rather than remote self-modifying code.
- ReviveRelay advances from 0.6.9 to 0.7.0 under the Voidsmith company-wide single-digit version-component policy. Numeric components above 9 are rejected by both client and server version parsing/runtime contracts.

### Security

- TornPDA does not automatically consume or persist TornPDA's global Torn API key. Existing explicit ReviveRelay key onboarding and server-side authority remain unchanged.
- TornPDA DELETE requests carrying a body fail explicitly in the platform adapter rather than silently dropping confirmation data.
- Native TornPDA HTTP calls are bounded by timeouts so a suspended or orphaned WebView request cannot permanently pin single-flight polling or resume reconciliation.
- TornPDA native-storage initialization/write failures degrade to GM-compatible persistence while preserving the freshest loaded values; a dirty-fallback marker reconciles newer fallback state back into native storage on the next healthy start, and successfully migrated legacy values are neutralized to prevent stale-state resurrection.
- TornPDA update/API-key navigation stays inside the current WebView and is restricted to approved HTTPS hosts; desktop keeps its normal new-tab behavior.
- Account deletion continues to require the exact server-validated confirmation string and authenticated ReviveRelay session.
- No Torn API, entitlement, billing or transaction authority moved into the browser client.

### Release status

0.7.0 is an isolated review candidate pending exact-candidate automated verification plus real TornPDA Android/iOS acceptance. No public distribution or production promotion is implied by this source version.

## 0.6.6 - Completion trust and queue hardening

### Fixed

- Review update manifests now fail closed unless install and metadata URLs match the exact ReviveRelay release origin, channel, version and filenames.
- Static release audit now rejects a userscript whose embedded review API origin is not the canonical ReviveRelay review endpoint.
- Certified reviver queue now supports Cash/Xanax filtering, independent per-currency minimum offers, newest/oldest and offer-value sorting, optional payment grouping and explicit queue refresh.
- Queue controls are no longer rebuilt by the one-second transaction countdown clock, preserving keyboard/input focus while filters are edited.

### Security

- Added explicit client tests proving one-time identity keys are not persisted, persistent Verification credentials are never rendered plaintext, server-only payment/admin credentials do not enter review client bytes, and telemetry redacts credential material.
- Preserved exact server-side credential boundaries: ReviveRelay session hashes, AES-GCM Verification-key storage, header-only Torn API key transport, and server-only merchant/payment credentials.

### Review status

0.6.6 is a private-review completion candidate. Published 0.6.5 bytes remain immutable. Public stable production remains 0.4.4 and no production promotion is part of this candidate preparation.

## 0.6.3 - Sidebar activation reconciliation hotfix

### Fixed

- Torn sidebar reconciliation now rebinds ReviveRelay activation when the live sidebar node is replaced or cloned without its JavaScript listener.
- Rebinding is idempotent: an existing live action keeps exactly one click handler, while a replacement action is repaired before use.
- Added regression coverage for the browser-observed state where the action still reports `READY` but clicking it produces no `POST /v1/requests`.

### Review status

0.6.3 is a client-only private-review hotfix discovered during live 0.6.2 browser acceptance. The review backend remains compatible with the existing isolated review API contract. Published 0.6.2 review bytes remain immutable and public stable production remains 0.4.4.

## 0.6.2 - Browser acceptance navigation hotfix

### Fixed

- Contextual Settings actions now open the section they advertise. `Set up Reviver Verification`, requester verification prompts and verification-key update prompts open **ReviveRelay Verification** directly; `Configure Revive Me preset` opens **Revive Me preset** directly.
- Sidebar setup routing now explicitly targets the preset section instead of relying on the drawer default.

### Review status

0.6.2 is a client-only private-review hotfix discovered during live 0.6.1 browser acceptance. The review backend remains on the compatible 0.6.1 API contract and public stable production remains 0.4.4.

## 0.6.1 - Private Torn review runtime hardening

### Added

- Dedicated `/review/v1/` API runtime for the 0.6.1 private review channel while stable 0.4.4 remains on `/v1/`.
- Explicit server runtime contract with server version, minimum client version, release channel and subscription state.
- Server-derived `OWNER` Reviver Pro state for the canonical payment recipient **R4G3RUNN3R [3877028]**, with Lifetime access and no expiry.
- Regression coverage proving the 7-day trial remains one-time per canonical Torn identity across reinstall/session/key/account lifecycle events.
- Dedicated review subscription-payment scanner that does not compete with the stable 0.4.4 generic worker queue.

### Changed

- Review-client subscription/runtime handling now fails closed when metadata is missing, malformed, incompatible or from the stable channel; absence never defaults to `free`.
- Owner accounts do not render trial or subscription-purchase controls.
- Review artifacts and documentation advance immutably to 0.6.1; 0.6.0 review bytes remain unchanged.

### Security

- OWNER is derived only from authenticated Torn identity plus trusted canonical merchant configuration and cannot be supplied by userscript state or request data.
- OWNER bypasses only paid/trial entitlement; verification capability, Torn permanent revive ability, active reviver registration, requester evidence and transaction safety remain mandatory.
- Trial timestamps remain server-authoritative and are not reset by userscript reinstall, cleared local state, new ReviveRelay sessions, verification-key replacement, account delete/reactivate or application restart.

### Review status

0.6.1 is for the **private review channel only**. Public production remains **0.4.4** and stable 0.4.4 is unchanged. Paid public launch still awaits Torn approval and manual browser acceptance evidence.

## 0.6.0 - Torn review candidate

### Added

- Server subscription modes: `free`, `review`, `live`.
- Full Reviver Pro prepaid plan catalogue and private review-channel billing flow.
- Monthly 10 Xanax / $10,000,000, 6 Months 55 Xanax / $55,000,000, Yearly 100 Xanax / $100,000,000.
- Canonical subscription payment recipient **R4G3RUNN3R [3877028]**.
- Restricted merchant incoming-payment verification and payment-evidence replay protection.
- 7-day Reviver Pro trial with server-authoritative entitlement.
- Separate immutable review/stable update channels.
- About & Privacy, account deletion, verification revocation and diagnostics disclosures.
- Requester-specific ReviveRelay Verification helper using Basic + Profile + Revives.
- Reviver/combined verification helper adding Perks and restricted Money/Items logs.
- Server-side requester verification gate before a request can enter the reviver queue or be accepted.
- Static Torn review release audit and review-package evidence documents.

### Changed

- 0.6.0 runtime is direct certified-request only; no public chat collection is required.
- Reviver Verification is now presented as role-aware **ReviveRelay Verification**.
- Subscription plan pricing and merchant identity are rendered from server state rather than duplicated as authoritative client constants.
- Reviver access in `free` mode no longer requires a paid entitlement, while eligibility/credential/ability gates remain enforced.
- Client polling/mutations use single-flight and in-flight guards to reduce duplicate work.
- Optional notifications fail safely when `GM_notification` is unavailable.
- Diagnostics are off by default.
- User-facing server error codes are translated into bounded explanatory messages.

### Security

- Request acceptance rechecks requester evidence capability inside the same database transaction that creates the assignment/payment window.
- Unverified requester requests are hidden from the reviver queue.
- Reviver queue/Accept continue to revalidate current Torn revive ability.
- Persistent user verification keys are encrypted at rest and never returned plaintext after binding.
- Subscription invoice amount, duration, merchant and entitlement activation remain server-authoritative.
- Review artifacts are pinned to an immutable Git commit and reject review/stable channel crossing.

### Review status

0.6.0 is for the **private review channel only**. Public production remains 0.4.4. Paid public launch is awaiting Torn approval and manual browser acceptance evidence remains pending.
