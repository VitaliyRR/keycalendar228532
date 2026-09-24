export type DomainErrorCode =
  | "INVALID_DATE"
  | "INVALID_RANGE"
  | "INVALID_MONEY"
  | "INVALID_RULE"
  | "INVALID_STATE"
  | "VERSION_CHANGED"
  | "AVAILABILITY_CONFLICT"
  | "RATE_MAPPING_REQUIRED"
  | "RATE_UNAVAILABLE"
  | "DUPLICATE_SOURCE_KEY"
  | "UNBALANCED_ENTRY"
  | "REFUND_EXCEEDS_AVAILABLE"
  | "PREVIEW_CHANGED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function assertDomain(condition: unknown, code: DomainErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
