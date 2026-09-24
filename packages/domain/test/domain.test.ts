import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, allocateLargestRemainder, archiveReservation, availableDepositMinor, availableRefundMinor,
  assertRefundAvailable,
  buildCancellationPreview, buildQuote, createFinancialEvent, depositLiabilityMinor,
  effectiveStayRange, financialTotals, nightsBetween, parseLocalDate, parseMinor,
  planAllocation, planCategoryAllocation, postLedgerEntry, rangesOverlap,
  recognizeNights, reverseFinancialEvent, roundHalfUp, stayRange,
  transitionHold, transitionReservation, unarchiveReservation, verifyCancellationPreview,
  type CancellationPreviewInput, type ExistingAllocation, type FinancialEvent, type NightRate,
} from "../src/index.js";

const NOW = "2026-09-24T12:00:00.000Z";
const org = "org-synthetic";
const range = (from: string, to: string) => stayRange(from, to);
const moneyEvent = (id: string, kind: Parameters<typeof createFinancialEvent>[0]["kind"], amountMinor: string, status: "pending" | "succeeded" | "failed" = "succeeded", relatedPaymentId?: string) =>
  createFinancialEvent({ id, sourceKey: `source:${id}`, kind, amountMinor, status, currency: "RUB", at: NOW, ...(relatedPaymentId ? { relatedPaymentId } : {}) });

test("local stay uses calendar nights and half-open boundaries across DST", () => {
  assert.equal(nightsBetween("2026-03-28", "2026-03-31"), 3);
  assert.equal(nightsBetween("2024-02-28", "2024-03-01"), 2);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(rangesOverlap(range("2026-09-10", "2026-09-12"), range("2026-09-12", "2026-09-14")), false);
  assert.equal(rangesOverlap(range("2026-09-10", "2026-09-13"), range("2026-09-12", "2026-09-14")), true);
  assert.deepEqual(effectiveStayRange(range("2026-09-10", "2026-09-12"), 1, 1), range("2026-09-09", "2026-09-13"));
  assert.throws(() => parseLocalDate("2026-02-30"), { code: "INVALID_DATE" });
  assert.throws(() => nightsBetween("2026-09-12", "2026-09-12"), { code: "INVALID_RANGE" });
});

test("allocation plan includes buffer, category unit continuity, replacement, and expired hold", () => {
  const existing: ExistingAllocation[] = [
    { id: "a", organizationId: org, resourceId: "u1", range: range("2026-10-01", "2026-10-03"), active: true, kind: "reservation" },
    { id: "b", organizationId: org, resourceId: "u2", range: range("2026-10-03", "2026-10-05"), active: true, kind: "reservation" },
  ];
  const category = planCategoryAllocation(org, [{ unitId: "u1", resourceIds: ["u1"] }, { unitId: "u2", resourceIds: ["u2"] }], range("2026-10-01", "2026-10-05"), existing, { at: NOW, kind: "reservation" });
  assert.equal(category.ok, false, "free daily quota does not imply a continuous unit");
  const replacement = planAllocation([{ organizationId: org, unitId: "u1", resourceIds: ["u1"], stay: range("2026-10-01", "2026-10-04"), kind: "reservation" }], existing, { at: NOW, replaceAllocationIds: ["a"] });
  assert.equal(replacement.ok, true);
  if (replacement.ok) assert.deepEqual(replacement.deactivateAllocationIds, ["a"]);
  const buffer = planAllocation([{ organizationId: org, unitId: "u1", resourceIds: ["u1"], stay: range("2026-10-03", "2026-10-05"), kind: "reservation", bufferBeforeDays: 1 }], existing, { at: NOW });
  assert.equal(buffer.ok, false);
  const expired: ExistingAllocation = { id: "h", organizationId: org, resourceId: "u3", range: range("2026-10-01", "2026-10-05"), active: true, kind: "hold", holdExpiresAt: "2026-09-24T11:59:59.000Z" };
  const afterExpiry = planAllocation([{ organizationId: org, unitId: "u3", resourceIds: ["u3"], stay: range("2026-10-01", "2026-10-05"), kind: "reservation" }], [expired], { at: NOW });
  assert.equal(afterExpiry.ok, true);
  if (afterExpiry.ok) assert.deepEqual(afterExpiry.expiredHoldIds, ["h"]);
  const linked = planAllocation([{ organizationId: org, unitId: "house", resourceIds: ["u1", "u2"], stay: range("2026-10-01", "2026-10-02"), kind: "reservation" }], existing, { at: NOW });
  assert.equal(linked.ok, false, "selling an entire house conflicts with a booked room");
  assert.throws(() => planAllocation([{ organizationId: "foreign", unitId: "u1", resourceIds: ["u1"], stay: range("2026-10-01", "2026-10-02"), kind: "reservation" }], existing, { at: NOW }), { code: "INVALID_STATE" });
});

