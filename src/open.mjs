// Load the registry and attach the link-check record that ships beside it.
import { loadRegistry } from './registry.mjs';
import { loadLiveness } from './verify.mjs';

export function openRegistry(opts = {}) {
  const reg = loadRegistry(opts);
  reg.liveness = opts.liveness === undefined ? loadLiveness() : opts.liveness;
  return reg;
}
