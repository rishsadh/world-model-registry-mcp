#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRegistry } from '../src/open.mjs';
import * as Q from '../src/query.mjs';
import { serveStdio, TOOLS } from '../src/mcp.mjs';
import * as F from '../src/format.mjs';
import { verifyLinks, changedSince, loadLiveness } from '../src/verify.mjs';
import { renderAwesome } from '../src/awesome.mjs';
import { updateRegistry } from '../src/update.mjs';
import { ROOT } from '../src/registry.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const HELP = `world-model-registry-mcp ${pkg.version}
An MCP server and skill over the world model registry, with the quoted clause and read date on every answer.

Usage: world-model-registry-mcp <command> [options]

Serve
  serve                     Run the MCP server on stdio. This is also the default when stdin is piped.

Ask
  search                    Find models. --exports splat --commercial usable --local --fits 24 --min-fps 30
  show <id>                 One entry with every quoted clause. --detail summary|clauses|full
  fit --vram 24             Check GPU memory against the quoted requirements. --only fits
  reported [--id x]         Vendor-reported fps, latency and generation time. --min-fps 30
  changes                   The change log. --since 2026-09-01 --id marble
  choose --task <task>      Shortlist for a task, with catches. Tasks: ${Object.keys(Q.TASKS).join(', ')}
  info                      Registry version, dates, counts and citation

Keep it honest
  verify --write <file>     Check that every source link answers. Writes a dated liveness record.
  awesome [--write <file>]  Render the awesome-style list with the read date and link stamp on every line
  update                    Download the current registry into your cache. --to-bundle refreshes data/ in a clone
  skill [--copy <dir>]      Print the path of the choose-a-world-model skill, or copy it into a directory

Options for any command
  --json                    Print JSON instead of text
  --data <file>             Use this registry file instead of the bundled copy
  --help, -h                This text

