// CI CANARY — do not "fix" this error.
//
// This deliberate type error proves the type-check toolchain actually reads
// src/ and reports errors. `npm run type-check:canary` asserts it IS reported;
// if it ever stops failing, the type-check has gone dark and CI says so.
//
// It is excluded from tsconfig.app.json (see its `exclude`) so the real
// `type-check:app` gate stays green, and it is never imported so it is never
// bundled into the app.
export const _canaryTypeError: number = "the type-check is dark if this compiles";
