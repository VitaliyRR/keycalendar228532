import { createHash } from "node:crypto";
import { assertDomain } from "./errors.js";
import { parseInstant } from "./dates.js";
import { financialTotals, type FinancialEvent } from "./ledger.js";
import { parseMinor, percentMinor, serializeMinor, validateBps, type Minor } from "./money.js";

export interface CancellationPolicy {
  readonly version: string;
  readonly kind: "free" | "fixed" | "percent_of_cancelled";
  readonly freeUntil?: string;
  readonly fixedMinor?: string;
  readonly feeBps?: number;
}
export interface CancellableCharge {
  readonly chargeEventId: string;
  readonly amountMinor: string;
  readonly recognizedMinor: string;
  readonly alreadyCreditedMinor: string;
  readonly reason: string;
}
export interface CancellationPreviewInput {
  readonly reservationId: string;
  readonly reservationVersion: number;
  readonly chargeVersion: number;
  readonly paymentVersion: number;
  readonly refundVersion: number;
  readonly depositVersion: number;
  readonly effectiveAt: string;
  readonly currency: string;
  readonly events: readonly FinancialEvent[];
  readonly cancellableCharges: readonly CancellableCharge[];
  readonly policy: CancellationPolicy;
  readonly override?: { readonly feeMinor: string; readonly reason: string; readonly authorized: boolean; readonly secondApproval: boolean };
}
export interface CancellationPreview {
  readonly id: string;
  readonly hash: string;
  readonly reservationId: string;
  readonly reservationVersion: number;
  readonly policyVersion: string;
  readonly effectiveAt: string;
  readonly currency: string;
  readonly creditNotes: readonly { readonly chargeEventId: string; readonly amountMinor: Minor; readonly reason: string }[];
  readonly feeMinor: Minor;
  readonly previousChargesMinor: Minor;
  readonly previousCreditedPaymentsMinor: Minor;
  readonly newChargesMinor: Minor;
  readonly newCreditedPaymentsMinor: Minor;
  readonly newBalanceMinor: Minor;
  readonly availableRefundMinor: Minor;
  readonly depositLiabilityMinor: Minor;
  readonly depositAction: "none" | "review_return_or_retain";
}

function policyFee(input: CancellationPreviewInput, cancelled: bigint): bigint {
  const policy = input.policy;
  assertDomain(!!policy.version, "INVALID_RULE", "Accepted cancellation policy version is required");
  if (policy.freeUntil && parseInstant(input.effectiveAt) <= parseInstant(policy.freeUntil)) return 0n;
  switch (policy.kind) {
    case "free": return 0n;
    case "fixed": {
      const fee = parseMinor(policy.fixedMinor ?? "");
      assertDomain(fee >= 0n, "INVALID_RULE", "Fixed fee must be nonnegative");
      return fee;
    }
    case "percent_of_cancelled":
      assertDomain(policy.feeBps !== undefined, "INVALID_RULE", "Percentage policy requires basis points");
      validateBps(policy.feeBps);
      return percentMinor(cancelled, policy.feeBps);
  }
}

