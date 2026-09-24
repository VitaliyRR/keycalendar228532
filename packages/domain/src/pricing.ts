import { assertDomain } from "./errors.js";
import { nightDates, parseInstant, parseLocalDate, stayRange, type LocalDate, type StayRange } from "./dates.js";
import { allocateLargestRemainder, parseMinor, percentMinor, serializeMinor, validateBps, validateCurrency, type Minor } from "./money.js";

export type RateOrigin = "day_override" | "season" | "weekday" | "base";
export interface RateValue { readonly ruleId: string; readonly version: number; readonly amountMinor: string }
export interface NightRate {
  readonly date: string;
  readonly base: RateValue;
  readonly dayOverride?: RateValue;
  readonly season?: RateValue;
  readonly weekday?: RateValue;
  readonly guestSurchargeMinor?: string;
  readonly stopSell?: boolean;
  readonly closedToArrival?: boolean;
  readonly minStay?: number;
  readonly maxStay?: number;
  readonly allowedSources?: readonly string[];
}
export interface QuoteService { readonly id: string; readonly description: string; readonly amountMinor: string; readonly serviceDate?: string; readonly ruleId: string; readonly version: number }
export interface QuoteInput {
  readonly id: string;
  readonly ratePlanId: string;
  readonly rateVersionHash: string;
  readonly unitId?: string;
  readonly categoryId?: string;
  readonly categoryRateMapped?: boolean;
  readonly stay: StayRange;
  readonly currency: string;
  readonly source: string;
  readonly expiresAt: string;
  readonly nights: readonly NightRate[];
  readonly closedToDeparture?: boolean;
  readonly lengthDiscount?: { readonly bps: number; readonly ruleId: string; readonly version: number };
  readonly promo?: { readonly bps: number; readonly ruleId: string; readonly version: number; readonly compatibleWithLengthDiscount: boolean };
  readonly manualDiscount?: { readonly amountMinor: string; readonly reason: string; readonly authorized: boolean; readonly ruleId: string; readonly version: number };
  readonly channelMarkup?: { readonly bps: number; readonly ruleId: string; readonly version: number };
  readonly services?: readonly QuoteService[];
}

export type QuoteLineKind = "lodging" | "guest_surcharge" | "length_discount" | "promo_discount" | "manual_discount" | "channel_markup" | "service";
export interface QuoteLine {
  readonly id: string;
  readonly date?: LocalDate;
  readonly kind: QuoteLineKind;
  readonly description: string;
  readonly quantity: 1;
  readonly unitAmountMinor: Minor;
  readonly totalMinor: Minor;
  readonly ruleId: string;
  readonly ruleVersion: number;
}
export interface Quote {
  readonly id: string;
  readonly ratePlanId: string;
  readonly rateVersionHash: string;
  readonly unitId?: string;
  readonly categoryId?: string;
  readonly stay: StayRange;
  readonly currency: string;
  readonly source: string;
  readonly expiresAt: string;
  readonly lines: readonly QuoteLine[];
  readonly lodgingTotalMinor: Minor;
  readonly servicesTotalMinor: Minor;
  readonly totalMinor: Minor;
}

function requireRate(rate: RateValue): bigint {
  assertDomain(!!rate.ruleId && Number.isSafeInteger(rate.version) && rate.version > 0, "INVALID_RULE", "Rate must identify its versioned rule");
  const amount = parseMinor(rate.amountMinor);
  assertDomain(amount >= 0n, "INVALID_RULE", "Night rate cannot be negative");
  return amount;
}

function selectedRate(night: NightRate): { rate: RateValue; origin: RateOrigin } {
  if (night.dayOverride) return { rate: night.dayOverride, origin: "day_override" };
  if (night.season) return { rate: night.season, origin: "season" };
  if (night.weekday) return { rate: night.weekday, origin: "weekday" };
  return { rate: night.base, origin: "base" };
}

