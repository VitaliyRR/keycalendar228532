import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { ConnectorError, invariant } from './errors.js';

export interface ResolvedAddress { address: string; family: number }
export type FeedResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;
/** Conservative public-unicast allow policy; special-use and transition ranges are rejected. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    if (address.includes('%') || address.includes('.')) return false;
    const [first = 0, second = 0] = address.toLowerCase().split(':').slice(0, 2).map(v => parseInt(v || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  return false;
}
/** Returns a secret URL object: never log/serialize it in application diagnostics. */
export function validateFeedUrl(input: string): URL {
  invariant(typeof input === 'string' && input.length <= 4096 && !/[\x00-\x20\x7f]/.test(input), 'INVALID_FEED_URL');
  let url: URL;
  try { url = new URL(input); } catch { throw new ConnectorError('INVALID_FEED_URL'); }
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443'), 'UNSAFE_FEED_URL');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  invariant(!host.endsWith('.') && !host.includes('%'), 'UNSAFE_FEED_HOST');
  if (isIP(host)) invariant(isPublicAddress(host), 'UNSAFE_FEED_ADDRESS');
  else invariant(host.includes('.') && !/(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(host), 'UNSAFE_FEED_HOST');
  return url;
}
const systemResolver: FeedResolver = hostname => lookup(hostname, { all: true, verbatim: true });
export async function resolveFeedTarget(input: string, resolver: FeedResolver = systemResolver): Promise<{ url: URL; addresses: readonly ResolvedAddress[] }> {
  const url = validateFeedUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: readonly ResolvedAddress[];
  try { addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host); }
  catch { throw new ConnectorError('FEED_DNS_FAILED', true); }
  invariant(addresses.length > 0 && addresses.every(a => isPublicAddress(a.address) && a.family === isIP(a.address)), 'UNSAFE_FEED_DNS');
  return { url, addresses };
}
export interface FeedFetchOptions {
  maxBytes?: number; timeoutMs?: number; maxRedirects?: number;
  etag?: string; lastModified?: string; signal?: AbortSignal;
  /** Inject only a trusted DNS implementation; transport always pins its vetted answer. */
  resolver?: FeedResolver;
}
export type FeedFetchResult =
  | { status: 'not_modified'; fetchedAt: string }
  | { status: 'ok'; text: string; etag: string | null; lastModified: string | null; fetchedAt: string };
interface Response { status: number; location: string | null; body: Buffer; etag: string | null; lastModified: string | null; retryAfterMs: number | null }
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const result = /^\d+$/.test(value.trim()) ? Number(value.trim()) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(result) && now + result <= 8_640_000_000_000_000 ? Math.max(0, result) : null;
}

