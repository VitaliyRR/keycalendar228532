import { assertDomain } from "./errors.js";

export type Minor = string & { readonly __minor: unique symbol };
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

export function parseMinor(value: string | bigint): bigint {
  assertDomain(typeof value === "bigint" || (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value)), "INVALID_MONEY", "Money must be a decimal integer string or bigint");
  const parsed = BigInt(value);
  assertDomain(parsed >= MIN_INT64 && parsed <= MAX_INT64, "INVALID_MONEY", "Money exceeds signed int64");
  return parsed;
}

export function serializeMinor(value: bigint): Minor {
  return parseMinor(value).toString() as Minor;
}

export function validateCurrency(value: string): string {
  assertDomain(/^[A-Z]{3}$/.test(value), "INVALID_MONEY", "Currency must be an uppercase ISO code");
  return value;
}

export function validateBps(value: number): number {
  assertDomain(Number.isInteger(value) && value >= 0 && value <= 10_000, "INVALID_RULE", "Basis points must be 0..10000");
  return value;
}

export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  assertDomain(denominator > 0n, "INVALID_RULE", "Divisor must be positive");
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

export function percentMinor(amount: bigint, basisPoints: number): bigint {
  validateBps(basisPoints);
  return roundHalfUp(amount * BigInt(basisPoints), 10_000n);
}

export interface WeightedLine { readonly id: string; readonly weightMinor: string }

export function allocateLargestRemainder(totalMinor: string | bigint, lines: readonly WeightedLine[]): ReadonlyMap<string, Minor> {
  const total = parseMinor(totalMinor);
  assertDomain(total >= 0n, "INVALID_MONEY", "Distributed amount must be nonnegative");
  assertDomain(new Set(lines.map((line) => line.id)).size === lines.length, "INVALID_RULE", "Distribution IDs must be unique");
  const weights = lines.map((line) => ({ id: line.id, value: parseMinor(line.weightMinor) }));
  assertDomain(weights.every((line) => line.value >= 0n), "INVALID_MONEY", "Distribution weights must be nonnegative");
  const sumWeights = weights.reduce((sum, line) => sum + line.value, 0n);
  assertDomain(total === 0n || sumWeights > 0n, "INVALID_RULE", "Cannot distribute onto zero weight");
  if (sumWeights === 0n) return new Map(weights.map((line) => [line.id, serializeMinor(0n)]));
  const apportioned = weights.map((line) => {
    const numerator = total * line.value;
    return { id: line.id, whole: numerator / sumWeights, remainder: numerator % sumWeights };
  });
  let unassigned = total - apportioned.reduce((sum, line) => sum + line.whole, 0n);
  apportioned.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const line of apportioned) {
    if (unassigned <= 0n) break;
    line.whole += 1n;
    unassigned -= 1n;
  }
  return new Map(apportioned.map((line) => [line.id, serializeMinor(line.whole)]));
}
