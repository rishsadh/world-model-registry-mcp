// Load the world model registry and turn each entry into one flat record that the queries use.
// The registry is Rish Sadh's data (CC BY 4.0): https://rishsadh.com/world-model-registry
// Nothing is added to it here. Every quote, section, URL and date in a record is copied from it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vramFigures, reportedFigures, clauses } from './extract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const BUNDLED = path.join(ROOT, 'data', 'registry.json');
export const SNAPSHOT = path.join(ROOT, 'data', 'snapshot.json');
export const CANONICAL_URL = 'https://rishsadh.com/world-model-registry/registry.json';
export const STALE_AFTER_DAYS = 30;

export function cachePath() {
  const dir = process.env.WMR_MCP_CACHE || path.join(os.homedir(), '.cache', 'world-model-registry-mcp');
  return path.join(dir, 'registry.json');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A light structural check. The registry repo holds the full JSON Schema; this only stops a
// truncated download or the wrong file from being served as if it were the registry.
export function validate(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['not an object'];
  for (const k of ['meta', 'exportable', 'streamed', 'hosted_wrappers', 'announced', 'object_only', 'changes']) {
    if (!(k in raw)) errors.push(`missing "${k}"`);
  }
  for (const k of ['exportable', 'streamed', 'hosted_wrappers', 'announced', 'object_only', 'changes']) {
    if (k in raw && !Array.isArray(raw[k])) errors.push(`"${k}" is not an array`);
  }
  if (raw.meta) {
    if (!raw.meta.version) errors.push('meta.version missing');
    if (!DATE.test(raw.meta.last_verified ?? '')) errors.push('meta.last_verified is not a date');
  }
  const ids = new Set();
  for (const k of ['exportable', 'streamed', 'hosted_wrappers', 'announced', 'object_only']) {
    for (const e of raw[k] ?? []) {
      if (!e.id || !e.name) errors.push(`an entry in "${k}" has no id or name`);
      else if (ids.has(e.id)) errors.push(`duplicate id ${e.id}`);
      else ids.add(e.id);
    }
  }
  return errors;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Pick the registry file. An explicit path wins. Otherwise the newest of the bundled copy and the
// cache written by `update`, by meta.last_verified, so an old cache never hides a newer bundle.
export function locate(opts = {}) {
  if (opts.data) return { kind: 'file', file: path.resolve(opts.data) };
  const cache = cachePath();
  if (fs.existsSync(cache)) {
    try {
      const c = readJson(cache);
      const b = readJson(BUNDLED);
      if (validate(c).length === 0 && c.meta.last_verified > b.meta.last_verified) return { kind: 'cache', file: cache };
    } catch {
      // a broken cache is ignored, the bundled copy is used
    }
  }
  return { kind: 'bundled', file: BUNDLED };
}

export function daysBetween(a, b) {
  return Math.floor((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function loadRegistry(opts = {}) {
  const loc = locate(opts);
  const raw = readJson(loc.file);
  const errors = validate(raw);
  if (errors.length) throw new Error(`registry file ${loc.file} is not valid: ${errors.slice(0, 5).join('; ')}`);
  const now = today(opts.now);
  const age = daysBetween(raw.meta.last_verified, now);
  const info = {
    title: raw.meta.title,
    version: raw.meta.version,
    last_verified: raw.meta.last_verified,
    source: loc.kind,
    canonical_url: raw.meta.canonical_url,
    citation: raw.meta.citation,
    data_licence: 'CC BY 4.0',
    age_days: age,
    stale: age > STALE_AFTER_DAYS,
    note:
      'Clauses are quoted as the registry read them on the dates given. They can have changed since. ' +
      'Open the source URL before relying on one. This is not legal advice.',
  };
  if (info.stale) info.stale_warning = `This copy was last verified ${age} days ago. Run "update" for the current registry.`;
  const records = normalise(raw);
  return { raw, info, records, byId: new Map(records.map((r) => [r.id, r])) };
}

// ---------------------------------------------------------------------------------------------
// Normalising

const FORMAT_TAGS = [
  ['splat', /splat|gaussian/i],
  ['mesh', /\bmesh\b|\bGLB\b|collider|triangle/i],
  ['pointcloud', /point cloud/i],
  ['panorama', /panorama|skybox|equirectangular/i],
  ['video', /video|\bmp4\b/i],
  ['depth', /depth map|\bdepth\b|surface normals/i],
  ['camera-poses', /camera poses|camera parameters|colmap/i],
  ['viewer', /viewer page/i],
];

export function formatTags(text) {
  const tags = [];
  for (const [tag, re] of FORMAT_TAGS) if (re.test(text)) tags.push(tag);
  return tags;
}

// Each rule looks at a restriction's topic and quote and names the catch it is.
const RESTRICTION_FLAGS = [
  ['noncommercial-dependency', /non-?commercial|cc-by-nc/i, 'quote'],
  ['commercial-prohibited', /commercial use prohibited/i, 'topic'],
  ['territory-exclusion', /territory/i, 'topic'],
  ['vendor-licence-back', /licen[cs]e back|perpetual licen|training licen|marketing and training|training use/i, 'topic'],
  ['competitive-or-training-limits', /improve other models|use of ai output|competitive|benchmark|^restrictions/i, 'topic'],
  ['attribution-or-disclosure', /attribution|disclosure|watermark/i, 'topic'],
  ['publishing-limits', /publishing machine|acceptable use/i, 'topic'],
  ['licence-termination', /litigation|terminates/i, 'topic'],
  ['indemnity-or-liability', /indemnity/i, 'topic'],
  ['public-viewing-fees', /fees on public/i, 'topic'],
];

const CONFLICT_FLAGS = new Set(['noncommercial-dependency', 'noncommercial-licence', 'commercial-prohibited', 'sources-conflict']);

export const COMMERCIAL_STATES = ['quoted-grant', 'licence-named', 'conditions', 'conflict', 'not-published'];

function flagFor(clause) {
  for (const [flag, re, where] of RESTRICTION_FLAGS) {
    const text = where === 'topic' ? clause.topic : clause.quote;
    if (re.test(text ?? '')) return flag;
  }
  return 'other-restriction';
}

function clauseOut(c, readOn) {
  const o = {};
  for (const k of ['tier', 'topic', 'status', 'section', 'quote', 'registry_text', 'url', 'flag']) if (c[k] !== undefined) o[k] = c[k];
  o.read_on = readOn;
  return o;
}

function licenceSentences(text) {
  const parts = clauses(text).filter((c) => /licen[cs]e|\bMIT\b|\bApache\b|Creative Commons|territory|monthly active/i.test(c));
  return parts.length ? parts.join('; ') : null;
}

function commercialFor(e) {
  const readOn = e.last_verified;
  const grants = [];
  const restrictions = [];
  const flags = new Set();
  if (e.category === 'exportable') {
    for (const c of e.commercial_rights ?? []) {
      const g = clauseOut(c, readOn);
      if (c.status === 'quoted' && /scale limit/i.test(c.tier ?? '')) {
        g.flag = 'scale-limit';
        flags.add('scale-limit');
      }
      if (c.status !== 'quoted' && /output/i.test(c.tier ?? '')) flags.add('outputs-rights-not-published');
      grants.push(g);
    }
    for (const c of e.restrictive_clauses ?? []) {
      const r = clauseOut({ ...c, flag: flagFor(c) }, readOn);
      restrictions.push(r);
      flags.add(r.flag);
    }
    if (/conflict recorded/i.test(e.summary?.rights ?? '')) flags.add('sources-conflict');
  } else if (e.category === 'streamed') {
    if (!(e.terms ?? []).length) {
      // Open-weights streamed models carry their licence in the registry's price text, not as quoted terms.
      const text = licenceSentences(e.price);
      if (text) {
        const url = (e.sources ?? []).find((u) => /license|licence/i.test(u)) ?? e.sources?.[0];
        grants.push(clauseOut({ tier: 'Licence as recorded in the registry price field', status: 'registry-text', registry_text: text, url }, readOn));
        const whole = e.price ?? '';
        if (/non-?commercial/i.test(whole)) flags.add('noncommercial-licence');
        if (/territory/i.test(whole)) flags.add('territory-exclusion');
        if (/monthly active user/i.test(whole)) flags.add('scale-limit');
      }
    }
    for (const t of e.terms ?? []) {
      if (/^ownership/i.test(t.topic) || /commercial use of outputs/i.test(t.topic)) {
        grants.push(clauseOut({ ...t, tier: t.topic, status: 'quoted' }, readOn));
      } else {
        const r = clauseOut({ ...t, flag: flagFor(t) }, readOn);
        restrictions.push(r);
        flags.add(r.flag);
      }
    }
  }
  const flagList = [...flags];
  let state = 'not-published';
  let reason = 'No quoted grant or restriction is recorded for this entry.';
  const conflicts = flagList.filter((f) => CONFLICT_FLAGS.has(f));
  const hasGrant = grants.some((g) => g.status === 'quoted');
  if (conflicts.length) {
    state = 'conflict';
    reason = `Read the clauses: ${conflicts.join(', ')}.`;
  } else if (flagList.length) {
    state = 'conditions';
    reason = `${hasGrant ? 'A grant is quoted, with conditions' : 'Conditions are quoted'}: ${flagList.join(', ')}.`;
  } else if (hasGrant) {
    state = 'quoted-grant';
    reason = 'A grant is quoted and no restriction is recorded.';
  } else if (grants.some((g) => g.status === 'registry-text' && /\b(MIT|Apache)\b/.test(g.registry_text))) {
    state = 'licence-named';
    reason = 'A permissive licence is named in the registry text. No quoted clause on outputs is recorded.';
  }
  const commercialWord = grants.some((g) => g.status === 'quoted' && /commercial/i.test(g.quote ?? ''));
  return { state, reason, flags: flagList, commercial_word_quoted: commercialWord, grants, restrictions };
}

function hardwareFor(e) {
  const figures = vramFigures(e);
  const headlineFields = [['summary.local'], ['runs_locally.vram'], ['price', 'what_it_shows', 'notes']];
  let headline = [];
  for (const fields of headlineFields) {
    headline = figures.filter((f) => fields.includes(f.field));
    if (headline.length) break;
  }
  let runs = null;
  let statement = null;
  if (e.category === 'exportable') {
    runs = e.runs_locally?.value ?? null;
    statement = e.summary?.local ?? null;
  } else if (e.category === 'streamed') {
    const t = `${e.price ?? ''} ${e.what_it_shows ?? ''}`;
    runs = /self-hosted|free download|open-weights/i.test(t) ? true : null;
    statement = figures.length ? headline.map((f) => f.text).join(' | ') : null;
  } else if (e.category === 'hosted_wrapper') {
    runs = false;
    statement = 'Hosted by the wrapper. Nothing runs on your GPU.';
  }
  return { runs_locally: runs, statement, headline, figures };
}

function exportsFor(e) {
  if (e.category === 'exportable') {
    const formats = (e.outputs ?? []).map((o) => ({ format: o.format, ...(o.detail ? { detail: o.detail } : {}), tier: o.tier }));
    const tags = [...new Set(formats.flatMap((f) => formatTags(`${f.format} ${f.detail ?? ''}`)))];
    return { tags, formats, you_get: e.summary?.you_get ?? null };
  }
  if (e.category === 'hosted_wrapper') {
    const tags = formatTags(e.you_get ?? '');
    return { tags, formats: [], you_get: e.you_get ?? null };
  }
  if (e.category === 'streamed') {
    return { tags: [], formats: [], you_get: null, none_because: e.why_no_export ?? null };
  }
  return { tags: [], formats: [], you_get: null };
}

export function normalise(raw) {
  const out = [];
  const byId = new Map();
  const all = [...raw.exportable, ...raw.streamed, ...raw.hosted_wrappers, ...raw.announced];
  for (const e of all) {
    const rec = {
      id: e.id,
      name: e.name,
      vendor: e.vendor,
      category: e.category,
      vendor_url: e.vendor_url,
      price: e.summary?.price ?? e.price ?? null,
      exports: exportsFor(e),
      commercial: null,
      hardware: null,
      reported: [],
      open_weights: e.open_weights ? { value: e.open_weights.value, licence: e.open_weights.licence, url: e.open_weights.url } : null,
      licence: e.licence ?? null,
      last_verified: e.last_verified,
      sources: e.sources ?? [],
      notes: e.notes ?? null,
      contact_route: e.contact_route ?? null,
      first_listed: e.first_listed ?? null,
      what_it_shows: e.what_it_shows ?? null,
    };
    if (e.category === 'announced') {
      rec.announced_on = e.announced_on;
      rec.access = e.access;
      rec.why_not_listed = e.why_not_listed;
      rec.commercial = { state: 'not-published', reason: 'Announced, not released. The registry records no terms.', flags: [], commercial_word_quoted: false, grants: [], restrictions: [] };
      rec.hardware = { runs_locally: null, statement: null, headline: [], figures: [] };
    } else {
      rec.commercial = commercialFor(e);
      rec.hardware = hardwareFor(e);
      rec.reported = reportedFigures(e).map((r) => ({ ...r, read_on: e.last_verified }));
    }
    if (e.category === 'hosted_wrapper') {
      rec.underlying_model = e.underlying_model;
      rec.underlying_entry_id = e.underlying_entry_id && e.underlying_entry_id !== 'not published' ? e.underlying_entry_id : null;
    }
    out.push(rec);
    byId.set(rec.id, rec);
  }
  // A wrapper sells someone else's model. The underlying terms still govern, so show them.
  for (const rec of out) {
    if (rec.category !== 'hosted_wrapper') continue;
    const under = rec.underlying_entry_id ? byId.get(rec.underlying_entry_id) : null;
    if (under) {
      rec.commercial = {
        ...under.commercial,
        inherited_from: under.id,
        reason: `The underlying model's terms govern (${under.name}). ${under.commercial.reason}`,
      };
    } else {
      rec.commercial = {
        state: 'not-published',
        reason: `The registry records no terms for this wrapper. The underlying vendor's terms still govern the output (${rec.underlying_model ?? 'underlying model not named'}).`,
        flags: [],
        commercial_word_quoted: false,
        grants: [],
        restrictions: [],
      };
    }
  }
  return out;
}

export function sourceUrls(raw) {
  // Every URL the registry cites, with the entry ids and roles that cite it.
  const map = new Map();
  const add = (url, id, role) => {
    if (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url)) return;
    const u = map.get(url) ?? { url, used_by: [] };
    if (!u.used_by.some((x) => x.id === id && x.role === role)) u.used_by.push({ id, role });
    map.set(url, u);
  };
  const walk = (x, id, role) => {
    if (Array.isArray(x)) x.forEach((v) => walk(v, id, role));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, id, k === 'url' ? 'quote' : k);
    else add(x, id, role);
  };
  for (const k of ['exportable', 'streamed', 'hosted_wrappers', 'announced', 'object_only']) {
    for (const e of raw[k]) {
      add(e.vendor_url, e.id, 'vendor');
      for (const s of e.sources ?? []) add(s, e.id, 'source');
      for (const [key, val] of Object.entries(e)) {
        if (['vendor_url', 'sources', 'id', 'name'].includes(key)) continue;
        walk(val, e.id, key);
      }
    }
  }
  return [...map.values()];
}