Filters take repeated or comma-separated values: --exports splat,mesh. Commercial values:
${Q.COMMERCIAL_FILTERS.join(', ')}.
Nothing here is legal advice. Clauses can change after the read date shown with them.
`;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') opt.help = true;
    else if (a.startsWith('--no-')) opt[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) opt[key] = true;
      else {
        i++;
        if (key in opt && opt[key] !== true && opt[key] !== false) opt[key] = [].concat(opt[key], nxt);
        else opt[key] = nxt;
      }
    } else pos.push(a);
  }
  return { pos, opt };
}

function filtersFrom(opt) {
  const f = {};
  for (const k of ['exports', 'exports_any', 'category', 'commercial', 'text', 'vendor', 'task', 'limit', 'min_fps', 'since', 'id']) {
    if (opt[k] !== undefined && opt[k] !== true) f[k] = opt[k];
  }
  if (opt.fits !== undefined) f.fits_vram_gb = opt.fits;
  if (opt.fits_vram_gb !== undefined) f.fits_vram_gb = opt.fits_vram_gb;
  if (opt.local !== undefined) f.local = opt.local;
  if (opt.open_weights !== undefined) f.open_weights = opt.open_weights;
  if (opt.include_announced) f.include_announced = true;
  return f;
}

function emit(opt, data, render) {
  process.stdout.write((opt.json ? JSON.stringify(data, null, 2) : render(data)) + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const { pos, opt } = parseArgs(argv);
  let cmd = pos.shift();
  if (!cmd && !opt.help) cmd = process.stdin.isTTY ? 'help' : 'serve';
  if (opt.help || cmd === 'help' || cmd === undefined) {
    process.stdout.write(HELP);
    return;
  }
  const open = () => openRegistry({ data: typeof opt.data === 'string' ? opt.data : undefined });
  switch (cmd) {
    case 'serve':
      await serveStdio({ reg: open(), version: pkg.version });
      return;
    case 'search':
      return emit(opt, Q.search(open(), filtersFrom(opt)), (d) => F.renderSearch(d));
    case 'show': {
      const id = pos[0] ?? opt.id;
      if (!id) throw new Q.QueryError('show needs an id, for example: show marble');
      return emit(opt, Q.get(open(), id, opt.detail ?? 'clauses'), F.renderGet);
    }
    case 'fit': {
      const vram = opt.vram ?? opt.vram_gb ?? pos[0];
      if (vram === undefined || vram === true) throw new Q.QueryError('fit needs --vram <GB>, for example: fit --vram 24');
      return emit(opt, Q.fit(open(), { vram_gb: vram, id: opt.id, only: opt.only }), F.renderFit);
    }
    case 'reported':
      return emit(opt, Q.reported(open(), { id: opt.id, min_fps: opt.min_fps }), F.renderReported);
    case 'changes':
      return emit(opt, Q.changes(open(), { since: opt.since, id: opt.id, limit: opt.limit }), F.renderChanges);
    case 'choose':
      return emit(opt, Q.choose(open(), filtersFrom(opt)), F.renderChoose);
    case 'info': {
      const tool = TOOLS.find((t) => t.name === 'registry_info');
      return emit(opt, tool.run(open()), F.renderInfo);
    }
    case 'verify': {
      const reg = open();
      const prev = loadLiveness(typeof opt.write === 'string' ? opt.write : undefined);
      const res = await verifyLinks(reg.raw, {
        gapMs: opt.gap_ms ? Number(opt.gap_ms) : 1500,
        version: pkg.version,
        log: (m) => process.stderr.write(m + '\n'),
      });
      const moved = changedSince(prev, res);
      if (typeof opt.write === 'string') {
        fs.mkdirSync(path.dirname(path.resolve(opt.write)), { recursive: true });
        fs.writeFileSync(opt.write, JSON.stringify(res, null, 2) + '\n');
        process.stderr.write(`wrote ${opt.write}\n`);
      }
      if (opt.json) process.stdout.write(JSON.stringify({ ...res, changed_since_last_run: moved }, null, 2) + '\n');
      else {
        const s = res.summary;
        process.stdout.write(`Links checked ${res.checked_on}: ${s.urls} URLs, ${s.live} live, ${s.blocked} blocked, ${s.dead} dead, ${s.error} errored\n`);
        for (const [u, r] of Object.entries(res.results)) if (r.status !== 'live') process.stdout.write(`${r.status.padEnd(8)} ${r.code ?? r.error ?? ''}  ${u}\n`);
        for (const m of moved) process.stdout.write(`changed  ${m.was} -> ${m.now}  ${m.url}\n`);
      }
      if (opt.fail_on_dead && res.summary.dead > 0) process.exitCode = 1;
      return;
    }
    case 'awesome': {
      const reg = open();
      const liveness = typeof opt.liveness === 'string' ? loadLiveness(opt.liveness) : reg.liveness;
      const md = renderAwesome(reg, liveness);
      if (typeof opt.write === 'string') {
        fs.writeFileSync(opt.write, md);
        process.stdout.write(`wrote ${opt.write}\n`);
      } else process.stdout.write(md);
      return;
    }
    case 'update': {
      const r = await updateRegistry({ dryRun: !!opt.dry_run, toBundle: !!opt.to_bundle });
      if (opt.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      else {
        process.stdout.write(`From v${r.from.version} verified ${r.from.last_verified}\nTo   v${r.to.version} verified ${r.to.last_verified}\n`);
        process.stdout.write(r.changed ? 'The downloaded registry differs from the bundled copy.\n' : 'The downloaded registry matches the bundled copy.\n');
        if (r.note) process.stdout.write(r.note + '\n');
        for (const w of r.wrote) process.stdout.write(`wrote ${w}\n`);
        if (opt.dry_run) process.stdout.write('dry run, nothing written\n');
      }
      return;
    }
    case 'skill': {
      const dir = path.join(ROOT, 'skills', 'choose-a-world-model');
      if (typeof opt.copy === 'string') {
        const dest = path.resolve(opt.copy, 'choose-a-world-model');
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(path.join(dir, 'SKILL.md'), path.join(dest, 'SKILL.md'));
        process.stdout.write(`copied to ${dest}\n`);
      } else process.stdout.write(path.join(dir, 'SKILL.md') + '\n');
      return;
    }
    default:
      process.stderr.write(`unknown command "${cmd}". Run with --help.\n`);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  if (e instanceof Q.QueryError) process.stderr.write(`${e.message}\n`);
  else process.stderr.write(`${e.stack || e.message}\n`);
  process.exitCode = 1;
});
