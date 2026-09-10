# ReviveRelay 0.6.5 Review Hotfix

Private-review client update produced after live 0.6.4 browser acceptance exposed an intermittent post-refresh sidebar activation failure.

## Browser-driven sidebar hardening

- Live evidence: after a full Torn refresh, the sidebar action visibly reported `READY`, the saved preset remained valid, and the review API continued normal GET polling, but clicking the action produced no `POST /v1/requests`.
- Waiting more than two reconciliation intervals did not change the outcome, ruling out a simple five-second reconciliation-delay explanation.
- 0.6.5 adds a pointer-gesture capture path in addition to the existing direct click listener and window click-capture delegation.
- A valid primary-button gesture is remembered at `pointerdown` and can complete at `pointerup` even if Torn replaces the ReviveRelay DOM node before the later click event.
- The gesture is bounded by pointer identity, a two-second window and a 32-pixel movement limit.
- The following click is suppressed briefly so one physical activation cannot create two requests.
- Existing 0.6.3/0.6.4 clone-rebinding, MutationObserver reconciliation and click-capture fallbacks remain in place.

The exact Torn internal event/remount sequence is not claimed as directly observed because the user's browser was not instrumented at DOM-event level. The new regression reproduces the specific failure class that is consistent with the live symptom: the action exists at pointer-down but is replaced before click delivery.

## Completion-hardening changes included in this candidate

0.6.5 also includes the already-reviewed client hardening that had made immutable 0.6.4 unsuitable for further publication:

- A failed/unavailable reviver-eligibility check no longer generates repeated eligibility traffic on every later entitlement tick until a normal reactivation path resets the state.
- Queue, identity, eligibility and invoice state use authoritative revision guards so delayed older responses cannot overwrite a newer revocation, deletion or denial decision.
- Queue transport failure remains distinct from an authoritative empty queue; failed transport does not erase known queue state or invent an empty result.
- Protected actions and notifications continue to require the authoritative entitlement, role, credential and revive-ability state demanded by their business rules.

## Preserved 0.6.4 behavior

- Desktop notifications remain user-toggleable under Settings → Notifications, default enabled, with the disabled preference persisted locally.
- Disabling desktop notifications does not disable queue polling or Accept controls.
- OWNER lifetime entitlement, one-time trial persistence, verification, subscription, merchant, payment, transaction and server API contracts are unchanged.
- The review backend remains the isolated 0.6.1 API contract on port 18731; `minimumVersion` remains 0.6.1.
- Previously published 0.6.4 review bytes remain immutable.
- Public stable remains 0.4.4 and is not modified by this review release.

## Exact frozen artifact

- Source commit: `dee29b9ce7fa4a65654f053534d0ebe4ce9aa35e`
- Version/channel: `0.6.5` / `review`
- Build timestamp: `2026-09-10T23:15:19.840Z`
- Userscript SHA-256: `9e065d49e6ac20d6cdeebc810a3099cd3ec1e728e455dcee7a84010ed3a26972`
- Userscript size: `128173` bytes
- Metadata SHA-256: `5a51723ef9a5ce780011148e9b274917f25631ee5e64d7271d6a50d61275921f`

Manual browser acceptance is still required before stable promotion.