function addLine(lines: QuoteLine[], input: { id: string; date?: LocalDate; kind: QuoteLineKind; description: string; amount: bigint; ruleId: string; version: number }): void {
  assertDomain(!!input.ruleId && Number.isSafeInteger(input.version) && input.version > 0, "INVALID_RULE", "Quote line requires versioned rule");
  const minor = serializeMinor(input.amount);
  lines.push(Object.freeze({ id: input.id, ...(input.date ? { date: input.date } : {}), kind: input.kind, description: input.description, quantity: 1, unitAmountMinor: minor, totalMinor: minor, ruleId: input.ruleId, ruleVersion: input.version }));
}

export function buildQuote(input: QuoteInput): Quote {
  assertDomain(!!input.id && !!input.ratePlanId && !!input.rateVersionHash && !!input.source, "INVALID_RULE", "Quote identity, plan, version and source are required");
  assertDomain(!!input.unitId !== !!input.categoryId, "INVALID_RULE", "Quote must target a unit or category");
  if (input.categoryId) assertDomain(input.categoryRateMapped, "RATE_MAPPING_REQUIRED", "Category has no unambiguous assigned rate");
  parseInstant(input.expiresAt);
  validateCurrency(input.currency);
  const stay = Object.freeze(stayRange(input.stay.from, input.stay.to));
  const dates = nightDates(stay);
  assertDomain(input.nights.length === dates.length, "RATE_UNAVAILABLE", "Every stay night needs a rate");
  assertDomain(!input.closedToDeparture, "RATE_UNAVAILABLE", "Checkout date is closed to departure");
  const lines: QuoteLine[] = [];
  const netByDate = new Map<string, bigint>();
  for (let i = 0; i < dates.length; i++) {
    const day = dates[i]!;
    const rate = input.nights[i]!;
    assertDomain(parseLocalDate(rate.date) === day, "RATE_UNAVAILABLE", "Rates must cover each consecutive night");
    assertDomain(!rate.stopSell, "RATE_UNAVAILABLE", "Stop-sell night cannot be quoted");
    assertDomain(!(i === 0 && rate.closedToArrival), "RATE_UNAVAILABLE", "Arrival date is closed");
    assertDomain(rate.minStay === undefined || (Number.isInteger(rate.minStay) && rate.minStay >= 1 && dates.length >= rate.minStay), "RATE_UNAVAILABLE", "Minimum stay restriction failed");
    assertDomain(rate.maxStay === undefined || (Number.isInteger(rate.maxStay) && rate.maxStay >= 1 && dates.length <= rate.maxStay), "RATE_UNAVAILABLE", "Maximum stay restriction failed");
    assertDomain(rate.allowedSources === undefined || rate.allowedSources.includes(input.source), "RATE_UNAVAILABLE", "Source is not allowed by rate");
    const { rate: selected, origin } = selectedRate(rate);
    const base = requireRate(selected);
    addLine(lines, { id: `${day}:lodging`, date: day, kind: "lodging", description: origin, amount: base, ruleId: selected.ruleId, version: selected.version });
    const surcharge = parseMinor(rate.guestSurchargeMinor ?? "0");
    assertDomain(surcharge >= 0n, "INVALID_RULE", "Guest surcharge cannot be negative");
    if (surcharge) addLine(lines, { id: `${day}:guest`, date: day, kind: "guest_surcharge", description: "Guest composition", amount: surcharge, ruleId: selected.ruleId, version: selected.version });
    netByDate.set(day, base + surcharge);
  }
  const totalOfDates = () => [...netByDate.values()].reduce((sum, value) => sum + value, 0n);
  const applyDiscount = (kind: "length_discount" | "promo_discount" | "manual_discount", amount: bigint, ruleId: string, version: number) => {
    assertDomain(amount >= 0n && amount <= totalOfDates(), "INVALID_RULE", "Discount exceeds eligible lodging");
    const distribution = allocateLargestRemainder(amount, dates.map((date) => ({ id: `${date}:${kind}`, weightMinor: serializeMinor(netByDate.get(date)!) })));
    for (const date of dates) {
      const share = parseMinor(distribution.get(`${date}:${kind}`)!);
      if (share > 0n) {
        addLine(lines, { id: `${date}:${kind}`, date, kind, description: kind.replaceAll("_", " "), amount: -share, ruleId, version });
        netByDate.set(date, netByDate.get(date)! - share);
      }
    }
  };
  if (input.lengthDiscount) {
    validateBps(input.lengthDiscount.bps);
    applyDiscount("length_discount", percentMinor(totalOfDates(), input.lengthDiscount.bps), input.lengthDiscount.ruleId, input.lengthDiscount.version);
  }
  if (input.promo) {
    validateBps(input.promo.bps);
    assertDomain(!input.lengthDiscount || input.promo.compatibleWithLengthDiscount, "INVALID_RULE", "Promo is incompatible with length discount");
    applyDiscount("promo_discount", percentMinor(totalOfDates(), input.promo.bps), input.promo.ruleId, input.promo.version);
  }
  if (input.manualDiscount) {
    assertDomain(input.manualDiscount.authorized && !!input.manualDiscount.reason.trim(), "INVALID_RULE", "Manual discount requires permission and reason");
    applyDiscount("manual_discount", parseMinor(input.manualDiscount.amountMinor), input.manualDiscount.ruleId, input.manualDiscount.version);
  }
  if (input.channelMarkup) {
    validateBps(input.channelMarkup.bps);
    const markup = percentMinor(totalOfDates(), input.channelMarkup.bps);
    const distribution = allocateLargestRemainder(markup, dates.map((date) => ({ id: `${date}:markup`, weightMinor: serializeMinor(netByDate.get(date)!) })));
    for (const date of dates) {
      const share = parseMinor(distribution.get(`${date}:markup`)!);
      if (share > 0n) addLine(lines, { id: `${date}:markup`, date, kind: "channel_markup", description: "Channel markup", amount: share, ruleId: input.channelMarkup.ruleId, version: input.channelMarkup.version });
    }
  }
  for (const service of input.services ?? []) {
    assertDomain(!!service.id && !!service.description, "INVALID_RULE", "Service identity and description are required");
    const amount = parseMinor(service.amountMinor);
    assertDomain(amount >= 0n, "INVALID_RULE", "Service price cannot be negative");
    addLine(lines, { id: `service:${service.id}`, ...(service.serviceDate ? { date: parseLocalDate(service.serviceDate) } : {}), kind: "service", description: service.description, amount, ruleId: service.ruleId, version: service.version });
  }
  assertDomain(new Set(lines.map((line) => line.id)).size === lines.length, "INVALID_RULE", "Quote line IDs must be unique");
  const lodging = lines.filter((line) => line.kind !== "service").reduce((sum, line) => sum + parseMinor(line.totalMinor), 0n);
  const services = lines.filter((line) => line.kind === "service").reduce((sum, line) => sum + parseMinor(line.totalMinor), 0n);
  assertDomain(lodging >= 0n, "INVALID_RULE", "Lodging total cannot be negative");
  return Object.freeze({ id: input.id, ratePlanId: input.ratePlanId, rateVersionHash: input.rateVersionHash, ...(input.unitId ? { unitId: input.unitId } : { categoryId: input.categoryId! }), stay, currency: input.currency, source: input.source, expiresAt: input.expiresAt, lines: Object.freeze(lines), lodgingTotalMinor: serializeMinor(lodging), servicesTotalMinor: serializeMinor(services), totalMinor: serializeMinor(lodging + services) });
}

export function assertQuoteCurrent(quote: Quote, at: string, expectedRateVersionHash: string): void {
  assertDomain(parseInstant(at) < parseInstant(quote.expiresAt), "RATE_UNAVAILABLE", "Quote has expired");
  assertDomain(quote.rateVersionHash === expectedRateVersionHash, "RATE_UNAVAILABLE", "Rate rules have changed since quote");
}

export interface NightRevenue { readonly date: LocalDate; readonly amountMinor: Minor }

export function recognizeNights(quote: Quote, throughDateExclusive: string): readonly NightRevenue[] {
  const until = parseLocalDate(throughDateExclusive);
  const daily = new Map<LocalDate, bigint>();
  for (const line of quote.lines) {
    if (line.kind === "service") continue;
    assertDomain(!!line.date, "INVALID_RULE", "Lodging quote line must identify a night");
    if (line.date < until) daily.set(line.date, (daily.get(line.date) ?? 0n) + parseMinor(line.totalMinor));
  }
  return Object.freeze([...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => Object.freeze({ date, amountMinor: serializeMinor(amount) })));
}
