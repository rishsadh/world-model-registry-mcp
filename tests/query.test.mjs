import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/query.mjs';
import { reg } from './helpers.mjs';

const ids = (r) => r.results.map((x) => x.id);

test('search by export returns only entries that export it', () => {
  const r = reg();
  const s = Q.search(r, { exports: ['splat'], limit: 100 });
  assert.ok(s.count >= 6);
  for (const x of s.results) assert.ok(x.exports.includes('splat'), x.id);
  assert.ok(ids(s).includes('marble'));
  assert.ok(!ids(s).includes('odyssey'));
});

test('exports takes all of the list, exports_any takes one of it', () => {
  const r = reg();
  const both = Q.search(r, { exports: 'splat,mesh', category: 'exportable', limit: 100 });
  for (const x of both.results) assert.ok(x.exports.includes('splat') && x.exports.includes('mesh'));
  assert.ok(ids(both).includes('worldgen'));
  const any = Q.search(r, { exports_any: ['mesh', 'pointcloud'], category: 'exportable', limit: 100 });
  assert.ok(any.count > both.count);
});

test('commercial filters: usable leaves out conflicts, conflict returns only conflicts', () => {
  const r = reg();
  const usable = Q.search(r, { commercial: 'usable', limit: 100 });
  assert.ok(usable.results.every((x) => ['quoted-grant', 'licence-named', 'conditions'].includes(x.commercial.state)));
  assert.ok(!ids(usable).includes('flashworld'));
  const conflict = Q.search(r, { commercial: 'conflict', limit: 100 });
  assert.ok(conflict.results.every((x) => x.commercial.state === 'conflict'));
  assert.ok(ids(conflict).includes('flashworld'));
  assert.throws(() => Q.search(r, { commercial: 'free' }), Q.QueryError);
});

