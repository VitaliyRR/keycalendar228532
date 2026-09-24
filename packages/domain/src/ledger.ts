import { assertDomain } from "./errors.js";
import { parseInstant } from "./dates.js";
import { parseMinor, serializeMinor, validateCurrency, type Minor } from "./money.js";

export type LedgerAccount =
  | "guest_receivable" | "deferred_lodging_revenue" | "deferred_service_revenue"
  | "lodging_revenue" | "service_revenue" | "cancellation_fee_revenue"
  | "bank" | "guest_advances" | "deposit_liability" | "damage_compensation"
  | "channel_receivable" | "channel_commission_expense" | "channel_payable";
export type LedgerSide = "debit" | "credit";
export interface LedgerLine { readonly account: LedgerAccount; readonly side: LedgerSide; readonly amountMinor: Minor }
export interface LedgerEntry {
  readonly id: string;
  readonly sourceKey: string;
  readonly currency: string;
  readonly postedAt: string;
  readonly lines: readonly LedgerLine[];
  readonly reversalOfId?: string;
}

export function postLedgerEntry(existing: readonly LedgerEntry[], draft: LedgerEntry): LedgerEntry {
  assertDomain(!!draft.id && !!draft.sourceKey && !existing.some((entry) => entry.id === draft.id || entry.sourceKey === draft.sourceKey), "DUPLICATE_SOURCE_KEY", "Ledger source key or ID was already posted");
  validateCurrency(draft.currency);
  parseInstant(draft.postedAt);
  assertDomain(draft.lines.length >= 2, "UNBALANCED_ENTRY", "Ledger entry requires at least two lines");
  let debit = 0n;
  let credit = 0n;
  for (const line of draft.lines) {
    const amount = parseMinor(line.amountMinor);
    assertDomain(amount > 0n, "INVALID_MONEY", "Ledger line amount must be positive");
    if (line.side === "debit") debit += amount;
    else if (line.side === "credit") credit += amount;
    else assertDomain(false, "UNBALANCED_ENTRY", "Unknown ledger side");
  }
  assertDomain(debit === credit, "UNBALANCED_ENTRY", "Debit and credit must balance per currency");
  if (draft.reversalOfId) {
    const original = existing.find((entry) => entry.id === draft.reversalOfId);
    assertDomain(!!original && original.currency === draft.currency, "INVALID_STATE", "Reversal target not found in same currency");
    assertDomain(!existing.some((entry) => entry.reversalOfId === draft.reversalOfId), "INVALID_STATE", "Entry already reversed");
    assertDomain(original.lines.length === draft.lines.length && original.lines.every((line, index) => {
      const inverse = draft.lines[index];
      return !!inverse && line.account === inverse.account && line.amountMinor === inverse.amountMinor && line.side !== inverse.side;
    }), "UNBALANCED_ENTRY", "Reversal must exactly invert the original entry");
  }
  return Object.freeze({ ...draft, lines: Object.freeze([...draft.lines].map((line) => Object.freeze({ ...line }))) });
}

export function reverseLedgerEntry(existing: readonly LedgerEntry[], originalId: string, id: string, sourceKey: string, postedAt: string): LedgerEntry {
  const original = existing.find((entry) => entry.id === originalId);
  assertDomain(!!original, "INVALID_STATE", "Original entry was not found");
  assertDomain(!original.reversalOfId, "INVALID_STATE", "Cannot reverse a reversal");
  return postLedgerEntry(existing, {
    id, sourceKey, currency: original.currency, postedAt, reversalOfId: original.id,
    lines: original.lines.map((line) => ({ account: line.account, side: line.side === "debit" ? "credit" : "debit", amountMinor: line.amountMinor })),
  });
}

export type FinancialEventKind =
  | "lodging_charge" | "service_charge" | "fee_charge"
  | "lodging_credit_note" | "service_credit_note"
  | "recognized_lodging_credit_note" | "recognized_service_credit_note"
  | "payment_capture" | "channel_payment_capture" | "payment_refund"
  | "advance_capture" | "apply_advance" | "advance_refund"
  | "deposit_capture" | "deposit_return" | "deposit_retain"
  | "night_recognition" | "service_recognition" | "channel_commission";
