import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateRegistry, sha256 } from '../src/update.mjs';
import { BUNDLED } from '../src/registry.mjs';
import { TOOLS } from '../src/mcp.mjs';
import { TASKS } from '../src/query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'cli.mjs');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input: '' });

test('--help lists every command and the task names', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  for (const c of ['serve', 'search', 'show', 'fit', 'reported', 'changes', 'choose', 'info', 'verify', 'awesome', 'update', 'skill']) assert.match(r.stdout, new RegExp(`\\b${c}\\b`));
  for (const t of Object.keys(TASKS)) assert.ok(r.stdout.includes(t), t);
  assert.match(r.stdout, /not legal advice/);
});

test('search --json prints the same structure the MCP tool returns', () => {
  const r = run('search', '--exports', 'splat', '--commercial', 'usable', '--json');
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok(j.count >= 2);
  assert.ok(j.results.every((x) => x.exports.includes('splat')));
  assert.equal(j.registry.version, '2');
});

test('search text output shows the quote, the read date and the source URL', () => {
  const r = run('search', '--exports', 'splat', '--commercial', 'usable', '--limit', '1');
  assert.match(r.stdout, /vendor quote/);
  assert.match(r.stdout, /read 2026-09-29/);
  assert.match(r.stdout, /https:\/\/github\.com\//);
});

test('fit needs a size and explains a bad one without a stack trace', () => {
  const none = run('fit');
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /fit needs --vram/);
  const bad = run('fit', '--vram', 'RTX 4090');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /cannot read/);
  assert.ok(!/at .*\.mjs:\d+/.test(bad.stderr));
});

test('fit --vram 24 prints verdicts with the quoted clause', () => {
  const r = run('fit', '--vram', '24', '--only', 'fits');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /FITS\s+Matrix-3D/);
  assert.match(r.stdout, /"12 GB with the 5B model in low-VRAM mode"/);
});

test('show prints the quoted clauses for one entry', () => {
  const r = run('show', 'flashworld');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Commercial state: conflict/);
  assert.match(r.stdout, /cc-by-nc-sa-4\.0/);
  assert.match(r.stdout, /Sources/);
});

test('show with an unknown id exits non-zero and lists the ids', () => {
  const r = run('show', 'nonesuch');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no entry matches/);
});

test('choose prints the catches and what was left out', () => {
  const r = run('choose', '--task', 'game-prototype');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Meets every need/);
  assert.match(r.stdout, /Left out/);
  assert.match(r.stdout, /not a ranking/);
});

test('an unknown command exits with 2', () => {
  assert.equal(run('frobnicate').status, 2);
});

test('info, reported and changes run', () => {
  assert.match(run('info').stdout, /Cite: Rish Sadh, "World Model Registry"/);
  assert.match(run('reported', '--min-fps', '30').stdout, /vendor-reported/);
  assert.match(run('changes', '--id', 'marble', '--limit', '2').stdout, /was:/);
});

test('--data points the tool at another registry file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  const f = path.join(dir, 'r.json');
  const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  raw.meta.version = '99';
  fs.writeFileSync(f, JSON.stringify(raw));
  const r = run('info', '--json', '--data', f);
  assert.equal(JSON.parse(r.stdout).registry.version, '99');
});

test('awesome renders to a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  const out = path.join(dir, 'A.md');
  const r = run('awesome', '--write', out);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /^# Verified world models/);
});

test('the skill command prints a SKILL.md that names real tools and real tasks', () => {
  const p = run('skill').stdout.trim();
  const md = fs.readFileSync(p, 'utf8');
  assert.match(md, /^---\nname: choose-a-world-model\ndescription: .{40,}\n---/);
  for (const name of md.match(/registry_[a-z]+/g)) assert.ok(TOOLS.some((t) => t.name === name), `skill names a tool that does not exist: ${name}`);
  for (const task of [...md.matchAll(/`([a-z0-9-]+)` \|$/gm)].map((m) => m[1])) assert.ok(task in TASKS, `skill names a task that does not exist: ${task}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  assert.match(run('skill', '--copy', dir).stdout, /copied to/);
  assert.ok(fs.existsSync(path.join(dir, 'choose-a-world-model', 'SKILL.md')));
});

// update, with the network faked
const respond = (body, status = 200) => async () => ({ ok: status === 200, status, text: async () => body });

test('update refuses a non-registry body, and reports what it would change on a dry run', async () => {
  await assert.rejects(updateRegistry({ fetchImpl: respond('<html>oops</html>') }), /did not return JSON/);
  await assert.rejects(updateRegistry({ fetchImpl: respond('{"meta":{}}') }), /not a valid registry/);
  await assert.rejects(updateRegistry({ fetchImpl: respond('', 500) }), /answered 500/);
  const same = fs.readFileSync(BUNDLED, 'utf8');
  const r = await updateRegistry({ fetchImpl: respond(same), dryRun: true });
  assert.equal(r.changed, false);
  assert.deepEqual(r.wrote, []);
  assert.equal(r.to.sha256, sha256(fs.readFileSync(BUNDLED)));
});

test('update writes a newer registry to the cache and never to the package', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-'));
  const prev = process.env.WMR_MCP_CACHE;
  process.env.WMR_MCP_CACHE = dir;
  const before = sha256(fs.readFileSync(BUNDLED));
  try {
    const raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
    raw.meta.last_verified = '2026-10-20';
    raw.meta.version = '3';
    const r = await updateRegistry({ fetchImpl: respond(JSON.stringify(raw)) });
    assert.equal(r.changed, true);
    assert.equal(r.wrote.length, 1);
    assert.ok(r.wrote[0].startsWith(dir));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).meta.version, '3');
    assert.equal(sha256(fs.readFileSync(BUNDLED)), before);
    raw.meta.last_verified = '2026-01-01';
    const old = await updateRegistry({ fetchImpl: respond(JSON.stringify(raw)) });
    assert.match(old.note, /older than the bundled copy/);
    assert.deepEqual(old.wrote, []);
  } finally {
    if (prev === undefined) delete process.env.WMR_MCP_CACHE;
    else process.env.WMR_MCP_CACHE = prev;
  }
});
