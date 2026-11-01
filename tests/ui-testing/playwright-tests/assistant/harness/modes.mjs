// Copyright 2026 OpenObserve Inc.
// Which server the assistant flows run against (`ASSISTANT_E2E_MODE`) and the tags that declare where each flow runs.

/** `mock` fakes every AI endpoint on any server; every stack mode runs the same specs against a real one. */
export const MODES = ["mock", "stack-ee", "stack-ee-noagent", "stack-oss", "stack-cloud"];

/** The catalogue's mode letters as Playwright tags; `@responsive` flows also run at 768 and 375. */
export const TAGS = {
  M: "@mock",
  E: "@stack-ee",
  N: "@stack-ee-noagent",
  O: "@stack-oss",
  C: "@stack-cloud",
  R: "@responsive",
};

const MODE_TAGS = new Set(MODES.map((m) => `@${m}`));

/** The mode of this run; an unknown value fails fast instead of silently running with mocks. */
export function currentMode(env = process.env) {
  const mode = env.ASSISTANT_E2E_MODE || "mock";
  if (!MODES.includes(mode)) throw new Error(`ASSISTANT_E2E_MODE must be one of ${MODES.join(", ")}; got "${mode}"`);
  return mode;
}

export const MODE = currentMode();

export const isStack = (mode = MODE) => mode !== "mock";

export const modeTag = (mode = MODE) => `@${mode}`;

/** The `--grep` source that selects one mode's flows; the lookahead keeps `@stack-ee` from matching `@stack-ee-noagent`. */
export const grepFor = (mode = MODE) => `${modeTag(mode)}(?![\\w-])`;

/** Whether a flow with these tags runs in `mode`; flows without any mode tag predate tagging and run in mock mode only. */
export function runsIn(tags, mode = MODE) {
  const declared = tags.filter((t) => MODE_TAGS.has(t));
  if (declared.length === 0) return mode === "mock";
  return declared.includes(modeTag(mode));
}

/** Skips the running flow unless its tags declare the current mode, so a run without `--grep` still honours the tags. */
export async function enforceMode() {
  const { test } = await import("@playwright/test");
  let tags;
  try {
    tags = test.info().tags;
  } catch {
    // Scripts outside the Playwright runner (the design folder's captures) import the harness too.
    return;
  }
  test.skip(!runsIn(tags), `not declared for ${MODE}`);
}

/** Skips the running flow in a stack mode because it needs a mock the real server cannot provide. */
export async function mockOnly(what) {
  if (!isStack()) return;
  const { test } = await import("@playwright/test");
  test.skip(true, `${what} is mock-only; ${MODE} asserts structure against the real server`);
}
