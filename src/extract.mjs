// Pull hardware figures and vendor-reported performance out of the registry's own text.
// Nothing here measures anything. It finds sentences that already say a number and returns the
// sentence, the field it came from, and the number it found, so a reader can check the context.

const SPLIT = /;\s+|\.\s+(?=[A-Z])|\n+/;

export function clauses(text) {
  return String(text ?? '')
    .split(SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(s, n = 240) {
  return s.length <= n ? s : s.slice(0, n - 3).trimEnd() + '...';
}

// Fields of one source entry that can carry hardware or performance statements.
export function textFields(entry) {
  const out = [];
  const add = (field, value) => {
    if (typeof value === 'string' && value && value !== 'not published' && value !== 'not applicable') out.push([field, value]);
  };
  add('summary.local', entry.summary?.local);
  add('runs_locally.vram', entry.runs_locally?.vram);
  add('runs_locally.hardware', entry.runs_locally?.hardware);
  add('what_it_shows', entry.what_it_shows);
  add('price', entry.price);
  add('you_get', entry.you_get);
  (entry.outputs ?? []).forEach((o, i) => add(`outputs[${i}].detail`, o.detail));
  (entry.tiers ?? []).forEach((t, i) => (t.includes ?? []).forEach((s, j) => add(`tiers[${i}].includes[${j}]`, s)));
  add('notes', entry.notes);
  return out;
}

// System RAM, disk and storage figures are not GPU memory.
const NOT_VRAM = /\bRAM\b|system memory|\bdisk\b|storage/i;
const GB = /(?<![\w.])(\d+(?:\.\d+)?)\s?(?:GB|GiB|G|g)(?![A-Za-z0-9])/g;

// Every "N GB" figure with the clause it sits in and the field it came from.
export function vramFigures(entry) {
  const seen = new Set();
  const figures = [];
  for (const [field, text] of textFields(entry)) {
    for (const c of clauses(text)) {
      if (NOT_VRAM.test(c)) continue;
      for (const m of c.matchAll(GB)) {
        const gb = Number(m[1]);
        const key = `${gb}|${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        figures.push({ gb, field, text: clip(c) });
      }
    }
  }
  return figures;
}

const FPS = /(?<![\w.])(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*(?:fps|FPS|frames per second|frames-per-second)\b/g;
const LATENCY = /latency|\bunder \d+(?:\.\d+)? ?(?:ms|milliseconds?|seconds?)\b|(?<![\w.])\d+ ?ms\b|frame every \d+ milliseconds/i;
const RESOLUTION = /(?<![\w.])(\d{3,4}) ?[pP]\b|(?<![\w.])\d{3,4} ?x ?\d{3,4}\b/;
const TIMING_NUM = /(?<![\w.])(?:\d+(?:\.\d+)?|an?) ?(?:s|sec|seconds?|min|minutes?|hours?)\b/i;
const TIMING_CTX = /\bto generate\b|\bper scene\b|\bon (?:a |an )?(?:single |\d+ )?(?:A800|H20|H100|A100|RTX|GPUs?)\b|\bat \d+ ?GB\b|\bTakes\b/i;

// Sentences that state frame rate, latency or generation time, as the registry quotes them.
// Resolution is added as a tag when it sits in the same sentence. A default or a CLI flag is not a report.
export function reportedFigures(entry) {
  const seen = new Set();
  const out = [];
  for (const [field, text] of textFields(entry)) {
    for (const c of clauses(text)) {
      const kinds = [];
      const fps = [];
      if (!/\bdefault\b/i.test(c)) for (const m of c.matchAll(FPS)) fps.push(Number(m[2] ?? m[1]));
      if (fps.length) kinds.push('fps');
      if (LATENCY.test(c)) kinds.push('latency');
      if (TIMING_NUM.test(c) && TIMING_CTX.test(c)) kinds.push('generation-time');
      if (!kinds.length) continue;
      if (RESOLUTION.test(c)) kinds.push('resolution');
      const key = `${field}|${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kinds, fps: fps.length ? Math.max(...fps) : null, field, text: clip(c) });
    }
  }
  return out;
}
