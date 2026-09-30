// Plain-text renderers for the CLI. Same content as the JSON, laid out to read in a terminal.

const L = (s = '') => s;

function head(r) {
  const reg = r.registry;
  const lines = [`World Model Registry v${reg.version}, last verified ${reg.last_verified} (${reg.age_days} days ago, ${reg.source} copy)`];
  if (reg.stale_warning) lines.push(`WARN ${reg.stale_warning}`);
  return lines;
}

function wrap(text, width = 100, indent = '    ') {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = indent;
  for (const w of words) {
    if (line.length + w.length + 1 > width && line.trim()) {
      out.push(line);
      line = indent;
    }
    line += (line.trim() ? ' ' : '') + w;
  }
  if (line.trim()) out.push(line);
  return out;
}

export function renderSearch(r, title = 'Matches') {
  const out = [...head(r), '', `${title}: ${r.count}${r.shown < r.count ? ` (showing ${r.shown})` : ''}`, ''];
  for (const x of r.results) {
    out.push(`${x.name}  [${x.id}]  ${x.vendor}  (${x.category})`);
    out.push(`  exports: ${x.exports.length ? x.exports.join(', ') : 'none'}    local: ${x.hardware.runs_locally ?? 'not recorded'}    read ${x.read_on}`);
    out.push(`  commercial: ${x.commercial.state}${x.commercial.flags.length ? ' (' + x.commercial.flags.join(', ') + ')' : ''}`);
    const h = x.commercial.headline_clause;
    if (h) {
      out.push(`  ${h.from}${h.section ? ', ' + h.section : ''}:`);
      out.push(...wrap(`"${h.quote}"`, 100, '    '));
      out.push(`    ${h.url}  (read ${h.read_on})`);
    }
    if (x.hardware.statement) out.push(`  hardware: ${x.hardware.statement}`);
    if (x.fit) out.push(`  fit at ${x.fit.vram_gb} GB: ${x.fit.verdict}. ${x.fit.why}`);
    if (x.catches?.length) for (const c of x.catches) out.push(`  catch: ${c}`);
    out.push('');
  }
  out.push(r.order);
  return out.join('\n');
}

export function renderChoose(r) {
  const out = [...head(r), ''];
  out.push(`Task: ${r.task ?? 'custom needs'}${r.task_describes ? ' (' + r.task_describes + ')' : ''}`);
  out.push(`Needs: ${JSON.stringify(r.needs)}`);
  out.push('');
  out.push(`Meets every need: ${r.meets_count}`);
  out.push('');
  for (const x of r.meets) {
    out.push(`${x.name}  [${x.id}]  ${x.vendor}  (${x.category})`);
    out.push(`  matched because: ${x.matched_because.join('; ') || 'category'}`);
    out.push(`  commercial: ${x.commercial.state}  read ${x.read_on}`);
    const h = x.commercial.headline_clause;
    if (h) out.push(...wrap(`${h.from}${h.section ? ', ' + h.section : ''}: "${h.quote}"`, 100, '    '));
    for (const c of x.catches) out.push(`  catch: ${c}`);
    out.push('');
  }
  if (r.excluded.length) {
    out.push(`Left out: ${r.excluded_count}`);
    for (const x of r.excluded) out.push(`  ${x.id}: ${x.because.join('; ')}`);
    out.push('');
  }
  out.push(r.order);
  return out.join('\n');
}

export function renderFit(r) {
  const out = [...head(r), '', `GPU memory: ${r.vram_gb} GB`, r.method, ''];
  out.push('Counts: ' + Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', '));
  out.push('');
  for (const x of r.results) {
    out.push(`${x.verdict.toUpperCase().padEnd(13)} ${x.name} [${x.id}]  read ${x.read_on}`);
    out.push(...wrap(x.why, 100, '              '));
    for (const f of x.quoted_at_or_below ?? []) out.push(...wrap(`at or below ${r.vram_gb} GB, ${f.gb} GB: "${f.text}"`, 100, '              '));
    for (const f of x.quoted_above ?? []) out.push(...wrap(`above ${r.vram_gb} GB, ${f.gb} GB: "${f.text}"`, 100, '              '));
    if (x.caution) out.push(...wrap(x.caution, 100, '              '));
  }
  return out.join('\n');
}

