/** Error codes are safe to log. Never include a feed URL, body, UID or guest text. */
export class ConnectorError extends Error {
  constructor(public readonly code: string, public readonly retryable = false, public readonly retryAfterMs: number | null = null) {
    super(code);
    this.name = 'ConnectorError';
  }
}

export function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ConnectorError(code);
}