function pinnedRequest(url: URL, address: ResolvedAddress, signal: AbortSignal, maxBytes: number, conditional: { etag?: string; lastModified?: string }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const headers: Record<string, string> = { Host: url.host, Accept: 'text/calendar, text/plain;q=0.8', 'Accept-Encoding': 'identity', 'User-Agent': 'KeyCalendar-iCal/1.0' };
    if (conditional.etag) headers['If-None-Match'] = conditional.etag;
    if (conditional.lastModified) headers['If-Modified-Since'] = conditional.lastModified;
    const req = request({
      hostname: address.address, family: address.family, port: 443,
      path: url.pathname + url.search, method: 'GET', headers, signal,
      agent: false, servername: isIP(hostname) ? '' : hostname,
      rejectUnauthorized: true, checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
    }, res => {
      const status = res.statusCode ?? 0;
      if (status !== 200) {
        res.destroy(); resolve({ status, location: res.headers.location ?? null, body: Buffer.alloc(0), etag: null, lastModified: null, retryAfterMs: parseRetryAfter(res.headers['retry-after']) }); return;
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new ConnectorError('UNSUPPORTED_FEED_ENCODING')); return; }
      if (res.headers['content-range']) { res.destroy(); reject(new ConnectorError('PARTIAL_FEED_RESPONSE')); return; }
      const contentType = (res.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (contentType && !['text/calendar', 'text/plain', 'application/octet-stream'].includes(contentType)) { res.destroy(); reject(new ConnectorError('UNSUPPORTED_FEED_CONTENT_TYPE')); return; }
      const length = Number(res.headers['content-length']);
      if (Number.isFinite(length) && length > maxBytes) { res.destroy(); reject(new ConnectorError('FEED_TOO_LARGE')); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { res.destroy(); reject(new ConnectorError('FEED_TOO_LARGE')); }
        else chunks.push(chunk);
      });
      res.on('aborted', () => reject(new ConnectorError('INCOMPLETE_FEED_RESPONSE', true)));
      res.on('error', () => reject(new ConnectorError('FEED_NETWORK_ERROR', true)));
      res.on('end', () => {
        if (!res.complete || (Number.isFinite(length) && bytes !== length)) { reject(new ConnectorError('INCOMPLETE_FEED_RESPONSE', true)); return; }
        resolve({ status, location: null, body: Buffer.concat(chunks), etag: res.headers.etag ?? null, lastModified: res.headers['last-modified'] ?? null, retryAfterMs: null });
      });
    });
    req.on('error', () => reject(new ConnectorError(signal.aborted ? 'FEED_TIMEOUT_OR_ABORT' : 'FEED_NETWORK_ERROR', true)));
    req.end();
  });
}
/** No cookies, proxy environment, arbitrary headers or unsafe generic fetch fallback. DNS pinning survives rebinding. */
export async function fetchIcalFeed(input: string, options: FeedFetchOptions = {}): Promise<FeedFetchResult> {
  const maxBytes = options.maxBytes ?? 2_000_000, timeoutMs = options.timeoutMs ?? 10_000, maxRedirects = options.maxRedirects ?? 3;
  invariant(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 10_000_000 && timeoutMs > 0 && timeoutMs <= 60_000 && Number.isInteger(maxRedirects) && maxRedirects >= 0 && maxRedirects <= 5, 'INVALID_FETCH_LIMITS');
  invariant(![options.etag, options.lastModified].some(v => v && /[\r\n]/.test(v)), 'INVALID_CONDITIONAL_HEADER');
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  let target = input;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (signal.aborted) throw new ConnectorError('FEED_TIMEOUT_OR_ABORT', true);
    let resolved: Awaited<ReturnType<typeof resolveFeedTarget>>;
    try {
      resolved = await new Promise((resolve, reject) => {
        const abort = () => reject(new ConnectorError('FEED_TIMEOUT_OR_ABORT', true));
        signal.addEventListener('abort', abort, { once: true });
        resolveFeedTarget(target, options.resolver).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    } catch (error) { if (error instanceof ConnectorError) throw error; throw new ConnectorError('FEED_DNS_FAILED', true); }
    const conditional = redirects === 0 ? { ...(options.etag ? { etag: options.etag } : {}), ...(options.lastModified ? { lastModified: options.lastModified } : {}) } : {};
    const response = await pinnedRequest(resolved.url, resolved.addresses[0]!, signal, maxBytes, conditional);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      invariant(response.location && redirects < maxRedirects, 'FEED_REDIRECT_LIMIT');
      try { target = new URL(response.location, resolved.url).href; } catch { throw new ConnectorError('INVALID_FEED_REDIRECT'); }
      // Next iteration repeats URL, DNS and address checks; no conditional or authorization headers cross origins.
      continue;
    }
    if (response.status === 304) return { status: 'not_modified', fetchedAt: new Date().toISOString() };
    if (response.status === 401 || response.status === 403) throw new ConnectorError('FEED_REAUTH_REQUIRED');
    if (response.status === 429) throw new ConnectorError('FEED_RATE_LIMITED', true, response.retryAfterMs);
    if (response.status >= 500) throw new ConnectorError('FEED_UPSTREAM_FAILED', true, response.retryAfterMs);
    invariant(response.status === 200, 'FEED_HTTP_REJECTED');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(response.body); }
    catch { throw new ConnectorError('FEED_INVALID_UTF8'); }
    invariant(text.trim().length > 0, 'EMPTY_FEED_BODY');
    return { status: 'ok', text, etag: response.etag, lastModified: response.lastModified, fetchedAt: new Date().toISOString() };
  }
  throw new ConnectorError('FEED_REDIRECT_LIMIT');
}
