// A minimal Model Context Protocol server over stdio, with no dependencies.
// Transport: one JSON-RPC message per line on stdin, one per line on stdout. Logs go to stderr.
// It implements initialize, ping, tools/list and tools/call, which is all a read-only query server needs.

import readline from 'node:readline';
import * as Q from './query.mjs';
import { CATEGORIES, EXPORT_TAGS, COMMERCIAL_FILTERS, TASKS, QueryError } from './query.mjs';

export const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const COMMON_FILTERS = {
  exports: {
    type: 'array',
    items: { type: 'string', enum: EXPORT_TAGS },
    description: 'File types the model must hand you, all of them. splat, mesh, pointcloud, panorama, video, depth, camera-poses, viewer.',
  },
  exports_any: {
    type: 'array',
    items: { type: 'string', enum: EXPORT_TAGS },
    description: 'File types where any one is enough.',
  },
  commercial: {
    type: 'string',
    enum: COMMERCIAL_FILTERS,
    description:
      'Commercial-use state recorded in the registry. usable = a grant is quoted, with or without conditions. no-conflict = anything except conflict. explicit = a quoted grant uses the word commercial. conflict = a clause or source says no, or sources disagree. This reads the registry. It is not legal advice.',
  },
  local: { type: 'boolean', description: 'true: the registry records it as runnable on your own GPU.' },
  open_weights: { type: 'boolean', description: 'true: the registry records the weights as open.' },
  fits_vram_gb: { type: 'number', description: 'Keep only models whose lowest quoted GPU memory figure is at or below this many GB.' },
  min_fps: { type: 'number', description: 'Keep only models with a vendor-reported frame rate at or above this. Reported, not measured.' },
  text: { type: 'string', description: 'Words to find in the name, vendor, what you get or what it shows.' },
  vendor: { type: 'string', description: 'Part of the vendor name.' },
};

export const TOOLS = [
  {
    name: 'registry_search',
    title: 'Search the world model registry',
    description:
      'Find world models and scene generators by the file they export, commercial-use state, hardware, open weights or reported frame rate. ' +
      'Each result carries its quoted clause, the section and URL it came from, and the date the registry read it. ' +
      'Results are in the registry\'s own order, never ranked.',
    inputSchema: {
      type: 'object',
      properties: {
        ...COMMON_FILTERS,
        category: {
          type: 'array',
          items: { type: 'string', enum: CATEGORIES },
          description: 'exportable (hands you a file), streamed (shows a world, no file), hosted_wrapper, announced. Default: the first three.',
        },
        include_announced: { type: 'boolean', description: 'Also list announced-but-unreleased entries.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 10.' },
      },
      additionalProperties: false,
    },
    run: (reg, a) => Q.search(reg, a),
  },
  {
    name: 'registry_get',
    title: 'Get one registry entry with its clauses',
    description:
      'One entry by id or name. detail "clauses" (default) returns every quoted grant and restriction with section, URL and read date, plus licence, exports, hardware, reported figures and sources. ' +
      '"summary" is short. "full" is the registry\'s own JSON for the entry.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Entry id such as marble or flashworld, or its name.' },
        detail: { type: 'string', enum: ['summary', 'clauses', 'full'] },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (reg, a) => Q.get(reg, a.id, a.detail ?? 'clauses'),
  },
  {
    name: 'registry_fit',
    title: 'Check a GPU\'s memory against quoted requirements',
    description:
      'Checks a VRAM size in GB against the GPU memory figures the registry quotes for each model. Verdicts: fits, exceeds, not-published, unknown, hosted. ' +
      'The figures are vendor-stated and copied as written, with the clause they sit in. Nothing is measured. Stage-level figures are flagged so they are not mistaken for the whole pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        vram_gb: { type: 'number', description: 'Your GPU memory in GB, for example 24.' },
        id: { type: 'array', items: { type: 'string' }, description: 'Limit to these entries. Default: all exportable and streamed entries.' },
        only: { type: 'array', items: { type: 'string', enum: ['fits', 'exceeds', 'not-published', 'unknown', 'hosted'] } },
      },
      required: ['vram_gb'],
      additionalProperties: false,
    },
    run: (reg, a) => Q.fit(reg, a),
  },
  {
    name: 'registry_reported',
    title: 'Vendor-reported frame rate, latency and generation time',
    description:
      'Frame rates, latencies and generation times the registry quotes from vendor pages, with the hardware the vendor named. These are reported figures, not a measured probe.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'array', items: { type: 'string' }, description: 'Limit to these entries.' },
        min_fps: { type: 'number' },
      },
      additionalProperties: false,
    },
    run: (reg, a) => Q.reported(reg, a),
  },
  {
    name: 'registry_changes',
    title: 'Recent changes to registry entries',
    description: 'The registry\'s change log: what a clause, price or page said before and now, with the source and the date read. Use it to see whether terms moved.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'YYYY-MM-DD' },
        id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: (reg, a) => Q.changes(reg, a),
  },
  {
    name: 'registry_choose',
    title: 'Shortlist world models for a task',
    description:
      'Turns a task, or a list of needs, into a shortlist with the catches attached: commercial conditions, hardware, hosted or local. ' +
      'Also lists what was excluded and why. A task is shorthand for filters: ' +
      Object.entries(TASKS)
        .map(([k, v]) => `${k} (${v.describe})`)
        .join('; ') +
      '. Not a ranking. Read each clause before choosing.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', enum: Object.keys(TASKS) },
        ...COMMON_FILTERS,
        category: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
      },
      additionalProperties: false,
    },
    run: (reg, a) => Q.choose(reg, a),
  },
  {
    name: 'registry_info',
    title: 'Registry version, dates and how to cite it',
    description: 'Which registry copy is loaded, when it was last verified, how old it is, the counts per category, and the citation string.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (reg) => ({
      registry: Q.briefInfo(reg.info),
      counts: Object.fromEntries(CATEGORIES.map((c) => [c, reg.records.filter((r) => r.category === c).length])),
      object_only_out_of_scope: reg.raw.object_only.map((o) => o.name),
      canonical_url: reg.info.canonical_url,
      data_licence: reg.info.data_licence,
      link_check: reg.liveness ? { checked_on: reg.liveness.checked_on, summary: reg.liveness.summary } : null,
    }),
  },
];