export type FinancialEventStatus = "pending" | "succeeded" | "failed";
export interface FinancialEvent {
  readonly id: string;
  readonly sourceKey: string;
  readonly kind: FinancialEventKind;
  readonly status: FinancialEventStatus;
  readonly amountMinor: Minor;
  readonly currency: string;
  readonly at: string;
  readonly entry?: LedgerEntry;
  readonly relatedPaymentId?: string;
  readonly reversalOfId?: string;
}
export interface FinancialEventInput {
  readonly id: string;
  readonly sourceKey: string;
  readonly kind: FinancialEventKind;
  readonly status: FinancialEventStatus;
  readonly amountMinor: string;
  readonly currency: string;
  readonly at: string;
  readonly relatedPaymentId?: string;
}

const postings: Readonly<Record<FinancialEventKind, readonly [LedgerAccount, LedgerAccount]>> = {
  lodging_charge: ["guest_receivable", "deferred_lodging_revenue"],
  service_charge: ["guest_receivable", "deferred_service_revenue"],
  fee_charge: ["guest_receivable", "cancellation_fee_revenue"],
  lodging_credit_note: ["deferred_lodging_revenue", "guest_receivable"],
  service_credit_note: ["deferred_service_revenue", "guest_receivable"],
  recognized_lodging_credit_note: ["lodging_revenue", "guest_receivable"],
  recognized_service_credit_note: ["service_revenue", "guest_receivable"],
  payment_capture: ["bank", "guest_receivable"],
  channel_payment_capture: ["channel_receivable", "guest_receivable"],
  payment_refund: ["guest_receivable", "bank"],
  advance_capture: ["bank", "guest_advances"],
  apply_advance: ["guest_advances", "guest_receivable"],
  advance_refund: ["guest_advances", "bank"],
  deposit_capture: ["bank", "deposit_liability"],
  deposit_return: ["deposit_liability", "bank"],
  deposit_retain: ["deposit_liability", "damage_compensation"],
  night_recognition: ["deferred_lodging_revenue", "lodging_revenue"],
  service_recognition: ["deferred_service_revenue", "service_revenue"],
  channel_commission: ["channel_commission_expense", "channel_payable"],
};

export function createFinancialEvent(input: FinancialEventInput): FinancialEvent {
  assertDomain(!!input.id && !!input.sourceKey, "INVALID_STATE", "Financial event identity is required");
  const amount = parseMinor(input.amountMinor);
  assertDomain(amount > 0n, "INVALID_MONEY", "Financial event amount must be positive");
  validateCurrency(input.currency);
  parseInstant(input.at);
  assertDomain(input.status === "pending" || input.status === "succeeded" || input.status === "failed", "INVALID_STATE", "Unknown financial event status");
  const refund = input.kind === "payment_refund" || input.kind === "advance_refund";
  assertDomain(!refund || !!input.relatedPaymentId, "INVALID_STATE", "Refund requires original payment ID");
  const [debit, credit] = postings[input.kind];
  assertDomain(!!debit && !!credit, "INVALID_STATE", "Unsupported financial event kind");
  const entry = input.status === "succeeded" ? postLedgerEntry([], {
    id: `entry:${input.id}`, sourceKey: input.sourceKey, currency: input.currency, postedAt: input.at,
    lines: [
      { account: debit, side: "debit", amountMinor: serializeMinor(amount) },
      { account: credit, side: "credit", amountMinor: serializeMinor(amount) },
    ],
  }) : undefined;
  return Object.freeze({ id: input.id, sourceKey: input.sourceKey, kind: input.kind, status: input.status, amountMinor: serializeMinor(amount), currency: input.currency, at: input.at, ...(input.relatedPaymentId ? { relatedPaymentId: input.relatedPaymentId } : {}), ...(entry ? { entry } : {}) });
}

export function reverseFinancialEvent(existing: readonly FinancialEvent[], originalId: string, id: string, sourceKey: string, at: string): FinancialEvent {
  const original = existing.find((event) => event.id === originalId);
  assertDomain(!!original && original.status === "succeeded" && !!original.entry, "INVALID_STATE", "Only posted financial events can be reversed");
  assertDomain(!existing.some((event) => event.id === id || event.sourceKey === sourceKey), "DUPLICATE_SOURCE_KEY", "Reversal identity was already used");
  assertDomain(!original.reversalOfId && !existing.some((event) => event.reversalOfId === originalId), "INVALID_STATE", "Financial event already reversed");
  const entries = existing.flatMap((event) => event.entry ? [event.entry] : []);
  const entry = reverseLedgerEntry(entries, original.entry.id, `entry:${id}`, sourceKey, at);
  return Object.freeze({ id, sourceKey, kind: original.kind, status: "succeeded", amountMinor: original.amountMinor, currency: original.currency, at, reversalOfId: originalId, ...(original.relatedPaymentId ? { relatedPaymentId: original.relatedPaymentId } : {}), entry });
}

