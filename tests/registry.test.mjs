import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUNDLED, SNAPSHOT, validate, loadRegistry, sourceUrls, normalise } from '../src/registry.mjs';
import { sha256 } from '../src/update.mjs';
import { reg } from './helpers.mjs';

test('the bundled copy matches the hash recorded in snapshot.json', () => {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.equal(sha256(fs.readFileSync(BUNDLED)), snap.sha256);
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  assert.equal(raw.meta.version, snap.registry_version);
  assert.equal(raw.meta.last_verified, snap.last_verified);
  assert.equal(snap.data_licence, 'CC BY 4.0');
});

test('the bundled registry validates and has the expected categories', () => {
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  assert.deepEqual(validate(raw), []);
  const r = reg();
  const count = (c) => r.records.filter((x) => x.category === c).length;
  assert.equal(count('exportable'), raw.exportable.length);
  assert.equal(count('streamed'), raw.streamed.length);
  assert.equal(count('hosted_wrapper'), raw.hosted_wrappers.length);
  assert.equal(count('announced'), raw.announced.length);
});

test('validate rejects a truncated or wrong file', () => {
  assert.ok(validate(null).length);
  assert.ok(validate({}).length);
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  delete raw.streamed;
  assert.ok(validate(raw).some((e) => e.includes('streamed')));
  const bad = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  bad.meta.last_verified = 'yesterday';
  assert.ok(validate(bad).some((e) => e.includes('last_verified')));
  const dup = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  dup.streamed.push({ ...dup.exportable[0] });
  assert.ok(validate(dup).some((e) => e.includes('duplicate')));
});

test('every quoted clause carries its quote, source URL and read date', () => {
  for (const rec of reg().records) {
    for (const g of [...rec.commercial.grants, ...rec.commercial.restrictions]) {
      assert.match(g.read_on, /^\d{4}-\d{2}-\d{2}$/, `${rec.id} clause has no read date`);
      if (g.status === 'quoted' || g.flag) {
        assert.ok(g.quote, `${rec.id}: ${g.tier ?? g.topic} has no quote`);
        assert.match(g.url ?? '', /^https?:\/\//, `${rec.id}: ${g.tier ?? g.topic} has no url`);
      }
    }
  }
});

test('commercial states follow the recorded clauses', () => {
  const r = reg();
  const state = (id) => r.byId.get(id).commercial.state;
  assert.equal(state('marble'), 'conflict'); // the registry records a terms versus pricing-page conflict
  assert.equal(state('flashworld'), 'conflict'); // weights tagged non-commercial
  assert.equal(state('matrix-3d'), 'conflict'); // MIT, but the text-to-panorama LoRA sits on FLUX.1-dev
  assert.equal(state('hunyuanworld-mirror'), 'conditions'); // territory and scale clauses
  assert.equal(state('odyssey'), 'conflict'); // consumer terms prohibit commercial use
  assert.equal(state('lingbot-world'), 'conflict'); // version 2 is CC BY-NC-SA
  assert.equal(state('matrix-game-3'), 'licence-named'); // MIT or Apache named, no quoted output clause
  assert.equal(state('worldlabs-atlas'), 'not-published');
  assert.ok(r.byId.get('hunyuanworld-mirror').commercial.flags.includes('territory-exclusion'));
});

test('a streamed entry with no quoted terms is never shown as a vendor quote', () => {
  const g = reg().byId.get('lingbot-world').commercial.grants[0];
  assert.equal(g.status, 'registry-text');
  assert.equal(g.quote, undefined);
  assert.match(g.registry_text, /NonCommercial/);
});

test('a hosted wrapper inherits the underlying model terms and says so', () => {
  const b = reg().byId.get('beeble-3d-scene-generator');
  assert.equal(b.commercial.inherited_from, 'marble');
  assert.match(b.commercial.reason, /underlying model's terms govern/);
  const s = reg().byId.get('scenario-hy-world-image-to-splat');
  assert.equal(s.commercial.state, 'not-published');
  assert.match(s.commercial.reason, /underlying vendor's terms still govern/);
});

test('export tags come from the registry text', () => {
  const r = reg();
  assert.deepEqual(r.byId.get('marble').exports.tags.sort(), ['mesh', 'panorama', 'splat', 'video']);
  assert.deepEqual(r.byId.get('odyssey').exports.tags, []);
  assert.ok(r.byId.get('scenario-hy-world-image-to-splat').exports.tags.includes('splat'));
});

test('age and staleness follow the clock, and the warning names the age', () => {
  const fresh = loadRegistry({ now: new Date('2026-09-30T00:00:00Z') });
  assert.equal(fresh.info.age_days, 1);
  assert.equal(fresh.info.stale, false);
  const old = loadRegistry({ now: new Date('2026-12-01T00:00:00Z') });
  assert.equal(old.info.stale, true);
  assert.match(old.info.stale_warning, /63 days ago/);
});

test('an explicit data file wins, and a broken one is refused with a reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  const file = path.join(dir, 'r.json');
  fs.writeFileSync(file, JSON.stringify({ meta: {}, exportable: 'no' }));
  assert.throws(() => loadRegistry({ data: file }), /not valid/);
  fs.copyFileSync(BUNDLED, file);
  assert.equal(loadRegistry({ data: file }).info.source, 'file');
});

test('a newer cached copy beats the bundle, an older one does not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const prev = process.env.WMR_MCP_CACHE;
  process.env.WMR_MCP_CACHE = dir;
  try {
    raw.meta.last_verified = '2026-10-15';
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(raw));
    assert.equal(loadRegistry({ now: new Date('2026-10-16T00:00:00Z') }).info.source, 'cache');
    raw.meta.last_verified = '2026-01-01';
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(raw));
    assert.equal(loadRegistry().info.source, 'bundled');
    fs.writeFileSync(path.join(dir, 'registry.json'), '{ not json');
    assert.equal(loadRegistry().info.source, 'bundled');
  } finally {
    if (prev === undefined) delete process.env.WMR_MCP_CACHE;
    else process.env.WMR_MCP_CACHE = prev;
  }
});

test('sourceUrls collects every cited URL once, with who cites it', () => {
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const urls = sourceUrls(raw);
  assert.equal(new Set(urls.map((u) => u.url)).size, urls.length);
  assert.ok(urls.length > 100);
  const m = urls.find((u) => u.url === 'https://www.worldlabs.ai/terms-of-service');
  assert.ok(m.used_by.some((x) => x.id === 'marble'));
  assert.ok(urls.every((u) => /^https?:\/\//.test(u.url)));
});

test('normalise does not mutate the raw registry', () => {
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const before = JSON.stringify(raw);
  normalise(raw);
  assert.equal(JSON.stringify(raw), before);
});
