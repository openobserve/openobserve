// Entry point for the sourcemap E2E fixture bundle.
// The bundle is never executed by tests — errors are ingested synthetically
// with stacks pointing at positions inside the minified output (see
// manifest.json). Bundling real call sites keeps the sourcemap realistic.

import {
  readProfileName,
  useUndeclaredVariable,
  createInvalidArray,
  chargeAccount,
} from './errors/sync-errors.js';

const triggers = {
  typeError: () => readProfileName(undefined),
  referenceError: () => useUndeclaredVariable(),
  rangeError: () => createInvalidArray(),
  customError: () => chargeAccount(),
};

// Expose for manual debugging of the fixture in a browser.
if (typeof window !== 'undefined') {
  window.__o2SourcemapFixture = triggers;
}

export default triggers;
