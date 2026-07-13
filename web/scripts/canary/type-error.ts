// Copyright 2026 OpenObserve Inc.

// CANARY — this file MUST always contain a genuine type error.
// `npm run type-check:canary` compiles it in isolation and asserts the checker
// reports TS2322. If this ever type-checks clean, the checker has gone dark
// (matching nothing, OOM-exiting-0, or misconfigured) and CI must fail.
// Do NOT "fix" the error below.
export const CANARY: number = "type-check canary — this string must be reported as TS2322";
