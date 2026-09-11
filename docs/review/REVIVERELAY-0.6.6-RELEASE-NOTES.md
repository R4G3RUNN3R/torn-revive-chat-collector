# ReviveRelay 0.6.6 Completion Review Candidate

Private-review client candidate produced after completion hardening found two trust-boundary defects and one known desktop/TornPDA acceptance gap in immutable 0.6.5.

## Trust-boundary hardening

- Update manifests now accept install metadata only from the exact `reviverelay.voidsmithindustries.com` release origin, exact channel, exact candidate version and expected userscript/metadata filenames.
- The static review audit now independently pins the embedded client `API_BASE` to `https://reviverelay.voidsmithindustries.com/review`, rather than trusting an approved `@connect` declaration alone.
- Added executable checks that identity bootstrap keys are one-time and not persisted, connected Verification credentials are displayed only as masked state, operator payment/admin secrets do not enter client bytes, and diagnostics redact credentials and request-sensitive material.

## Certified queue completion

- Revivers can filter the certified queue by All, Cash or Xanax.
- Cash and Xanax have independent minimum-offer filters so unlike currencies are never treated as interchangeable units.
- Queue sorting supports newest, oldest, offer high-to-low and offer low-to-high. Offer sorting remains deterministic within payment currency.
- Queue presentation can group by payment type or remain ungrouped.
- The Reviver tab has an explicit `Refresh queue` action using the existing single-flight authoritative refresh path.
- Queue controls stay usable on narrow viewports and are not destroyed by the one-second transaction countdown renderer.

## Preserved contracts

- Requester creation, requester verification, reviver eligibility, Reviver Pro entitlement, OWNER lifetime access, one-time trial persistence, payment evidence, transaction state, notification authorization and server API contracts are unchanged.
- No server route, database schema, merchant identity or pricing change is included in 0.6.6.
- Public stable remains 0.4.4.
- Published review 0.6.5 remains immutable and is not overwritten.

## Acceptance boundary

0.6.6 must pass the complete disposable-PostgreSQL automated gate and then genuine desktop Torn and TornPDA acceptance on the exact immutable candidate bytes. It is not approved for stable production merely by being built or privately published.
