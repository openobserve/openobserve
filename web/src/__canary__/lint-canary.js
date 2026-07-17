// CI CANARY — do not "fix" this.
//
// A guaranteed ESLint error (no-unreachable, which is enforced as "error").
// `npm run lint:canary` asserts it IS reported; if it stops failing, ESLint has
// gone dark (no-op glob / rule disabled). Excluded from lint:ci's scope so the
// real lint gate stays green, and never imported so it is never bundled.
export function _lintCanary() {
  return 1;
  return 2;
}