const INSTRUCTIONS =
  'Answers come from the World Model Registry, which quotes each vendor clause with the date it was read. ' +
  'When you pass a clause on, pass its read date and its source URL with it, and say it can have changed. ' +
  'State "not published" where the registry says so; do not fill the gap. The registry has no scores and no rankings. This is not legal advice.';

export function createServer({ reg, version = '0.0.0' }) {
  let negotiated = SUPPORTED[0];
  const byName = new Map(TOOLS.map((t) => [t.name, t]));

  function result(id, r) {
    return { jsonrpc: '2.0', id, result: r };
  }
  function error(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  function callTool(name, args) {
    const tool = byName.get(name);
    if (!tool) return null;
    try {
      const out = tool.run(reg, args ?? {});
      const text = JSON.stringify(out);
      const res = { content: [{ type: 'text', text }], isError: false };
      if (negotiated >= '2025-06-18') res.structuredContent = out;
      return res;
    } catch (e) {
      if (e instanceof QueryError) return { content: [{ type: 'text', text: e.message }], isError: true };
      return { content: [{ type: 'text', text: `internal error: ${e.message}` }], isError: true };
    }
  }

  function handle(msg) {
    if (Array.isArray(msg)) {
      const out = msg.map(handle).filter(Boolean);
      return out.length ? out : null;
    }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg && msg.id !== undefined ? error(msg.id, -32600, 'invalid request') : null;
    }
    const isNotification = msg.id === undefined || msg.id === null;
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        negotiated = SUPPORTED.includes(asked) ? asked : SUPPORTED[0];
        return result(msg.id, {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'world-model-registry-mcp', title: 'World Model Registry', version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return isNotification ? null : result(msg.id, {});
      case 'tools/list':
        return result(msg.id, {
          tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, title },
          })),
        });
      case 'tools/call': {
        const r = callTool(msg.params?.name, msg.params?.arguments);
        if (!r) return error(msg.id, -32602, `unknown tool: ${msg.params?.name}`);
        return result(msg.id, r);
      }
      default:
        if (isNotification) return null; // notifications/initialized, notifications/cancelled and the rest
        return error(msg.id, -32601, `method not found: ${msg.method}`);
    }
  }

  return { handle, get negotiated() { return negotiated; } };
}

export function serveStdio({ reg, version, input = process.stdin, output = process.stdout, log = process.stderr }) {
  const server = createServer({ reg, version });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    let msg;
    try {
      msg = JSON.parse(t);
    } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      return;
    }
    const res = server.handle(msg);
    if (res) output.write(JSON.stringify(res) + '\n');
  });
  log.write(
    `world-model-registry-mcp ${version}: registry v${reg.info.version}, last verified ${reg.info.last_verified} (${reg.info.source}), ${TOOLS.length} tools on stdio\n`
  );
  return new Promise((resolve) => rl.on('close', resolve));
}
