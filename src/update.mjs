// Refresh the registry copy from the canonical URL. By default the copy goes to the user cache, never
// into the package. A maintainer working in a clone can pass toBundle to refresh data/registry.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED, SNAPSHOT, CANONICAL_URL, cachePath, validate, today } from './registry.mjs';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export async function updateRegistry({ url = CANONICAL_URL, fetchImpl = globalThis.fetch, toBundle = false, dryRun = false, now = new Date() } = {}) {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'world-model-registry-mcp (update)', accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const text = await res.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
  const errors = validate(raw);
  if (errors.length) throw new Error(`downloaded file is not a valid registry: ${errors.slice(0, 5).join('; ')}`);
  const buf = Buffer.from(text, 'utf8');
  const digest = sha256(buf);
  const current = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const out = {
    url,
    from: { version: current.meta.version, last_verified: current.meta.last_verified, sha256: sha256(fs.readFileSync(BUNDLED)) },
    to: { version: raw.meta.version, last_verified: raw.meta.last_verified, sha256: digest },
    changed: digest !== sha256(fs.readFileSync(BUNDLED)),
    wrote: [],
  };
  if (dryRun) return out;
  if (raw.meta.last_verified < current.meta.last_verified) {
    out.note = 'The downloaded registry is older than the bundled copy, so it was not written.';
    return out;
  }
  const target = toBundle ? BUNDLED : cachePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  out.wrote.push(target);
  if (toBundle) {
    const snap = {
      source: url,
      registry_version: raw.meta.version,
      last_verified: raw.meta.last_verified,
      fetched_on: today(now),
      sha256: digest,
      bytes: buf.length,
      data_licence: 'CC BY 4.0',
      attribution: raw.meta.citation,
    };
    fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + '\n');
    out.wrote.push(SNAPSHOT);
  }
  return out;
}
