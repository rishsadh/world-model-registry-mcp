import test from 'node:test';
import assert from 'node:assert/strict';
import { vramFigures, reportedFigures, clauses } from '../src/extract.mjs';

test('clauses splits on semicolons and sentence ends, not on decimals', () => {
  assert.deepEqual(clauses('8.5s at 51GB; 16.6s at 30GB. Next one'), ['8.5s at 51GB', '16.6s at 30GB', 'Next one']);
});

test('vramFigures reads GB, G and lower-case g, with the clause around each figure', () => {
  const e = { runs_locally: { vram: 'Whole pipeline minimum 16G; PanoVideoGen about 60g (about 19g low-VRAM); needs 24 GB' } };
  const figs = vramFigures(e);
  assert.deepEqual(figs.map((f) => f.gb).sort((a, b) => a - b), [16, 19, 24, 60]);
  assert.ok(figs.every((f) => f.field === 'runs_locally.vram' && f.text.length > 0));
});

test('vramFigures ignores system RAM, disk and storage', () => {
  const e = { price: 'Hardware: A and H series GPUs tested, 64 GB RAM, Linux.', notes: '100 GB disk space needed' };
  assert.deepEqual(vramFigures(e), []);
});

test('vramFigures does not read model sizes or GPU names as memory', () => {
  const e = { summary: { local: 'The 14B model on an A800 or H20, at 720p' } };
  assert.deepEqual(vramFigures(e), []);
});

test('reportedFigures finds fps, latency and ranges', () => {
  const e = { what_it_shows: 'Streams 720P video at 22 FPS, under 200ms latency; older version at 20-24 frames per second' };
  const r = reportedFigures(e);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].kinds.sort(), ['fps', 'latency', 'resolution']);
  assert.equal(r[0].fps, 22);
  assert.equal(r[1].fps, 24);
});

test('reportedFigures does not count a default or a CLI flag as a report', () => {
  const e = { outputs: [{ detail: 'CLI flag --video, default 15 fps' }] };
  assert.deepEqual(reportedFigures(e), []);
});

test('reportedFigures finds generation time only when tied to a generation or hardware', () => {
  const hit = reportedFigures({ notes: 'About an hour to generate a 720p video on an A800 GPU' });
  assert.deepEqual(hit[0].kinds.sort(), ['generation-time', 'resolution']);
  assert.deepEqual(reportedFigures({ notes: 'Up to 2 minutes of video at 720p' }), []);
  assert.deepEqual(reportedFigures({ price: 'you will not need to use your AI credits to generate worlds' }), []);
});

test('a mention with no figure returns nothing rather than a guess', () => {
  assert.deepEqual(vramFigures({ summary: { local: 'Yes. VRAM figure not published.' } }), []);
  assert.deepEqual(reportedFigures({ what_it_shows: 'A real-time world model' }), []);
});