export function buildCancellationPreview(input: CancellationPreviewInput): CancellationPreview {
  assertDomain(!!input.reservationId && Number.isSafeInteger(input.reservationVersion) && input.reservationVersion > 0, "INVALID_STATE", "Reservation identity and version required");
  for (const version of [input.chargeVersion, input.paymentVersion, input.refundVersion, input.depositVersion]) {
    assertDomain(Number.isSafeInteger(version) && version >= 0, "INVALID_STATE", "Financial versions must be nonnegative");
  }
  parseInstant(input.effectiveAt);
  const before = financialTotals(input.events, input.currency);
  const previousC = parseMinor(before.chargesMinor);
  const previousP = parseMinor(before.creditedPaymentsMinor);
  const ids = input.cancellableCharges.map((charge) => charge.chargeEventId);
  assertDomain(new Set(ids).size === ids.length, "INVALID_RULE", "Cancellable charge IDs must be unique");
  let cancelled = 0n;
  const creditNotes = input.cancellableCharges.map((charge) => {
    const original = input.events.find((event) => event.id === charge.chargeEventId);
    assertDomain(!!original && original.status === "succeeded" && (original.kind === "lodging_charge" || original.kind === "service_charge"), "INVALID_RULE", "Only a posted lodging/service charge may be cancelled");
    assertDomain(!!charge.reason.trim(), "INVALID_RULE", "Credit note reason is required");
    const amount = parseMinor(charge.amountMinor);
    const recognized = parseMinor(charge.recognizedMinor);
    const alreadyCredited = parseMinor(charge.alreadyCreditedMinor);
    assertDomain(recognized >= 0n && alreadyCredited >= 0n && recognized + alreadyCredited <= parseMinor(original.amountMinor), "INVALID_RULE", "Recognized and credited amounts exceed original charge");
    assertDomain(amount > 0n && amount <= parseMinor(original.amountMinor) - recognized - alreadyCredited, "INVALID_RULE", "Credit amount exceeds unearned, uncredited charge");
    cancelled += amount;
    return Object.freeze({ chargeEventId: charge.chargeEventId, amountMinor: serializeMinor(amount), reason: charge.reason });
  }).sort((a, b) => a.chargeEventId < b.chargeEventId ? -1 : a.chargeEventId > b.chargeEventId ? 1 : 0);
  assertDomain(cancelled <= previousC, "INVALID_RULE", "Cancellable amount exceeds outstanding charges");
  let fee = policyFee(input, cancelled);
  if (input.override) {
    assertDomain(input.override.authorized && input.override.secondApproval && !!input.override.reason.trim(), "INVALID_RULE", "Fee override requires finance permission, reason and second approval");
    fee = parseMinor(input.override.feeMinor);
    assertDomain(fee >= 0n, "INVALID_RULE", "Override fee must be nonnegative");
  }
  const newC = previousC - cancelled + fee;
  const overpayment = previousP > newC ? previousP - newC : 0n;
  const captured = input.events.filter((event) => event.status === "succeeded" && (event.kind === "payment_capture" || event.kind === "channel_payment_capture" || event.kind === "apply_advance")).reduce((sum, event) => sum + parseMinor(event.amountMinor), 0n);
  const reservedRefunds = input.events.filter((event) => event.kind === "payment_refund" && event.status !== "failed").reduce((sum, event) => sum + parseMinor(event.amountMinor), 0n);
  const unreserved = captured > reservedRefunds ? captured - reservedRefunds : 0n;
  const refundable = overpayment < unreserved ? overpayment : unreserved;
  const publicData = {
    reservationId: input.reservationId, reservationVersion: input.reservationVersion,
    versions: [input.chargeVersion, input.paymentVersion, input.refundVersion, input.depositVersion],
    policyVersion: input.policy.version,
    policy: { version: input.policy.version, kind: input.policy.kind, freeUntil: input.policy.freeUntil ?? null, fixedMinor: input.policy.fixedMinor ?? null, feeBps: input.policy.feeBps ?? null },
    effectiveAt: input.effectiveAt,
    currency: input.currency, creditNotes, feeMinor: serializeMinor(fee),
    eventSnapshot: input.events.map((event) => [event.id, event.sourceKey, event.kind, event.status, event.amountMinor, event.currency, event.at, event.relatedPaymentId ?? null, event.reversalOfId ?? null]).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0),
    previousChargesMinor: before.chargesMinor, previousCreditedPaymentsMinor: before.creditedPaymentsMinor,
    newChargesMinor: serializeMinor(newC), newCreditedPaymentsMinor: before.creditedPaymentsMinor,
    newBalanceMinor: serializeMinor(newC - previousP), availableRefundMinor: serializeMinor(refundable),
    depositLiabilityMinor: before.depositLiabilityMinor,
    ...(input.override ? { override: { feeMinor: input.override.feeMinor, reason: input.override.reason, authorized: input.override.authorized, secondApproval: input.override.secondApproval } } : {}),
  };
  const hash = createHash("sha256").update(JSON.stringify(publicData)).digest("hex");
  return Object.freeze({
    id: `cancel:${input.reservationId}:${hash.slice(0, 16)}`, hash,
    reservationId: input.reservationId, reservationVersion: input.reservationVersion,
    policyVersion: input.policy.version, effectiveAt: input.effectiveAt, currency: input.currency,
    creditNotes: Object.freeze(creditNotes), feeMinor: serializeMinor(fee),
    previousChargesMinor: before.chargesMinor, previousCreditedPaymentsMinor: before.creditedPaymentsMinor,
    newChargesMinor: serializeMinor(newC), newCreditedPaymentsMinor: before.creditedPaymentsMinor,
    newBalanceMinor: serializeMinor(newC - previousP), availableRefundMinor: serializeMinor(refundable),
    depositLiabilityMinor: before.depositLiabilityMinor,
    depositAction: parseMinor(before.depositLiabilityMinor) > 0n ? "review_return_or_retain" : "none",
  });
}

export function verifyCancellationPreview(preview: CancellationPreview, fresh: CancellationPreviewInput, ifMatchVersion: number): void {
  assertDomain(ifMatchVersion === fresh.reservationVersion && preview.reservationVersion === ifMatchVersion, "VERSION_CHANGED", "Reservation version changed since preview");
  const current = buildCancellationPreview(fresh);
  assertDomain(preview.id === current.id && preview.hash === current.hash, "PREVIEW_CHANGED", "Financial preview is stale; calculate it again");
}
