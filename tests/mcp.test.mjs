import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, TOOLS, SUPPORTED } from '../src/mcp.mjs';
import { reg } from './helpers.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');

function server() {
  return createServer({ reg: reg(), version: 'test' });
}
const init = (s, v = '2025-06-18') =>
  s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '0' } } });

test('initialize echoes a supported protocol version and advertises tools only', () => {
  const r = init(server());
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(r.result.capabilities), ['tools']);
  assert.equal(r.result.serverInfo.name, 'world-model-registry-mcp');
  assert.match(r.result.instructions, /read date/);
});

test('initialize falls back to a version it supports when the client asks for an unknown one', () => {
  const r = init(server(), '2099-01-01');
  assert.equal(r.result.protocolVersion, SUPPORTED[0]);
  assert.equal(init(server(), '2024-11-05').result.protocolVersion, '2024-11-05');
});

test('notifications get no reply, ping gets an empty result', () => {
  const s = server();
  assert.equal(s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }), null);
  assert.deepEqual(s.handle({ jsonrpc: '2.0', id: 9, method: 'ping' }).result, {});
});

test('tools/list exposes seven read-only tools with valid schemas', () => {
  const r = server().handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['registry_search', 'registry_get', 'registry_fit', 'registry_reported', 'registry_changes', 'registry_choose', 'registry_info']);
  for (const t of r.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true);
    assert.ok(t.description.length > 40);
  }
  assert.deepEqual(TOOLS.find((t) => t.name === 'registry_fit').inputSchema.required, ['vram_gb']);
});

test('tools/call returns text and structured content for a current protocol', () => {
  const s = server();
  init(s);
  const r = s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'registry_search', arguments: { exports: ['splat'], commercial: 'usable' } } });
  assert.equal(r.result.isError, false);
  const parsed = JSON.parse(r.result.content[0].text);
  assert.deepEqual(parsed, r.result.structuredContent);
  assert.ok(parsed.results.length > 0);
  assert.ok(parsed.results.every((x) => x.read_on && x.commercial.headline_clause));
});

test('an older protocol gets text only', () => {
  const s = server();
  init(s, '2024-11-05');
  const r = s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'registry_info', arguments: {} } });
  assert.equal(r.result.structuredContent, undefined);
  assert.ok(JSON.parse(r.result.content[0].text).counts);
});

test('a bad query is a tool error with a message, not a protocol error', () => {
  const s = server();
  init(s);
  const r = s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'registry_fit', arguments: { vram_gb: 'RTX 4090' } } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /cannot read/);
  const g = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'registry_get', arguments: { id: 'nonesuch' } } });
  assert.equal(g.result.isError, true);
  assert.match(g.result.content[0].text, /no entry matches/);
});

test('an unknown tool and an unknown method are protocol errors', () => {
  const s = server();
  assert.equal(s.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delete_everything' } }).error.code, -32602);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 7, method: 'resources/read' }).error.code, -32601);
  assert.equal(s.handle({ jsonrpc: '1.0', id: 8, method: 'ping' }).error.code, -32600);
});

test('no tool writes anything: every annotation says read-only and open-world is off', () => {
  const r = server().handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  for (const t of r.result.tools) assert.deepEqual([t.annotations.readOnlyHint, t.annotations.openWorldHint], [true, false]);
});

// The real process, over real pipes.
function talk(lines, { args = [], timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => {
      p.kill();
      reject(new Error('timeout'));
    }, timeoutMs);
    p.on('close', () => {
      clearTimeout(t);
      resolve({ out: out.split('\n').filter(Boolean).map((l) => JSON.parse(l)), err });
    });
    p.stdin.end(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  });
}

test('the process speaks newline-delimited JSON-RPC on stdio and logs only to stderr', async () => {
  const { out, err } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'registry_fit', arguments: { vram_gb: 24, only: ['fits'] } } },
    'this is not json',
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  ]);
  assert.equal(out.length, 4); // the notification produced no line
  assert.equal(out[0].id, 1);
  assert.equal(out[1].id, 2);
  assert.ok(out[1].result.structuredContent.results.every((x) => x.verdict === 'fits'));
  assert.equal(out[2].error.code, -32700);
  assert.equal(out[3].result.tools.length, 7);
  assert.match(err, /world-model-registry-mcp .*registry v2/);
});

test('with piped stdin and no command the process serves', async () => {
  const { out } = await talk([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.deepEqual(out[0], { jsonrpc: '2.0', id: 1, result: {} });
});
