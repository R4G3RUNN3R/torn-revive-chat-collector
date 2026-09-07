# ReviveRelay 0.6.0 Screenshot Checklist

These screenshots are **required human review evidence** and are currently pending capture. Automated tests cannot certify visual/browser behavior.

## Required surfaces

- [ ] **Request**: connected requester, Revive Me preset summary, active certified request, and requester-verification-required state before Accept when applicable.
- [ ] **Reviver**: Pro/verification/eligibility gates and certified queue with Accept control for an eligible reviver.
- [ ] **Activity**: current identity, request, transaction, Pro and queue state without exposing secret credential material.
- [ ] **Pro**: private review mode, current trial/entitlement, server-owned Monthly/6 Months/Yearly plans, manual Torn payment instructions and payment recipient **R4G3RUNN3R [3877028]**.
- [ ] **Settings**: ReviveRelay Verification requester/reviver key helpers, masked connected key, revoke guidance, diagnostics off by default, About & Privacy, and account deletion control.

## Capture requirements

- [ ] Capture desktop Tampermonkey behavior on a current Torn page.
- [ ] Capture any TornPDA/mobile behavior that is claimed as supported before making that claim in the review submission.
- [ ] Redact any real API key, bearer/session token, merchant credential or unrelated private Torn information.
- [ ] Show `0.6.0` and the `review` release channel where visible.
- [ ] Confirm the panel does not reset an edited Settings form during background polling.
- [ ] Confirm no public chat content is displayed or collected by the 0.6.0 runtime.

## Manual acceptance evidence to accompany screenshots

- [ ] Request creation works before requester verification.
- [ ] Requester verification can then be completed with the restricted Basic + Profile + Revives key.
- [ ] Unverified request cannot be accepted and does not appear in the reviver queue.
- [ ] Eligible verified reviver can see/accept the certified request after requester verification.
- [ ] Non-reviver remains blocked from reviver registration/queue.
- [ ] Review-mode Pro invoice displays exact server plan/merchant and requires manual Torn payment.
- [ ] Reload preserves authenticated session/state without redisplaying plaintext verification credentials.

**Status:** pending human capture and manual browser acceptance. This checklist does not claim that screenshots or manual acceptance are complete.
