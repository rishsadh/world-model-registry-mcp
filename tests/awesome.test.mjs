import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAwesome } from '../src/awesome.mjs';
import { reg } from './helpers.mjs';

function liveness(r, overrides = {}) {
  const results = {};
  for (const rec of r.records) {
    for (const u of [rec.vendor_url, ...rec.sources]) results[u] = { status: 'live', code: 200, checked_on: '2026-10-01', used_by: [{ id: rec.id, role: 'source' }] };
  }
  Object.assign(results, overrides);
  const s = { urls: Object.keys(results).length, live: 0, blocked: 0, dead: 0, error: 0 };
  for (const x of Object.values(results)) s[x.status] += 1;
  return { checked_on: '2026-10-01', registry: { version: '2' }, summary: s, results };
}

test('every entry appears with its read date and a commercial state', () => {
  const r = reg();
  const md = renderAwesome(r, liveness(r));
  for (const rec of r.records) {
    assert.ok(md.includes(`[${rec.name}](${rec.vendor_url})`), rec.id);
    if (rec.category !== 'announced') assert.ok(md.includes(`Commercial: ${rec.commercial.state}`), rec.id);
  }
  assert.ok(md.includes('Read 2026-09-29'));
  for (const o of r.raw.object_only) assert.ok(md.includes(o.name));
});

test('the stamp says how many links answered and on what day', () => {
  const r = reg();
  const md = renderAwesome(r, liveness(r));
  assert.match(md, /links live on 2026-10-01/);
  assert.match(md, /Links checked 2026-10-01: \d+ URLs, \d+ live, 0 blocked, 0 dead, 0 errored/);
});

test('blocked and dead links are listed by name, not hidden in a count', () => {
  const r = reg();
  const md = renderAwesome(
    r,
    liveness(r, {
      'https://www.worldlabs.ai/terms-of-service': { status: 'blocked', code: 403, checked_on: '2026-10-01', used_by: [{ id: 'marble', role: 'source' }] },
      'https://www.worldlabs.ai/blog/atlas': { status: 'dead', code: 404, checked_on: '2026-10-01', used_by: [{ id: 'worldlabs-atlas', role: 'source' }] },
    })
  );
  assert.match(md, /## Link check detail/);
  assert.match(md, /blocked 403: https:\/\/www\.worldlabs\.ai\/terms-of-service \(marble\)/);
  assert.match(md, /dead 404: https:\/\/www\.worldlabs\.ai\/blog\/atlas/);
  assert.match(md, /1 blocked/);
});

test('without a liveness record it says links were not checked, instead of implying they were', () => {
  const md = renderAwesome(reg(), null);
  assert.match(md, /Links have not been checked yet/);
  assert.match(md, /links not checked/);
  assert.ok(!/links live on/.test(md));
});

test('the list has no ranking, no em dashes and no smart punctuation', () => {
  const r = reg();
  const md = renderAwesome(r, liveness(r));
  assert.ok(!md.includes('—'));
  assert.ok(!/[–‘’“”]/.test(md));
  assert.ok(!/\b(best|top|ranked|rating|score)\b/i.test(md.replace('no scores or rankings', '')));
  assert.match(md, /no scores or rankings/);
  assert.match(md, /CC BY 4\.0/);
});

test('a wrapper line says it is governed by the underlying vendor', () => {
  const r = reg();
  const md = renderAwesome(r, liveness(r));
  assert.match(md, /Resells another entry's model/);
});

test('a link that answered from another address is listed, a trailing slash or www is not', () => {
  const r = reg();
  const md = renderAwesome(
    r,
    liveness(r, {
      'https://docs.worldlabs.ai/marble/export.md': { status: 'live', code: 200, final_url: 'https://docs.worldlabs.ai/marble/export/gaussian-splat.md', checked_on: '2026-10-01', used_by: [{ id: 'marble', role: 'source' }] },
      'https://platform.worldlabs.ai': { status: 'live', code: 200, final_url: 'https://platform.worldlabs.ai/', checked_on: '2026-10-01', used_by: [{ id: 'marble', role: 'source' }] },
      'https://www.decart.ai/oasis': { status: 'live', code: 200, final_url: 'https://decart.ai/oasis', checked_on: '2026-10-01', used_by: [{ id: 'decart-oasis-3', role: 'source' }] },
    })
  );
  assert.match(md, /docs\.worldlabs\.ai\/marble\/export\.md -> https:\/\/docs\.worldlabs\.ai\/marble\/export\/gaussian-splat\.md/);
  assert.ok(!md.includes('platform.worldlabs.ai ->'));
  assert.ok(!md.includes('www.decart.ai/oasis ->'));
});
