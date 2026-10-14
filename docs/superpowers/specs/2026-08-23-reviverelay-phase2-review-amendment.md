# ReviveRelay Phase 2 Review Amendment

Date: 2026-08-23
Status: Approved-spec correctness amendment
Applies to: `docs/superpowers/specs/2026-08-23-reviverelay-phase2-design.md`

This amendment resolves three correctness issues found by automated review after the Phase 2 design was approved. It does not change the approved product/business rules; it makes three previously under-specified edge cases deterministic.

## 1. Payment-deadline reconciliation

The three-minute requester payment window remains unchanged.

At `payment_deadline`, the backend MUST NOT immediately release the reviver reservation. The transaction enters `PAYMENT_RECONCILING` for a maximum of **60 seconds**.

During reconciliation:

1. the request remains locked to the original reviver;
2. no second reviver may accept it;
3. the backend performs an immediate payment verification and retries at 30 seconds and 60 seconds if Torn is available;
4. a payment whose Torn evidence timestamp is on or before the original `payment_deadline` is accepted even if Torn exposed it during the reconciliation window;
5. when such payment is verified, `payment_verified_at` is recorded and the normal five-minute revive SLA starts;
6. if no payment evidence exists after the final reconciliation check, the reservation is released and the request returns to `AVAILABLE` if the requester remains eligible.

If a payment first occurs after the original three-minute deadline but reaches the assigned reviver before the reservation is finally released, it is a **late payment** rather than a valid contract payment. The request must not be reassigned while that money/item is stranded with the first reviver. The transaction enters `REFUND_REQUIRED_LATE_PAYMENT`, with the standard ten-minute refund deadline. After the refund is verified, the direct request may return to `AVAILABLE` if the requester remains eligible.

A Torn API outage must never turn an unverified payment into fraud. Verification remains retryable and auditable.

## 2. Failed-revive retry approval window

A verified failed revive attempt remains non-misconduct.

If the requester chooses **Request another attempt**, the transaction enters `RETRY_OFFERED` and the assigned reviver gets **2 minutes** to accept another attempt.

During those two minutes:

- the requester may withdraw the retry request and choose refund instead;
- the reviver may accept, starting a fresh five-minute revive attempt window;
- the reviver may decline, immediately entering `REFUND_REQUIRED`;
- if the reviver does not respond before `retry_response_deadline`, the transaction automatically enters `REFUND_REQUIRED`.

The backend records `retry_requested_at`, `retry_response_deadline`, and the reviver response when present. A transaction may never remain indefinitely in a retry-pending state.

## 3. Candidate deduplication without Torn source timing

The preferred permanent candidate identity remains:

`channel_canonical_id + source_message_id`

When no source message ID exists but a Torn message timestamp exists, use:

`channel_canonical_id + sender_id/name + Torn message timestamp + normalized message text`

When neither a stable source message ID nor Torn message timestamp is available, ReviveRelay MUST NOT create a permanent identity using only channel, sender, and text. That would incorrectly collapse legitimate later repeats such as the same player writing `rev please` again days later.

Instead, the server computes a `fallback_basis_hash` from:

`channel_canonical_id + sender_id/name + normalized message text`

Fallback observations are deduplicated only inside a rolling **120-second server-receipt window**:

1. acquire a transaction/advisory lock for the `fallback_basis_hash`;
2. look for the newest candidate with that basis whose `last_seen_at` is within 120 seconds of server receipt;
3. if found, increment `seen_count` and update `last_seen_at`;
4. otherwise create a new candidate occurrence with a new immutable candidate ID and the same `fallback_basis_hash`.

This preserves simultaneous multi-user deduplication without permanently suppressing later legitimate requests. Local `capturedAt` remains observation metadata only and must not be part of cross-user permanent identity.

## 4. Testing additions

The implementation plan must include regression tests proving:

- a payment sent before the three-minute deadline but exposed by Torn during the 60-second reconciliation window is accepted;
- the request cannot be accepted by a second reviver while payment reconciliation is in progress;
- a payment sent after the deadline enters the late-payment refund path instead of silently binding or being ignored;
- `RETRY_OFFERED` auto-transitions to `REFUND_REQUIRED` after two minutes without a reviver response;
- the requester can choose refund during the retry-response window;
- identical no-ID/no-timestamp observations inside 120 seconds merge;
- the same no-ID/no-timestamp text outside 120 seconds creates a new candidate occurrence.