export function renderReported(r) {
  const out = [...head(r), '', ...wrap(r.note, 100, ''), '', `Entries: ${r.count}`, ''];
  for (const x of r.results) {
    out.push(`${x.name} [${x.id}]  read ${x.read_on}`);
    if (x.hardware) out.push(...wrap(`hardware stated: ${x.hardware}`, 100, '  '));
    for (const f of x.reported) out.push(...wrap(`${f.kinds.join('+')}: "${f.text}"  (${f.field})`, 100, '  '));
    out.push('');
  }
  return out.join('\n');
}

export function renderChanges(r) {
  const out = [...head(r), '', `Changes: ${r.count}${r.shown < r.count ? ` (showing ${r.shown})` : ''}`, ''];
  for (const c of r.results) {
    out.push(`${c.date}  ${c.entry}  ${c.field}`);
    out.push(...wrap(`was: ${c.was}`, 100, '    '));
    out.push(...wrap(`now: ${c.now}`, 100, '    '));
    out.push(`    ${c.source}  (read ${c.read_on})`);
    out.push('');
  }
  return out.join('\n');
}

export function renderGet(r) {
  const e = r.entry;
  const out = [...head(r), ''];
  if (!e.grants && !e.restrictions) {
    return [...out, JSON.stringify(e, null, 2)].join('\n');
  }
  out.push(`${e.name}  [${e.id}]  ${e.vendor}  (${e.category})`);
  out.push(`${e.vendor_url}`);
  out.push(`read ${e.read_on}`);
  out.push('');
  out.push(`Commercial state: ${e.commercial_state}`);
  out.push(...wrap(e.commercial_reason, 100, '  '));
  out.push('');
  const clause = (c) => {
    const o = [`- ${c.tier ?? c.topic}  [${c.status ?? 'quoted'}${c.flag ? ', ' + c.flag : ''}]${c.section ? '  ' + c.section : ''}`];
    if (c.quote) o.push(...wrap(`"${c.quote}"`, 100, '    '));
    if (c.registry_text) o.push(...wrap(`registry text: ${c.registry_text}`, 100, '    '));
    if (c.url) o.push(`    ${c.url}  (read ${c.read_on})`);
    return o;
  };
  if (e.grants.length) {
    out.push('What you are granted');
    for (const c of e.grants) out.push(...clause(c));
    out.push('');
  }
  if (e.restrictions.length) {
    out.push('Catches');
    for (const c of e.restrictions) out.push(...clause(c));
    out.push('');
  }
  if (e.exports.formats.length) {
    out.push('Exports');
    for (const f of e.exports.formats) out.push(`- ${f.format}${f.detail ? ': ' + f.detail : ''}`);
    out.push('');
  }
  if (e.hardware.statement) out.push(...wrap(`Hardware: ${e.hardware.statement}`, 100, ''), '');
  if (e.reported.length) {
    out.push('Vendor-reported figures');
    for (const f of e.reported) out.push(...wrap(`${f.kinds.join('+')}: "${f.text}"`, 100, '  '));
    out.push('');
  }
  if (e.link_check) out.push(`Links: ${e.link_check.live} of ${e.link_check.total} live on ${e.link_check.checked_on}${e.link_check.blocked ? ', ' + e.link_check.blocked + ' blocked' : ''}${e.link_check.dead ? ', ' + e.link_check.dead + ' dead' : ''}`, '');
  out.push('Sources');
  for (const s of e.sources) out.push(`  ${s}`);
  return out.join('\n');
}

export function renderInfo(r) {
  const out = [...head(r), ''];
  out.push(`Cite: ${r.registry.cite}`);
  out.push(`Counts: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out.push(`Out of scope by name: ${r.object_only_out_of_scope.join(', ')}`);
  if (r.link_check) {
    const s = r.link_check.summary;
    out.push(`Links checked ${r.link_check.checked_on}: ${s.urls} URLs, ${s.live} live, ${s.blocked} blocked, ${s.dead} dead, ${s.error} errored`);
  }
  out.push(L(r.registry.note));
  return out.join('\n');
}