export type PaymentStatus = "not_required" | "unpaid" | "partial" | "paid" | "overpaid";
export interface FinancialTotals {
  readonly currency: string;
  readonly chargesMinor: Minor;
  readonly creditedPaymentsMinor: Minor;
  readonly balanceMinor: Minor;
  readonly earnedRevenueMinor: Minor;
  readonly depositLiabilityMinor: Minor;
  readonly paymentStatus: PaymentStatus;
}

export function paymentStatus(chargesMinor: string | bigint, creditedPaymentsMinor: string | bigint): PaymentStatus {
  const charges = parseMinor(chargesMinor);
  const paid = parseMinor(creditedPaymentsMinor);
  if (charges === 0n && paid <= 0n) return "not_required";
  if (paid > charges) return "overpaid";
  if (paid === charges) return "paid";
  if (paid <= 0n) return "unpaid";
  return "partial";
}

function validateFinancialEvents(events: readonly FinancialEvent[], currency: string): void {
  validateCurrency(currency);
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const entries: LedgerEntry[] = [];
  for (const event of events) {
    assertDomain(event.currency === currency, "INVALID_MONEY", "Cannot aggregate different currencies");
    const amount = parseMinor(event.amountMinor);
    assertDomain(amount > 0n && !!postings[event.kind], "INVALID_MONEY", "Financial event kind and amount are invalid");
    assertDomain(!seenIds.has(event.id) && !seenKeys.has(event.sourceKey), "DUPLICATE_SOURCE_KEY", "Financial event was counted twice");
    seenIds.add(event.id);
    seenKeys.add(event.sourceKey);
    if (event.status === "succeeded") {
      assertDomain(!!event.entry, "INVALID_STATE", "Successful financial event must have posted entry");
      assertDomain(event.entry.currency === event.currency && event.entry.sourceKey === event.sourceKey && event.entry.postedAt === event.at, "INVALID_STATE", "Ledger entry does not match financial event");
      if (!event.reversalOfId) {
        const [debit, credit] = postings[event.kind];
        assertDomain(event.entry.lines.length === 2 && event.entry.lines[0]?.account === debit && event.entry.lines[0]?.side === "debit" && event.entry.lines[0]?.amountMinor === event.amountMinor && event.entry.lines[1]?.account === credit && event.entry.lines[1]?.side === "credit" && event.entry.lines[1]?.amountMinor === event.amountMinor, "INVALID_STATE", "Financial event has an incorrect account mapping");
      }
      entries.push(postLedgerEntry(entries, event.entry));
    } else assertDomain(!event.entry, "INVALID_STATE", "Pending/failed event cannot have posted entry");
    if (event.reversalOfId) {
      const original = events.find((candidate) => candidate.id === event.reversalOfId);
      assertDomain(!!original && original.status === "succeeded" && !!original.entry && original.kind === event.kind && original.amountMinor === event.amountMinor && event.entry?.reversalOfId === original.entry.id, "INVALID_STATE", "Reversal does not match the original financial event");
    }
  }
  for (const payment of events.filter((event) => event.kind === "payment_capture" || event.kind === "advance_capture" || event.kind === "channel_payment_capture")) {
    if (payment.status !== "succeeded") continue;
    const refunds = events.filter((event) => event.relatedPaymentId === payment.id && event.status !== "failed" && !event.reversalOfId && !events.some((other) => other.reversalOfId === event.id) && (event.kind === "payment_refund" || event.kind === "advance_refund"));
    const reserved = refunds.reduce((sum, event) => sum + parseMinor(event.amountMinor), 0n);
    const reversal = events.some((event) => event.reversalOfId === payment.id);
    assertDomain(reserved <= (reversal ? 0n : parseMinor(payment.amountMinor)), "REFUND_EXCEEDS_AVAILABLE", "Refunds including pending exceed captured payment");
  }
  for (const refund of events.filter((event) => event.kind === "payment_refund" || event.kind === "advance_refund")) {
    const original = events.find((event) => event.id === refund.relatedPaymentId);
    assertDomain(!!original && original.status === "succeeded" && (refund.kind === "advance_refund" ? original.kind === "advance_capture" : original.kind === "payment_capture" || original.kind === "channel_payment_capture"), "INVALID_STATE", "Refund must reference a compatible captured payment");
  }
}

