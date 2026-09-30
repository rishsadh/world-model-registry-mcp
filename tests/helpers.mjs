import { openRegistry } from '../src/open.mjs';

// The bundled registry, with the clock fixed so age checks do not depend on the day the tests run.
export function reg(extra = {}) {
  return openRegistry({ now: new Date('2026-09-30T12:00:00Z'), liveness: null, ...extra });
}
