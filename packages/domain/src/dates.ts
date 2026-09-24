import { assertDomain } from "./errors.js";

export type LocalDate = string & { readonly __localDate: unique symbol };
export interface StayRange { readonly from: LocalDate; readonly to: LocalDate }

const DAY_MS = 86_400_000;

export function parseLocalDate(value: string): LocalDate {
  assertDomain(/^\d{4}-\d{2}-\d{2}$/.test(value), "INVALID_DATE", "Local date must be YYYY-MM-DD");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  assertDomain(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31, "INVALID_DATE", "Invalid local calendar date");
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  assertDomain(parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day, "INVALID_DATE", "Invalid local calendar date");
  return value as LocalDate;
}

export function epochDay(value: string): number {
  const date = parseLocalDate(value);
  const parsed = new Date(0);
  parsed.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  parsed.setUTCHours(0, 0, 0, 0);
  return Math.floor(parsed.getTime() / DAY_MS);
}

export function addDays(value: string, days: number): LocalDate {
  assertDomain(Number.isSafeInteger(days), "INVALID_DATE", "Day offset must be a safe integer");
  const date = new Date((epochDay(value) + days) * DAY_MS);
  assertDomain(date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999, "INVALID_DATE", "Date is outside supported range");
  return parseLocalDate(`${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`);
}

export function nightsBetween(from: string, to: string): number {
  const nights = epochDay(to) - epochDay(from);
  assertDomain(nights > 0, "INVALID_RANGE", "Checkout must follow checkin");
  return nights;
}

export function stayRange(from: string, to: string): StayRange {
  nightsBetween(from, to);
  return { from: parseLocalDate(from), to: parseLocalDate(to) };
}

export function rangesOverlap(a: StayRange, b: StayRange): boolean {
  nightsBetween(a.from, a.to);
  nightsBetween(b.from, b.to);
  return a.from < b.to && b.from < a.to;
}

export function effectiveStayRange(range: StayRange, bufferBeforeDays = 0, bufferAfterDays = 0): StayRange {
  assertDomain(Number.isSafeInteger(bufferBeforeDays) && bufferBeforeDays >= 0 && Number.isSafeInteger(bufferAfterDays) && bufferAfterDays >= 0, "INVALID_RANGE", "Buffers must be non-negative whole days");
  nightsBetween(range.from, range.to);
  return stayRange(addDays(range.from, -bufferBeforeDays), addDays(range.to, bufferAfterDays));
}

export function nightDates(range: StayRange): LocalDate[] {
  const nights = nightsBetween(range.from, range.to);
  return Array.from({ length: nights }, (_, index) => addDays(range.from, index));
}

export function parseInstant(value: string): number {
  assertDomain(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), "INVALID_DATE", "Instant must be UTC ISO-8601");
  const result = Date.parse(value);
  const fraction = value.includes(".") ? value.slice(value.indexOf("."), -1).slice(1).padEnd(3, "0") : "000";
  const canonical = `${value.slice(0, 19)}.${fraction}Z`;
  assertDomain(Number.isFinite(result) && new Date(result).toISOString() === canonical, "INVALID_DATE", "Invalid UTC instant");
  return result;
}
