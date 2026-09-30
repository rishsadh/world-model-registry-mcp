// Liveness check for every source link the registry cites.
// It answers one question: did the URL respond on the day it was checked. It does not check that the
// quoted text is still on the page, and a blocked response is reported as blocked, not as dead.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sourceUrls, today } from './registry.mjs';

export const LIVENESS_FILE = path.join(ROOT, 'data', 'liveness.json');
export const USER_AGENT = 'world-model-registry-mcp/0.1 (+https://github.com/rishsadh/world-model-registry-mcp; link check, one request per URL)';

export function loadLiveness(file = LIVENESS_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function classify({ code, error }) {
  if (error) return /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(error) ? 'dead' : 'error';
  if (code >= 200 && code < 300) return 'live';
  if (code === 401 || code === 403 || code === 429 || code === 999) return 'blocked';
  if (code === 404 || code === 410 || (code >= 400 && code < 500)) return 'dead';
  return 'error';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GitHub is the host several agents share a token on. It gets 3 seconds between requests.
function gapFor(host, base) {
  return /(^|\.)github\.com$|githubusercontent\.com$/.test(host) ? Math.max(base, 3000) : base;
}

async function probe(url, { timeoutMs, fetchImpl }) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      await res.body?.cancel();
    } catch {
      // the body is not needed
    }
    return { code: res.status, final_url: res.url && res.url !== url ? res.url : undefined };
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || e?.name || '';
    return { error: `${cause || e.message}`.slice(0, 120) };
  }
}

export async function verifyLinks(raw, opts = {}) {
  const {
    gapMs = 1500,
    timeoutMs = 20000,
    retryWaitMs = 65000,
    fetchImpl = globalThis.fetch,
    now = new Date(),
    only,
    log = () => {},
    version = '0.0.0',
  } = opts;
  let items = sourceUrls(raw);
  if (only) items = items.filter((i) => only.includes(i.url));
  const byHost = new Map();
  for (const it of items) {
    const host = new URL(it.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(it);
  }
  const checked = today(now);
  const results = {};
  let done = 0;
  async function worker(host, list) {
    const gap = gapFor(host, gapMs);
    for (const it of list) {
      let r = await probe(it.url, { timeoutMs, fetchImpl });
      if ((r.code === 403 || r.code === 429) && retryWaitMs > 0 && /github|huggingface/.test(host)) {
        log(`  ${host} answered ${r.code}, waiting ${Math.round(retryWaitMs / 1000)}s before one retry`);
        await sleep(retryWaitMs);
        r = await probe(it.url, { timeoutMs, fetchImpl });
      }
      if (r.error && !/ENOTFOUND/.test(r.error)) {
        await sleep(gap);
        const second = await probe(it.url, { timeoutMs, fetchImpl });
        if (!second.error) r = second;
      }
      const status = classify(r);
      results[it.url] = {
        status,
        ...(r.code ? { code: r.code } : {}),
        ...(r.final_url ? { final_url: r.final_url } : {}),
        ...(r.error ? { error: r.error } : {}),
        checked_on: checked,
        used_by: it.used_by,
      };
      done += 1;
      log(`[${done}/${items.length}] ${status}${r.code ? ' ' + r.code : ''}  ${it.url}`);
      await sleep(gap);
    }
  }
  await Promise.all([...byHost.entries()].map(([h, l]) => worker(h, l)));
  const summary = { urls: items.length, live: 0, blocked: 0, dead: 0, error: 0 };
  for (const r of Object.values(results)) summary[r.status] += 1;
  const ordered = Object.fromEntries(Object.keys(results).sort().map((k) => [k, results[k]]));
  return {
    checked_on: checked,
    tool_version: version,
    registry: { version: raw.meta.version, last_verified: raw.meta.last_verified },
    method:
      'One GET per URL, redirects followed, body discarded. live = 2xx. blocked = 401, 403 or 429, which means the page could not be checked, not that it is gone. dead = 404, 410, other 4xx or a DNS failure. error = 5xx, a timeout or a network fault.',
    summary,
    results: ordered,
  };
}

// Per-entry roll-up used by the awesome list and the MCP server.
export function entryLinkStatus(liveness, entryId) {
  if (!liveness) return null;
  const rows = [];
  for (const [url, r] of Object.entries(liveness.results)) {
    if (r.used_by.some((u) => u.id === entryId)) rows.push({ url, status: r.status, code: r.code, final_url: r.final_url, checked_on: r.checked_on });
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { checked_on: liveness.checked_on, total: rows.length, live: count('live'), blocked: count('blocked'), dead: count('dead'), error: count('error'), links: rows };
}

export function changedSince(prev, next) {
  // Links whose status differs from the previous run, for the Action's summary.
  const out = [];
  if (!prev) return out;
  for (const [url, r] of Object.entries(next.results)) {
    const p = prev.results?.[url];
    if (p && p.status !== r.status) out.push({ url, was: p.status, now: r.status });
  }
  return out;
}