test("lifecycle requires committed allocation, preview, explicit reconfirm and separate archive", () => {
  const draft = { status: "draft" as const, version: 1 };
  assert.throws(() => transitionReservation(draft, { command: "confirm", expectedVersion: 1, at: NOW }), { code: "AVAILABILITY_CONFLICT" });
  const confirmed = transitionReservation(draft, { command: "confirm", expectedVersion: 1, at: NOW, allocationCommitted: true });
  assert.equal(confirmed.status, "confirmed");
  assert.throws(() => archiveReservation(confirmed, 2, NOW), { code: "INVALID_STATE" });
  assert.throws(() => transitionReservation(confirmed, { command: "cancel", expectedVersion: 1, at: NOW, cancellationPreviewVerified: true }), { code: "VERSION_CHANGED" });
  const cancelled = transitionReservation(confirmed, { command: "cancel", expectedVersion: 2, at: NOW, cancellationPreviewVerified: true });
  const archived = archiveReservation(cancelled, 3, NOW);
  assert.equal(archived.status, "cancelled");
  const restored = unarchiveReservation(archived, 4);
  assert.equal(restored.status, "cancelled");
  const reconfirmed = transitionReservation(restored, { command: "reconfirm", expectedVersion: 5, at: NOW, allocationCommitted: true });
  const checkedIn = transitionReservation(reconfirmed, { command: "check_in", expectedVersion: 6, at: NOW });
  assert.throws(() => transitionReservation(checkedIn, { command: "cancel", expectedVersion: 7, at: NOW, cancellationPreviewVerified: true }), { code: "INVALID_STATE" });
  assert.equal(transitionReservation(checkedIn, { command: "check_out", expectedVersion: 7, at: NOW }).status, "checked_out");
  assert.throws(() => transitionHold({ status: "active", version: 1, expiresAt: NOW }, "convert", 1, NOW), { code: "INVALID_STATE" });
  const noShowSource = { status: "confirmed" as const, version: 2, scheduledCheckinAt: "2026-09-24T11:00:00.000Z" };
  assert.equal(transitionReservation(noShowSource, { command: "mark_no_show", expectedVersion: 2, at: NOW }).status, "no_show");
});

test("quote chooses priority, rounds once, distributes discounts and recognizes earned nights", () => {
  const base = { ruleId: "base", version: 1, amountMinor: "10001" };
  const nights: NightRate[] = [
    { date: "2026-09-24", base, weekday: { ruleId: "weekend", version: 2, amountMinor: "12000" }, season: { ruleId: "season", version: 3, amountMinor: "13000" }, dayOverride: { ruleId: "override", version: 1, amountMinor: "14000" } },
    { date: "2026-09-25", base, weekday: { ruleId: "weekend", version: 2, amountMinor: "12000" } },
  ];
  const quote = buildQuote({ id: "q1", ratePlanId: "rate1", rateVersionHash: "v1", unitId: "unit1", stay: range("2026-09-24", "2026-09-26"), currency: "RUB", source: "direct", expiresAt: "2026-09-24T13:00:00.000Z", nights, lengthDiscount: { bps: 1000, ruleId: "length", version: 1 }, promo: { bps: 500, ruleId: "promo", version: 1, compatibleWithLengthDiscount: true }, services: [{ id: "clean", description: "Уборка", amountMinor: "500", ruleId: "service", version: 1 }] });
  assert.equal(quote.lines[0]?.ruleId, "override");
  assert.equal(quote.lodgingTotalMinor, "22230");
  assert.equal(quote.totalMinor, "22730");
  assert.equal(recognizeNights(quote, "2026-09-25").length, 1);
  assert.equal(recognizeNights(quote, "2026-09-26").reduce((sum, item) => sum + parseMinor(item.amountMinor), 0n), parseMinor(quote.lodgingTotalMinor));
  const split = allocateLargestRemainder("1", [{ id: "2026-09-24:a", weightMinor: "1" }, { id: "2026-09-25:b", weightMinor: "1" }]);
  assert.equal(split.get("2026-09-24:a"), "1");
  assert.equal(roundHalfUp(1n, 2n), 1n);
  assert.throws(() => buildQuote({ id: "q2", ratePlanId: "r", rateVersionHash: "v", categoryId: "cat", categoryRateMapped: false, stay: range("2026-09-24", "2026-09-25"), currency: "RUB", source: "direct", expiresAt: NOW, nights: [nights[0]!] }), { code: "RATE_MAPPING_REQUIRED" });
});

