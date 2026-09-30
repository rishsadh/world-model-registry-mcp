import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUNDLED } from '../src/registry.mjs';
import { classify, verifyLinks, entryLinkStatus, changedSince } from '../src/verify.mjs';

const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));

function fakeFetch(map, calls = []) {
  return async (url, init) => {
    calls.push({ url, t: Date.now(), ua: init?.headers?.['user-agent'] });
    const r = map[url] ?? map['*'] ?? { status: 200 };
    if (r.throw) throw Object.assign(new Error('fetch failed'), { cause: { code: r.throw } });
    return { status: r.status, url: r.final ?? url, body: { cancel: async () => {} } };
  };
}

test('classify separates dead from blocked from unknown', () => {
  assert.equal(classify({ code: 200 }), 'live');
  assert.equal(classify({ code: 204 }), 'live');
  assert.equal(classify({ code: 403 }), 'blocked');
  assert.equal(classify({ code: 401 }), 'blocked');
  assert.equal(classify({ code: 429 }), 'blocked');
  assert.equal(classify({ code: 404 }), 'dead');
  assert.equal(classify({ code: 410 }), 'dead');
  assert.equal(classify({ code: 500 }), 'error');
  assert.equal(classify({ error: 'ENOTFOUND' }), 'dead');
  assert.equal(classify({ error: 'UND_ERR_CONNECT_TIMEOUT' }), 'error');
});

test('verifyLinks checks every cited URL once and records the day it checked', async () => {
  const calls = [];
  const r = await verifyLinks(raw, { fetchImpl: fakeFetch({}, calls), gapMs: 0, githubGapMs: 0, retryWaitMs: 0, now: new Date('2026-10-05T08:00:00Z') });
  const unique = new Set(calls.map((c) => c.url));
  assert.equal(unique.size, calls.length);
  assert.equal(Object.keys(r.results).length, calls.length);
  assert.equal(r.summary.urls, calls.length);
  assert.equal(r.summary.live, calls.length);
  assert.equal(r.checked_on, '2026-10-05');
  assert.equal(r.registry.last_verified, raw.meta.last_verified);
  assert.ok(calls.every((c) => /world-model-registry-mcp/.test(c.ua)));
});

test('a 403 is recorded as blocked, a 404 as dead, a DNS failure as dead, and a redirect keeps its target', async () => {
  const urls = Object.keys((await verifyLinks(raw, { fetchImpl: fakeFetch({}), gapMs: 0, githubGapMs: 0, retryWaitMs: 0 })).results);
  const [a, b, c, d] = [urls[0], urls[1], urls[2], urls[3]];
  const r = await verifyLinks(raw, {
    fetchImpl: fakeFetch({ [a]: { status: 403 }, [b]: { status: 404 }, [c]: { throw: 'ENOTFOUND' }, [d]: { status: 200, final: 'https://example.org/moved' } }),
    gapMs: 0,
    githubGapMs: 0,
    retryWaitMs: 0,
  });
  assert.equal(r.results[a].status, 'blocked');
  assert.equal(r.results[b].status, 'dead');
  assert.equal(r.results[c].status, 'dead');
  assert.equal(r.results[d].status, 'live');
  assert.equal(r.results[d].final_url, 'https://example.org/moved');
  assert.equal(r.summary.blocked + r.summary.dead >= 3, true);
});

test('a network fault is retried once before it is called an error', async () => {
  const only = ['https://www.worldlabs.ai/terms-of-service'];
  let n = 0;
  const flaky = async (url) => {
    n += 1;
    if (n === 1) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return { status: 200, url, body: { cancel: async () => {} } };
  };
  const r = await verifyLinks(raw, { fetchImpl: flaky, only, gapMs: 0, githubGapMs: 0, retryWaitMs: 0 });
  assert.equal(n, 2);
  assert.equal(r.results[only[0]].status, 'live');
});

test('GitHub URLs are spaced at least three seconds apart', async () => {
  const gh = Object.keys((await verifyLinks(raw, { fetchImpl: fakeFetch({}), gapMs: 0, githubGapMs: 0, retryWaitMs: 0, only: [] })).results);
  assert.deepEqual(gh, []);
  const two = ['https://github.com/SkyworkAI/Matrix-3D', 'https://github.com/SkyworkAI/Matrix-3D/blob/main/LICENSE'];
  const calls = [];
  await verifyLinks(raw, { fetchImpl: fakeFetch({}, calls), gapMs: 0, retryWaitMs: 0, only: two });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].t - calls[0].t >= 2900, `gap was ${calls[1].t - calls[0].t} ms`);
});

test('entryLinkStatus rolls up by entry and changedSince reports only differences', async () => {
  const r = await verifyLinks(raw, {
    fetchImpl: fakeFetch({ 'https://www.worldlabs.ai/terms-of-service': { status: 403 } }),
    gapMs: 0,
    githubGapMs: 0,
    retryWaitMs: 0,
    only: ['https://www.worldlabs.ai/terms-of-service', 'https://www.worldlabs.ai/blog/atlas'],
  });
  const marble = entryLinkStatus(r, 'marble');
  assert.equal(marble.blocked, 1);
  assert.equal(marble.total, marble.live + marble.blocked + marble.dead + marble.error);
  assert.equal(entryLinkStatus(null, 'marble'), null);
  const prev = JSON.parse(JSON.stringify(r));
  prev.results['https://www.worldlabs.ai/terms-of-service'].status = 'live';
  assert.deepEqual(changedSince(prev, r), [{ url: 'https://www.worldlabs.ai/terms-of-service', was: 'live', now: 'blocked' }]);
  assert.deepEqual(changedSince(null, r), []);
});
