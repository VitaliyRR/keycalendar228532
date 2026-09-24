import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { validateFeedUrl, resolveFeedTarget, isPublicAddress, fetchIcalFeed, ConnectorError, parseRetryAfter } from '../src/index.js';

test('SSRF URL gate rejects local/private/special IPs, alternative encodings, credentials and protocols', () => {
  const rejected = ['http://example.com/a', 'https://localhost/a', 'https://x.local/a', 'https://10.0.0.1/a', 'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://169.254.169.254/a', 'https://192.168.1.1/a', 'https://100.64.0.1/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://[fe80::1]/a', 'https://[2001:db8::1]/a', 'https://[2002:7f00:1::]/a', 'https://name:synthetic@example.com/a', 'https://example.com:8443/a', 'https://example.com/a#fragment'];
  for (const value of rejected) assert.throws(() => validateFeedUrl(value), /FEED/, value);
  assert.equal(validateFeedUrl('https://calendar.example.com/feed.ics?key=synthetic').protocol, 'https:');
  assert.ok(isPublicAddress('8.8.8.8')); assert.ok(isPublicAddress('2001:4860:4860::8888'));
});
test('DNS result rejects mixed public/private answers and resolver inconsistencies', async () => {
  await assert.rejects(resolveFeedTarget('https://calendar.example.com/a', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /UNSAFE_FEED_DNS/);
  await assert.rejects(resolveFeedTarget('https://calendar.example.com/a', async () => [{ address: '8.8.8.8', family: 6 }]), /UNSAFE_FEED_DNS/);
});
interface MockResponse { status: number; headers?: Record<string, string>; body?: string; complete?: boolean }
async function withHttp(responses: MockResponse[], action: (requests: Record<string, unknown>[]) => Promise<void>) {
  const requests: Record<string, unknown>[] = [];
  const fake = ((options: Record<string, unknown>, callback: (response: Readable) => void) => {
    requests.push(options); const request = new EventEmitter();
    Object.assign(request, { end: () => queueMicrotask(() => {
      const next = responses.shift(); assert.ok(next, 'unexpected outbound call');
      const response = Readable.from(next.body === undefined ? [] : [Buffer.from(next.body)]);
      Object.assign(response, { statusCode: next.status, headers: next.headers ?? {}, complete: next.complete ?? true });
      callback(response);
    }) }); return request;
  }) as unknown as typeof https.request;
  const stub = mock.method(https, 'request', fake); syncBuiltinESMExports();
  try { await action(requests); } finally { stub.mock.restore(); syncBuiltinESMExports(); }
}
const resolver = async () => [{ address: '8.8.8.8', family: 4 }];
test('secure transport pins vetted address while preserving TLS hostname and host header', async () => {
  await withHttp([{ status: 200, body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', headers: { 'content-type': 'text/calendar', etag: '"version-1"' } }], async requests => {
    const result = await fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver });
    assert.equal(result.status, 'ok'); assert.equal(requests[0]?.hostname, '8.8.8.8'); assert.equal(requests[0]?.servername, 'calendar.example.com');
    assert.equal(requests[0]?.rejectUnauthorized, true); assert.equal(requests[0]?.agent, false);
    assert.equal((requests[0]?.headers as Record<string, string>).Host, 'calendar.example.com');
  });
});
test('redirects repeat DNS validation and never reach private destinations', async () => {
  await withHttp([{ status: 302, headers: { location: 'https://127.0.0.1/private' } }], async requests => {
    await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver }), /UNSAFE_FEED_ADDRESS/); assert.equal(requests.length, 1);
  });
  await withHttp([{ status: 302, headers: { location: '/moved' } }], async requests => {
    let calls = 0;
    await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver: async () => [{ address: ++calls === 1 ? '8.8.8.8' : '10.0.0.2', family: 4 }] }), /UNSAFE_FEED_DNS/);
    assert.equal(requests.length, 1); assert.equal(calls, 2);
  });
});
test('304 is distinct from full snapshot; empty/truncated/oversized/compressed feeds reject', async () => {
  await withHttp([{ status: 304 }], async () => assert.equal((await fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver, etag: '"known"' })).status, 'not_modified'));
  for (const response of [{ status: 200, body: '' }, { status: 200, body: 'abc', complete: false }, { status: 200, body: 'large payload' }, { status: 200, body: 'abc', headers: { 'content-encoding': 'gzip' } }]) {
    await withHttp([response], async () => { await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver, maxBytes: 5 })); });
  }
});
test('request errors expose codes, never the secret URL; DNS has total deadline', async () => {
  await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics?token=synthetic-token', { resolver: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return resolver(); }, timeoutMs: 5 }), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'FEED_TIMEOUT_OR_ABORT'); assert.ok(!error.message.includes('synthetic-token')); return true;
  });
});
test('rate limit preserves Retry-After and caller abort does not leak an arbitrary reason', async () => {
  await withHttp([{ status: 429, headers: { 'retry-after': '90' } }], async () => {
    await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver }), error => {
      assert.ok(error instanceof ConnectorError); assert.equal(error.code, 'FEED_RATE_LIMITED'); assert.equal(error.retryAfterMs, 90_000); return true;
    });
  });
  assert.equal(parseRetryAfter('Thu, 24 Sep 2026 00:01:00 GMT', Date.parse('2026-09-24T00:00:00Z')), 60_000);
  const controller = new AbortController(); controller.abort('synthetic-private-reason');
  await assert.rejects(fetchIcalFeed('https://calendar.example.com/feed.ics', { resolver, signal: controller.signal }), /FEED_TIMEOUT_OR_ABORT/);
});