test("financial journal separates charges, successful money, revenue, deposit and pending refund", () => {
  const events: FinancialEvent[] = [moneyEvent("charge", "lodging_charge", "10000"), moneyEvent("payment", "payment_capture", "6000"), moneyEvent("refund", "payment_refund", "1000", "succeeded", "payment"), moneyEvent("credit", "lodging_credit_note", "1000"), moneyEvent("earned", "night_recognition", "3000"), moneyEvent("deposit", "deposit_capture", "3000"), moneyEvent("pending-deposit-return", "deposit_return", "500", "pending")];
  const totals = financialTotals(events, "RUB");
  assert.equal(totals.chargesMinor, "9000");
  assert.equal(totals.creditedPaymentsMinor, "5000");
  assert.equal(totals.balanceMinor, "4000");
  assert.equal(totals.earnedRevenueMinor, "3000");
  assert.equal(totals.depositLiabilityMinor, "3000");
  assert.equal(availableRefundMinor([...events, moneyEvent("pending-refund", "payment_refund", "2000", "pending", "payment")], "RUB", "payment"), "3000");
  const reversal = reverseFinancialEvent(events, "earned", "earned-reversal", "source:earned-reversal", NOW);
  assert.equal(financialTotals([...events, reversal], "RUB").earnedRevenueMinor, "0");
  assert.throws(() => financialTotals([...events, events[0]!], "RUB"), { code: "DUPLICATE_SOURCE_KEY" });
  assert.throws(() => financialTotals([...events, moneyEvent("foreign", "lodging_charge", "100", "succeeded")].map((event) => event.id === "foreign" ? { ...event, currency: "USD" } : event), "RUB"), { code: "INVALID_MONEY" });
  assert.equal(depositLiabilityMinor(events, "RUB"), "3000");
  assert.equal(availableDepositMinor(events, "RUB"), "2500");
  assert.throws(() => assertRefundAvailable([...events, moneyEvent("pending-refund", "payment_refund", "2000", "pending", "payment")], "RUB", "payment", "3001"), { code: "REFUND_EXCEEDS_AVAILABLE" });
  assert.throws(() => financialTotals([...events, moneyEvent("refund-excess", "payment_refund", "6000", "pending", "payment")], "RUB"), { code: "REFUND_EXCEEDS_AVAILABLE" });
  const corrupted = { ...events[0]!, entry: { ...events[0]!.entry!, lines: [{ ...events[0]!.entry!.lines[0]!, account: "bank" as const }, { ...events[0]!.entry!.lines[1]! }] } };
  assert.throws(() => financialTotals([corrupted], "RUB"), { code: "INVALID_STATE" });
  assert.throws(() => postLedgerEntry([], { id: "bad", sourceKey: "bad", currency: "RUB", postedAt: NOW, lines: [{ account: "bank", side: "debit", amountMinor: "1" as never }, { account: "guest_receivable", side: "credit", amountMinor: "2" as never }] }), { code: "UNBALANCED_ENTRY" });
});

test("cancellation preview is immutable, versioned, hashed, and does not move money", () => {
  const events = [moneyEvent("charge", "lodging_charge", "10000"), moneyEvent("payment", "payment_capture", "6000")];
  const input: CancellationPreviewInput = { reservationId: "r1", reservationVersion: 5, chargeVersion: 1, paymentVersion: 1, refundVersion: 0, depositVersion: 0, effectiveAt: NOW, currency: "RUB", events, cancellableCharges: [{ chargeEventId: "charge", amountMinor: "10000", recognizedMinor: "0", alreadyCreditedMinor: "0", reason: "Stay not started" }], policy: { version: "p1", kind: "free" } };
  const preview = buildCancellationPreview(input);
  assert.equal(preview.newChargesMinor, "0");
  assert.equal(preview.newCreditedPaymentsMinor, "6000");
  assert.equal(preview.availableRefundMinor, "6000");
  assert.equal(financialTotals(events, "RUB").chargesMinor, "10000", "preview cannot post credit notes");
  assert.doesNotThrow(() => verifyCancellationPreview(preview, input, 5));
  assert.throws(() => verifyCancellationPreview(preview, { ...input, policy: { version: "p2", kind: "free" } }, 5), { code: "PREVIEW_CHANGED" });
  assert.throws(() => verifyCancellationPreview(preview, input, 6), { code: "VERSION_CHANGED" });
  assert.throws(() => buildCancellationPreview({ ...input, override: { feeMinor: "100", reason: "Manual", authorized: true, secondApproval: false } }), { code: "INVALID_RULE" });
  assert.throws(() => buildCancellationPreview({ ...input, cancellableCharges: [{ chargeEventId: "charge", amountMinor: "10000", recognizedMinor: "3000", alreadyCreditedMinor: "0", reason: "Only future nights can be credited" }] }), { code: "INVALID_RULE" });
  const extra = moneyEvent("extra", "service_charge", "1000");
  const twoLines = [{ chargeEventId: "charge", amountMinor: "10000", recognizedMinor: "0", alreadyCreditedMinor: "0", reason: "Stay not started" }, { chargeEventId: "extra", amountMinor: "1000", recognizedMinor: "0", alreadyCreditedMinor: "0", reason: "Service not delivered" }];
  const forward = buildCancellationPreview({ ...input, events: [...events, extra], cancellableCharges: twoLines });
  const reversed = buildCancellationPreview({ ...input, events: [extra, ...events], cancellableCharges: [...twoLines].reverse() });
  assert.equal(forward.hash, reversed.hash, "snapshot hash is stable when input collection order differs");
});
