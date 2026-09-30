// Render the registry as an awesome-style list where every line carries its verification stamp:
// the date the registry read the vendor pages, the commercial-use state, and whether the links answered.

import { entryLinkStatus } from './verify.mjs';

const SECTIONS = [
  ['exportable', 'Exportable', 'The tool hands you a file.'],
  ['streamed', 'Streamed only', 'The tool shows you a world and gives you no file.'],
  ['hosted_wrapper', 'Hosted wrappers', 'Resells another entry\'s model. The underlying vendor\'s terms still govern the output.'],
  ['announced', 'Announced, not available', 'Announced by the vendor and not released, so there is no file, price or licence to record.'],
];

function ascii(s) {
  return String(s ?? '')
    .replace(/[–—]/g, ', ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

// A URL without its query, fragment, trailing slash or leading www., for telling a real move from a tidy-up.
export function plain(u) {
  const x = new URL(u);
  return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}`.toLowerCase();
}

function linkStamp(ls) {
  if (!ls || !ls.total) return 'links not checked';
  const bits = [`${ls.live} of ${ls.total} links live`];
  if (ls.blocked) bits.push(`${ls.blocked} blocked`);
  if (ls.dead) bits.push(`${ls.dead} dead`);
  if (ls.error) bits.push(`${ls.error} errored`);
  return `${bits.join(', ')} on ${ls.checked_on}`;
}

export function renderAwesome(reg, liveness) {
  const info = reg.info;
  const L = [];
  L.push('# Verified world models');
  L.push('');
  L.push(
    'An awesome-style list of world models and scene generators. Every line carries the date the registry read the vendor\'s pages, the commercial-use state, and whether the source links answered. ' +
      'It is generated from the [World Model Registry](' + info.canonical_url + ') by `world-model-registry-mcp awesome` and is not edited by hand.'
  );
  L.push('');
  const s = liveness?.summary;
  L.push(
    `Registry version ${info.version}, last verified ${info.last_verified}. ` +
      (s
        ? `Links checked ${liveness.checked_on}: ${s.urls} URLs, ${s.live} live, ${s.blocked} blocked, ${s.dead} dead, ${s.error} errored.`
        : 'Links have not been checked yet.')
  );
  L.push('');
  L.push('How to read a line. The commercial state is one of quoted-grant, licence-named, conditions, conflict or not-published. `conflict` means a clause or a source says no, or two sources disagree. `blocked` means a site refused the automated check, not that the page is gone. A live link does not prove the quoted text is still on the page. This is not legal advice and it has no scores or rankings.');
  L.push('');
  for (const [cat, title, blurb] of SECTIONS) {
    const rows = reg.records.filter((r) => r.category === cat);
    if (!rows.length) continue;
    L.push(`## ${title}`);
    L.push('');
    L.push(blurb);
    L.push('');
    for (const r of rows) {
      const ls = entryLinkStatus(liveness, r.id);
      const parts = [];
      if (r.exports.tags.length) parts.push(`Exports ${r.exports.tags.join(', ')}.`);
      else if (cat === 'streamed') parts.push('No file export.');
      const c = r.commercial;
      if (cat !== 'announced') parts.push(`Commercial: ${c.state}${c.flags.length ? ' (' + c.flags.join(', ') + ')' : ''}.`);
      if (cat === 'exportable' || cat === 'streamed') {
        parts.push(`Local: ${r.hardware.runs_locally === true ? 'yes' : r.hardware.runs_locally === false ? 'no' : 'not recorded'}.`);
      }
      parts.push(`Read ${r.last_verified}; ${linkStamp(ls)}.`);
      L.push(`- [${ascii(r.name)}](${r.vendor_url}) by ${ascii(r.vendor)}. ${ascii(parts.join(' '))}`);
    }
    L.push('');
  }
  const out = reg.raw.object_only;
  if (out.length) {
    L.push('## Object-level, out of scope');
    L.push('');
    L.push('Single-object generators, a chair rather than a room. Listed so a reader knows they were considered. Not covered.');
    L.push('');
    for (const o of out) L.push(`- [${ascii(o.name)}](${o.vendor_url}) by ${ascii(o.vendor)}. Read ${o.last_verified}.`);
    L.push('');
  }
  if (liveness) {
    const bad = Object.entries(liveness.results).filter(([, r]) => r.status !== 'live');
    const moved = Object.entries(liveness.results).filter(([u, r]) => r.status === 'live' && r.final_url && plain(r.final_url) !== plain(u));
    if (bad.length || moved.length) {
      L.push('## Link check detail');
      L.push('');
      if (bad.length) {
        L.push('Links that did not answer with a 2xx on ' + liveness.checked_on + ':');
        L.push('');
        for (const [u, r] of bad) L.push(`- ${r.status} ${r.code ?? r.error ?? ''}: ${u} (${[...new Set(r.used_by.map((x) => x.id))].join(', ')})`);
        L.push('');
      }
      if (moved.length) {
        L.push('Links that answered from a different address than the registry cites, so the registry entry may need updating:');
        L.push('');
        for (const [u, r] of moved) L.push(`- ${u} -> ${r.final_url}`);
        L.push('');
      }
    }
  }
  L.push('## Credit');
  L.push('');
  L.push(`Data from the World Model Registry by Rish Sadh, CC BY 4.0. ${ascii(info.citation)}`);
  L.push('');
  return L.join('\n');
}
