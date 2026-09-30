// The queries. The CLI, the MCP server and the skill all call these and nothing else, so an answer
// is the same wherever it is asked. Every answer carries the registry version and read dates.
// There is no scoring and no ranking: results come back in the registry's own order.

import { COMMERCIAL_STATES } from './registry.mjs';
import { entryLinkStatus } from './verify.mjs';

export const CATEGORIES = ['exportable', 'streamed', 'hosted_wrapper', 'announced'];
export const EXPORT_TAGS = ['splat', 'mesh', 'pointcloud', 'panorama', 'video', 'depth', 'camera-poses', 'viewer'];
export const COMMERCIAL_FILTERS = [...COMMERCIAL_STATES, 'usable', 'no-conflict', 'explicit'];

export class QueryError extends Error {}

export function briefInfo(info) {
  const o = {
    version: info.version,
    last_verified: info.last_verified,
    age_days: info.age_days,
    source: info.source,
    cite: info.citation,
    note: info.note,
  };
  if (info.stale) o.stale_warning = info.stale_warning;
  return o;
}

function asList(v) {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
}

function trim(s, n = 260) {
  if (typeof s !== 'string') return s;
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 3);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : cut).trimEnd() + '...';
}

export function resolveId(reg, key) {
  const k = String(key ?? '').trim().toLowerCase();
  if (!k) throw new QueryError('an id or name is required');
  const exact = reg.records.find((r) => r.id === k || r.name.toLowerCase() === k);
  if (exact) return exact;
  const part = reg.records.filter((r) => r.id.includes(k) || r.name.toLowerCase().includes(k));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new QueryError(`"${key}" matches more than one entry: ${part.map((r) => r.id).join(', ')}`);
  throw new QueryError(`no entry matches "${key}". Ids: ${reg.records.map((r) => r.id).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// Hardware fit

export function parseVram(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(?:gb|gib|g)?$/i);
  if (!m) throw new QueryError(`cannot read "${v}" as a VRAM size. Use a number of gigabytes, for example 24.`);
  const n = Number(m[1]);
  if (!(n > 0)) throw new QueryError('VRAM must be above 0');
  return n;
}

export function fitOne(rec, gb) {
  const H = rec.hardware;
  const base = { id: rec.id, name: rec.name, vram_gb: gb, read_on: rec.last_verified };
  if (H.runs_locally === false) {
    return { ...base, verdict: 'hosted', why: H.statement ?? 'The registry records this as hosted only.' };
  }
  const figs = H.headline.length ? H.headline : H.figures;
  if (!figs.length) {
    return {
      ...base,
      verdict: H.runs_locally === true ? 'not-published' : 'unknown',
      why:
        H.runs_locally === true
          ? 'The registry records that this runs locally and records no GPU memory figure.'
          : 'The registry records no local run and no GPU memory figure.',
      statement: H.statement,
    };
  }
  const lowest = Math.min(...figs.map((f) => f.gb));
  const fits = figs.filter((f) => f.gb <= gb).map((f) => ({ gb: f.gb, text: f.text, field: f.field }));
  const above = figs.filter((f) => f.gb > gb).map((f) => ({ gb: f.gb, text: f.text, field: f.field }));
  const out = {
    ...base,
    verdict: lowest <= gb ? 'fits' : 'exceeds',
    lowest_quoted_gb: lowest,
    quoted_at_or_below: fits,
    quoted_above: above,
  };
  out.why =
    lowest <= gb
      ? `The lowest quoted figure is ${lowest} GB.${above.length ? ' Other modes or stages are quoted above your VRAM.' : ''}`
      : `The lowest quoted figure is ${lowest} GB, above ${gb} GB.`;
  const stageLower = H.figures.filter((f) => f.gb < lowest);
  if (stageLower.length) {
    out.stage_figures_below_lowest = stageLower.map((f) => ({ gb: f.gb, text: f.text, field: f.field }));
    out.caution =
      'Lower figures exist for single stages or settings. They are not the requirement for the whole pipeline unless the text says so.';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matching

function commercialMatches(rec, want) {
  const c = rec.commercial;
  if (!want) return true;
  if (want === 'usable') return ['quoted-grant', 'licence-named', 'conditions'].includes(c.state);
  if (want === 'no-conflict') return c.state !== 'conflict';
  if (want === 'explicit') return c.commercial_word_quoted && c.state !== 'conflict';
  if (COMMERCIAL_STATES.includes(want)) return c.state === want;
  throw new QueryError(`commercial must be one of: ${COMMERCIAL_FILTERS.join(', ')}`);
}

function headlineClause(rec) {
  const g = rec.commercial.grants.find((x) => x.status === 'quoted') ?? rec.commercial.grants.find((x) => x.registry_text);
  if (!g) return null;
  return {
    tier: g.tier,
    section: g.section,
    quote: trim(g.quote ?? g.registry_text),
    from: g.quote ? 'vendor quote' : 'registry text, not a vendor quote',
    url: g.url,
    read_on: g.read_on,
  };
}

function summarise(rec, extra = {}) {
  const maxFps = Math.max(0, ...rec.reported.map((r) => r.fps ?? 0)) || null;
  return {
    id: rec.id,
    name: rec.name,
    vendor: rec.vendor,
    category: rec.category,
    exports: rec.exports.tags,
    you_get: trim(rec.exports.you_get),
    price: trim(rec.price, 240),
    commercial: {
      state: rec.commercial.state,
      reason: rec.commercial.reason,
      flags: rec.commercial.flags,
      headline_clause: headlineClause(rec),
      catches: rec.commercial.restrictions.map((r) => ({ flag: r.flag, topic: r.topic, section: r.section })),
      ...(rec.commercial.inherited_from ? { inherited_from: rec.commercial.inherited_from } : {}),
    },
    hardware: { runs_locally: rec.hardware.runs_locally, statement: trim(rec.hardware.statement, 300) },
    reported_max_fps: maxFps,
    read_on: rec.last_verified,
    vendor_url: rec.vendor_url,
    ...extra,
  };
}

export function matchRecord(rec, p, reg) {
  const why = [];
  const cats = asList(p.category);
  for (const c of cats) if (!CATEGORIES.includes(c)) throw new QueryError(`category must be one of: ${CATEGORIES.join(', ')}`);
  if (cats.length ? !cats.includes(rec.category) : rec.category === 'announced' && !p.include_announced) return { ok: false, why: [cats.length ? `not a ${cats.join(' or ')} entry` : 'announced, not released'] };
  const all = asList(p.exports);
  for (const t of [...all, ...asList(p.exports_any)]) {
    if (!EXPORT_TAGS.includes(t)) throw new QueryError(`export must be one of: ${EXPORT_TAGS.join(', ')}`);
  }
  if (all.length && !all.every((t) => rec.exports.tags.includes(t))) return { ok: false, why: [`does not export ${all.join(' and ')}`] };
  const any = asList(p.exports_any);
  if (any.length && !any.some((t) => rec.exports.tags.includes(t))) return { ok: false, why: [`exports none of ${any.join(', ')}`] };
  if (all.length) why.push(`exports ${all.join(' and ')}`);
  if (any.length) why.push(`exports one of ${any.join(', ')}`);
  if (p.commercial) {
    if (!commercialMatches(rec, p.commercial)) return { ok: false, why: [`commercial state is ${rec.commercial.state}, wanted ${p.commercial}`] };
    why.push(`commercial: ${rec.commercial.state}`);
  }
  if (p.local !== undefined && p.local !== null) {
    const want = p.local === true || p.local === 'true' || p.local === 'yes';
    if ((rec.hardware.runs_locally === true) !== want) return { ok: false, why: [want ? 'not recorded as runnable locally' : 'runs locally'] };
    why.push(want ? 'runs locally' : 'hosted or not local');
  }
  if (p.open_weights !== undefined && p.open_weights !== null) {
    const want = p.open_weights === true || p.open_weights === 'true' || p.open_weights === 'yes';
    if ((rec.open_weights?.value === true) !== want) return { ok: false, why: [want ? 'weights not recorded as open' : 'open weights'] };
  }
  if (p.vendor && !`${rec.vendor}`.toLowerCase().includes(String(p.vendor).toLowerCase())) return { ok: false, why: [`vendor is not ${p.vendor}`] };
  if (p.text) {
    const re = p.text instanceof RegExp ? p.text : new RegExp(String(p.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hay = `${rec.name} ${rec.vendor} ${rec.exports.you_get ?? ''} ${rec.what_it_shows ?? ''} ${rec.price ?? ''}`;
    if (!re.test(hay)) return { ok: false, why: [`does not mention ${re.source}`] };
    why.push(`mentions "${re.source}"`);
  }
  let fit;
  if (p.fits_vram_gb !== undefined && p.fits_vram_gb !== null && p.fits_vram_gb !== '') {
    const gb = parseVram(p.fits_vram_gb);
    fit = fitOne(rec, gb);
    if (fit.verdict !== 'fits') return { ok: false, why: [`${fit.verdict} at ${gb} GB`], fit };
    why.push(`fits ${gb} GB by a quoted figure`);
  }
  if (p.min_fps !== undefined && p.min_fps !== null && p.min_fps !== '') {
    const want = Number(p.min_fps);
    if (!(want >= 0)) throw new QueryError('min_fps must be a number');
    const max = Math.max(0, ...rec.reported.map((r) => r.fps ?? 0));
    if (max < want) return { ok: false, why: [`reported fps ${max || 'none'}, wanted ${want}`] };
    why.push(`vendor-reported ${max} fps`);
  }
  return { ok: true, why, fit };
}

export function search(reg, p = {}) {
  const limit = Math.min(Math.max(Number(p.limit) || 10, 1), 100);
  const hits = [];
  for (const rec of reg.records) {
    const m = matchRecord(rec, p, reg);
    if (m.ok) hits.push(summarise(rec, { matched_because: m.why, ...(m.fit ? { fit: m.fit } : {}) }));
  }
  return {
    registry: briefInfo(reg.info),
    filters: Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)),
    count: hits.length,
    shown: Math.min(hits.length, limit),
    results: hits.slice(0, limit),
    order: 'The registry\'s own order. The registry publishes no scores or rankings, and neither does this.',
  };
}

// ---------------------------------------------------------------------------------------------
// One entry

export function get(reg, key, detail = 'clauses') {
  const rec = resolveId(reg, key);
  if (!['summary', 'clauses', 'full'].includes(detail)) throw new QueryError('detail must be summary, clauses or full');
  const base = { registry: briefInfo(reg.info) };
  if (detail === 'summary') return { ...base, entry: summarise(rec) };
  if (detail === 'full') {
    const raw = [...reg.raw.exportable, ...reg.raw.streamed, ...reg.raw.hosted_wrappers, ...reg.raw.announced].find((e) => e.id === rec.id);
    return { ...base, entry: raw };
  }
  return {
    ...base,
    entry: {
      id: rec.id,
      name: rec.name,
      vendor: rec.vendor,
      category: rec.category,
      vendor_url: rec.vendor_url,
      read_on: rec.last_verified,
      commercial_state: rec.commercial.state,
      commercial_reason: rec.commercial.reason,
      flags: rec.commercial.flags,
      grants: rec.commercial.grants,
      restrictions: rec.commercial.restrictions,
      licence: rec.licence,
      open_weights: rec.open_weights,
      exports: rec.exports,
      hardware: { runs_locally: rec.hardware.runs_locally, statement: rec.hardware.statement },
      reported: rec.reported,
      contact_route: rec.contact_route,
      sources: rec.sources,
      link_check: entryLinkStatus(reg.liveness, rec.id),
      ...(rec.underlying_model ? { underlying_model: rec.underlying_model, underlying_entry_id: rec.underlying_entry_id } : {}),
      ...(rec.notes ? { notes: rec.notes } : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fit

export function fit(reg, p = {}) {
  const gb = parseVram(p.vram_gb ?? p.vram);
  const ids = asList(p.id);
  const pool = ids.length ? ids.map((i) => resolveId(reg, i)) : reg.records.filter((r) => r.category === 'exportable' || r.category === 'streamed');
  const rows = pool.map((r) => fitOne(reg.byId.get(r.id), gb));
  const order = { fits: 0, exceeds: 1, 'not-published': 2, unknown: 3, hosted: 4 };
  const byVerdict = {};
  for (const v of Object.keys(order)) byVerdict[v] = rows.filter((x) => x.verdict === v);
  const only = p.only ? asList(p.only) : null;
  return {
    registry: briefInfo(reg.info),
    vram_gb: gb,
    method:
      'A model fits when the lowest GPU memory figure the registry quotes for it is at or below your VRAM. ' +
      'The figures are the vendors\' own, copied as written. Nothing is measured here.',
    counts: Object.fromEntries(Object.entries(byVerdict).map(([k, v]) => [k, v.length])),
    results: (only ? rows.filter((x) => only.includes(x.verdict)) : [...rows].sort((a, b) => order[a.verdict] - order[b.verdict])),
  };
}

// ---------------------------------------------------------------------------------------------
// Vendor-reported performance

export function reported(reg, p = {}) {
  const ids = asList(p.id);
  const pool = ids.length ? ids.map((i) => resolveId(reg, i)) : reg.records.filter((r) => r.reported.length);
  const minFps = p.min_fps !== undefined && p.min_fps !== '' && p.min_fps !== null ? Number(p.min_fps) : null;
  const rows = [];
  for (const rec of pool) {
    const max = Math.max(0, ...rec.reported.map((r) => r.fps ?? 0));
    if (minFps !== null && max < minFps) continue;
    rows.push({
      id: rec.id,
      name: rec.name,
      category: rec.category,
      runs_locally: rec.hardware.runs_locally,
      hardware: trim(rec.hardware.statement, 300),
      reported: rec.reported,
      read_on: rec.last_verified,
      sources: rec.sources.slice(0, 3),
    });
  }
  return {
    registry: briefInfo(reg.info),
    note:
      'These are frame rates, latencies and generation times the registry quotes from vendor pages. ' +
      'They are vendor-reported and were not measured by this tool or by the registry. ' +
      'Hardware is whatever the vendor stated; a figure with no hardware named cannot be compared.',
    count: rows.length,
    results: rows,
  };
}

// ---------------------------------------------------------------------------------------------
// Changes

export function changes(reg, p = {}) {
  const limit = Math.min(Math.max(Number(p.limit) || 20, 1), 200);
  let rows = [...reg.raw.changes];
  if (p.since) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.since)) throw new QueryError('since must be a date, YYYY-MM-DD');
    rows = rows.filter((c) => c.date >= p.since);
  }
  if (p.id) {
    const rec = resolveId(reg, p.id);
    rows = rows.filter((c) => c.entry_id === rec.id);
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const names = new Map(reg.records.map((r) => [r.id, r.name]));
  return {
    registry: briefInfo(reg.info),
    count: rows.length,
    shown: Math.min(rows.length, limit),
    results: rows.slice(0, limit).map((c) => ({ ...c, entry: names.get(c.entry_id) ?? c.entry_id })),
  };
}

// ---------------------------------------------------------------------------------------------
// Choose

export const TASKS = {
  walkthrough: {
    describe: 'explore a generated scene in a viewer or engine',
    needs: { exports_any: ['splat', 'mesh', 'panorama', 'pointcloud'], category: ['exportable', 'hosted_wrapper'] },
  },
  'game-prototype': {
    describe: 'drop a generated scene into a game engine',
    needs: { exports_any: ['mesh'], category: ['exportable', 'hosted_wrapper'] },
  },
  'web-splat': {
    describe: 'show a Gaussian splat on the web',
    needs: { exports_any: ['splat'], category: ['exportable', 'hosted_wrapper'] },
  },
  'panorama-background': {
    describe: 'get a 360 panorama or skybox',
    needs: { exports_any: ['panorama'], category: ['exportable', 'hosted_wrapper'] },
  },
  'marketing-scene': {
    describe: 'make a scene, render or panorama for client-facing work',
    needs: { exports_any: ['video', 'panorama', 'splat'], commercial: 'no-conflict', category: ['exportable', 'hosted_wrapper'] },
  },
  'realtime-interactive': {
    describe: 'an interactive world you steer in real time',
    needs: { category: ['streamed'] },
  },
  'robot-or-driving-sim': {
    describe: 'an action-conditioned world for robot or driving simulation',
    needs: { category: ['streamed'], text: /robot|driving|throttle|steering|action|keyboard/i },
  },
};

function catches(rec) {
  const out = [];
  if (rec.commercial.state === 'conflict') out.push(`commercial: read the clauses, ${rec.commercial.flags.filter((f) => ['noncommercial-dependency', 'noncommercial-licence', 'commercial-prohibited', 'sources-conflict'].includes(f)).join(', ')}`);
  else if (rec.commercial.flags.length) out.push(`commercial conditions: ${rec.commercial.flags.join(', ')}`);
  else if (rec.commercial.state === 'not-published') out.push('commercial terms: not recorded in the registry');
  if (rec.hardware.runs_locally === false) out.push('hosted only, nothing runs on your GPU');
  else if (!rec.hardware.headline.length && rec.hardware.runs_locally === true) out.push('runs locally, GPU memory not published');
  if (rec.category === 'hosted_wrapper') out.push('a wrapper: the underlying vendor\'s terms still govern');
  return out;
}

export function choose(reg, p = {}) {
  const task = p.task ? TASKS[p.task] : null;
  if (p.task && !task) throw new QueryError(`task must be one of: ${Object.keys(TASKS).join(', ')}`);
  const needs = { ...(task?.needs ?? {}) };
  for (const k of ['exports', 'exports_any', 'category', 'commercial', 'local', 'open_weights', 'fits_vram_gb', 'min_fps', 'text', 'vendor']) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') needs[k] = p[k];
  }
  if (!Object.keys(needs).length) throw new QueryError(`give a task (${Object.keys(TASKS).join(', ')}) or at least one need`);
  const meets = [];
  const excluded = [];
  for (const rec of reg.records) {
    if (rec.category === 'announced') continue;
    const m = matchRecord(rec, needs, reg);
    if (m.ok) meets.push(summarise(rec, { matched_because: m.why, catches: catches(rec), ...(m.fit ? { fit: m.fit } : {}) }));
    else excluded.push({ id: rec.id, name: rec.name, because: m.why });
  }
  return {
    registry: briefInfo(reg.info),
    task: p.task ?? null,
    task_describes: task?.describe ?? null,
    needs: Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, v instanceof RegExp ? v.source : v])),
    meets_count: meets.length,
    meets,
    excluded_count: excluded.length,
    excluded,
    order: 'The registry\'s own order, not a ranking. Read each catch and each clause before choosing.',
  };
}