test('every result carries a clause, a read date and the registry version', () => {
  const s = Q.search(reg(), { commercial: 'usable', exports: ['splat'] });
  assert.equal(s.registry.version, '2');
  assert.match(s.registry.last_verified, /^\d{4}/);
  assert.ok(s.registry.note.includes('not legal advice'));
  for (const x of s.results) {
    assert.match(x.read_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(x.commercial.headline_clause.quote.length > 10);
    assert.match(x.commercial.headline_clause.url, /^https?:\/\//);
  }
});

test('search is in registry order and never scores', () => {
  const s = Q.search(reg(), { limit: 100 });
  assert.equal(s.results[0].id, 'marble');
  assert.match(s.order, /no scores or rankings/);
  assert.ok(!JSON.stringify(s).includes('"score"'));
});

test('announced entries are left out unless asked for', () => {
  const r = reg();
  assert.ok(!ids(Q.search(r, { limit: 100 })).includes('worldlabs-atlas'));
  assert.ok(ids(Q.search(r, { include_announced: true, limit: 100 })).includes('worldlabs-atlas'));
  assert.deepEqual(ids(Q.search(r, { category: 'announced', limit: 100 })).length, 3);
});

test('limit caps the list and says how many matched', () => {
  const s = Q.search(reg(), { limit: 3 });
  assert.equal(s.results.length, 3);
  assert.ok(s.count > 3);
  assert.equal(s.shown, 3);
});

test('parseVram reads numbers and sizes and refuses nonsense', () => {
  assert.equal(Q.parseVram(24), 24);
  assert.equal(Q.parseVram('24GB'), 24);
  assert.equal(Q.parseVram('12 gb'), 12);
  assert.equal(Q.parseVram('7.5'), 7.5);
  for (const bad of ['RTX 4090', '', '-4', '0', 'lots']) assert.throws(() => Q.parseVram(bad), Q.QueryError, bad);
});

test('fit at 24 GB: fits where a quoted figure is at or below, exceeds where all are above', () => {
  const f = Q.fit(reg(), { vram_gb: 24 });
  const by = Object.fromEntries(f.results.map((x) => [x.id, x]));
  assert.equal(by['worldgen'].verdict, 'fits');
  assert.equal(by['worldsplat'].verdict, 'fits');
  assert.equal(by['matrix-3d'].verdict, 'fits');
  assert.equal(by['hunyuanworld-voyager'].verdict, 'exceeds');
  assert.equal(by['hunyuanworld-voyager'].lowest_quoted_gb, 60);
  assert.equal(by['marble'].verdict, 'hosted');
  assert.equal(by['hunyuanworld-mirror'].verdict, 'not-published');
  assert.equal(by['odyssey'].verdict, 'unknown');
});

test('fit never invents a figure: not-published stays not-published at any size', () => {
  for (const gb of [4, 24, 80, 640]) {
    const by = Object.fromEntries(Q.fit(reg(), { vram_gb: gb }).results.map((x) => [x.id, x]));
    assert.equal(by['hunyuanworld-mirror'].verdict, 'not-published');
    assert.equal(by['hy-world-2-0'].verdict, 'not-published');
  }
});

test('fit quotes the clause behind each figure and flags the other modes', () => {
  const by = Object.fromEntries(Q.fit(reg(), { vram_gb: 24 }).results.map((x) => [x.id, x]));
  const fw = by['flashworld'];
  assert.ok(fw.quoted_at_or_below.some((f) => f.gb === 24 && /offload/.test(f.text)));
  assert.ok(fw.quoted_above.some((f) => f.gb === 51));
  assert.match(fw.why, /Other modes or stages/);
});

test('fit does not let a single-stage figure stand in for the whole pipeline', () => {
  // Matrix-3D: the headline minimum is 12 GB. A 10 GB figure exists, but only for reconstruction.
  const at11 = Q.fit(reg(), { vram_gb: 11, id: ['matrix-3d'] }).results[0];
  assert.equal(at11.verdict, 'exceeds');
  assert.equal(at11.lowest_quoted_gb, 12);
  assert.ok(at11.stage_figures_below_lowest.some((f) => f.gb === 10));
  assert.match(at11.caution, /single stages/);
});

test('fit does not read system RAM as GPU memory', () => {
  const mg = Q.fit(reg(), { vram_gb: 8, id: ['matrix-game-3'] }).results[0];
  assert.equal(mg.verdict, 'not-published');
});

test('fit counts add up and only filters', () => {
  const f = Q.fit(reg(), { vram_gb: 16 });
  assert.equal(Object.values(f.counts).reduce((a, b) => a + b, 0), f.results.length);
  const only = Q.fit(reg(), { vram_gb: 16, only: 'fits' });
  assert.ok(only.results.every((x) => x.verdict === 'fits'));
});

test('search can filter by fit, and the result carries the fit', () => {
  const s = Q.search(reg(), { fits_vram_gb: 24, exports: ['splat'], limit: 100 });
  assert.ok(s.count >= 3);
  for (const x of s.results) assert.equal(x.fit.verdict, 'fits');
});

test('reported returns the vendor sentence with its field, never a bare number', () => {
  const r = Q.reported(reg(), { id: ['decart-oasis-3'] });
  const rows = r.results[0].reported;
  assert.ok(rows.some((x) => x.kinds.includes('latency') && /under 200ms latency/.test(x.text)));
  assert.ok(rows.every((x) => x.text.length > 10 && x.field && x.read_on));
  assert.match(r.note, /not measured/);
});

test('reported min_fps filters on the vendor-reported number', () => {
  const r = Q.reported(reg(), { min_fps: 40 });
  assert.deepEqual(r.results.map((x) => x.id).sort(), ['lingbot-world', 'matrix-game-3']);
  assert.equal(Q.search(reg(), { min_fps: 40, limit: 100 }).count, 2);
});

test('changes filters by date and entry and sorts newest first', () => {
  const r = reg();
  const all = Q.changes(r, { limit: 200 });
  assert.ok(all.count >= 40);
  const m = Q.changes(r, { id: 'marble', limit: 200 });
  assert.ok(m.results.every((c) => c.entry_id === 'marble' && c.entry === 'Marble'));
  const since = Q.changes(r, { since: '2026-09-29', limit: 200 });
  assert.ok(since.results.every((c) => c.date >= '2026-09-29'));
  assert.ok(since.results.every((c, i, a) => i === 0 || a[i - 1].date >= c.date));
  assert.throws(() => Q.changes(r, { since: 'last week' }), Q.QueryError);
});

test('get resolves ids, names and unique fragments, and refuses ambiguous ones', () => {
  const r = reg();
  assert.equal(Q.get(r, 'marble').entry.id, 'marble');
  assert.equal(Q.get(r, 'HunyuanWorld-Voyager').entry.id, 'hunyuanworld-voyager');
  assert.equal(Q.get(r, 'voyager').entry.id, 'hunyuanworld-voyager');
  assert.throws(() => Q.get(r, 'hunyuanworld'), /matches more than one entry/);
  assert.throws(() => Q.get(r, 'nonesuch'), /no entry matches/);
  assert.throws(() => Q.get(r, ''), Q.QueryError);
});

test('get clauses returns every grant and restriction with section, url and read date', () => {
  const e = Q.get(reg(), 'marble').entry;
  assert.ok(e.grants.length >= 4);
  assert.ok(e.restrictions.length >= 5);
  for (const c of [...e.grants, ...e.restrictions]) {
    assert.ok(c.section && c.url && c.read_on, c.tier ?? c.topic);
  }
  assert.ok(e.restrictions.some((c) => /Watermarks/.test(c.topic)));
});

test('get full returns the registry entry unchanged', () => {
  const r = reg();
  const full = Q.get(r, 'flashworld', 'full').entry;
  assert.deepEqual(full, r.raw.exportable.find((x) => x.id === 'flashworld'));
  assert.throws(() => Q.get(r, 'flashworld', 'everything'), Q.QueryError);
});

test('choose maps a task to needs and lists what it left out with the reason', () => {
  const c = Q.choose(reg(), { task: 'robot-or-driving-sim' });
  const got = c.meets.map((x) => x.id);
  for (const id of ['decart-oasis-3', 'runway-gwm-worlds', 'matrix-game-3']) assert.ok(got.includes(id), id);
  for (const id of ['project-genie', 'marble']) assert.ok(!got.includes(id), id);
  assert.ok(c.meets.some((x) => x.id === 'decart-oasis-3'));
  assert.ok(c.excluded.every((x) => x.because.length));
  assert.ok(!c.meets.some((x) => x.category !== 'streamed'));
});

test('choose attaches the catches, and a conflict is never presented as clear', () => {
  const c = Q.choose(reg(), { task: 'web-splat', fits_vram_gb: 24 });
  const fw = c.meets.find((x) => x.id === 'flashworld');
  assert.ok(fw.catches.some((t) => /read the clauses/.test(t) && /noncommercial-dependency/.test(t)));
  assert.equal(fw.commercial.state, 'conflict');
});

test('choose marketing-scene excludes the conflicts', () => {
  const c = Q.choose(reg(), { task: 'marketing-scene' });
  assert.ok(c.meets.every((x) => x.commercial.state !== 'conflict'));
  assert.ok(c.meets.length >= 1);
});

test('choose needs a task or a need, and refuses an unknown task', () => {
  assert.throws(() => Q.choose(reg(), {}), /give a task/);
  assert.throws(() => Q.choose(reg(), { task: 'make coffee' }), /task must be one of/);
  assert.ok(Q.choose(reg(), { commercial: 'usable', local: true }).meets.length > 0);
});

test('get attaches link status when a liveness record is loaded', () => {
  const live = {
    checked_on: '2026-09-30',
    results: {
      'https://www.worldlabs.ai/terms-of-service': { status: 'live', code: 200, checked_on: '2026-09-30', used_by: [{ id: 'marble', role: 'source' }] },
      'https://docs.worldlabs.ai/x': { status: 'blocked', code: 403, checked_on: '2026-09-30', used_by: [{ id: 'marble', role: 'source' }] },
    },
  };
  const e = Q.get(reg({ liveness: live }), 'marble').entry;
  assert.equal(e.link_check.total, 2);
  assert.equal(e.link_check.live, 1);
  assert.equal(e.link_check.blocked, 1);
  assert.equal(Q.get(reg(), 'marble').entry.link_check, null);
});