export function financialTotals(events: readonly FinancialEvent[], currency: string): FinancialTotals {
  validateFinancialEvents(events, currency);
  let charges = 0n;
  let paid = 0n;
  let revenue = 0n;
  let deposit = 0n;
  for (const event of events) {
    if (event.status !== "succeeded") continue;
    const amount = parseMinor(event.amountMinor) * (event.reversalOfId ? -1n : 1n);
    switch (event.kind) {
      case "lodging_charge": case "service_charge": case "fee_charge": charges += amount; break;
      case "lodging_credit_note": case "service_credit_note": case "recognized_lodging_credit_note": case "recognized_service_credit_note": charges -= amount; break;
      case "payment_capture": case "channel_payment_capture": case "apply_advance": paid += amount; break;
      case "payment_refund": paid -= amount; break;
    }
    switch (event.kind) {
      case "fee_charge": case "night_recognition": case "service_recognition": revenue += amount; break;
      case "recognized_lodging_credit_note": case "recognized_service_credit_note": revenue -= amount; break;
    }
    switch (event.kind) {
      case "deposit_capture": deposit += amount; break;
      case "deposit_return": case "deposit_retain": deposit -= amount; break;
    }
  }
  assertDomain(paid >= 0n, "INVALID_MONEY", "Credited payment balance cannot be negative");
  assertDomain(deposit >= 0n, "INVALID_MONEY", "Deposit liability cannot be negative");
  return Object.freeze({ currency, chargesMinor: serializeMinor(charges), creditedPaymentsMinor: serializeMinor(paid), balanceMinor: serializeMinor(charges - paid), earnedRevenueMinor: serializeMinor(revenue), depositLiabilityMinor: serializeMinor(deposit), paymentStatus: paymentStatus(charges, paid) });
}

export function availableRefundMinor(events: readonly FinancialEvent[], currency: string, originalPaymentId: string): Minor {
  validateFinancialEvents(events, currency);
  const payment = events.find((event) => event.id === originalPaymentId);
  assertDomain(!!payment && payment.status === "succeeded" && (payment.kind === "payment_capture" || payment.kind === "advance_capture"), "INVALID_STATE", "Successful original payment was not found");
  const refunded = events.filter((event) => event.relatedPaymentId === originalPaymentId && (event.kind === "payment_refund" || event.kind === "advance_refund") && event.status !== "failed" && !event.reversalOfId && !events.some((other) => other.reversalOfId === event.id)).reduce((sum, event) => sum + parseMinor(event.amountMinor), 0n);
  const available = parseMinor(payment.amountMinor) - refunded;
  assertDomain(available >= 0n, "REFUND_EXCEEDS_AVAILABLE", "Refunds including pending exceed payment");
  return serializeMinor(available);
}

export function assertRefundAvailable(events: readonly FinancialEvent[], currency: string, originalPaymentId: string, requestedMinor: string): void {
  const requested = parseMinor(requestedMinor);
  assertDomain(requested > 0n && requested <= parseMinor(availableRefundMinor(events, currency, originalPaymentId)), "REFUND_EXCEEDS_AVAILABLE", "Requested refund exceeds unreserved captured payment");
}

export function depositLiabilityMinor(events: readonly FinancialEvent[], currency: string): Minor {
  return financialTotals(events, currency).depositLiabilityMinor;
}

export function availableDepositMinor(events: readonly FinancialEvent[], currency: string): Minor {
  const open = parseMinor(depositLiabilityMinor(events, currency));
  const pending = events.filter((event) => event.status === "pending" && (event.kind === "deposit_return" || event.kind === "deposit_retain")).reduce((sum, event) => sum + parseMinor(event.amountMinor), 0n);
  assertDomain(pending <= open, "REFUND_EXCEEDS_AVAILABLE", "Pending deposit decisions exceed open liability");
  return serializeMinor(open - pending);
}
