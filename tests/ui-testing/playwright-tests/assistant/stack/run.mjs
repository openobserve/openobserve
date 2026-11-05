// Copyright 2026 OpenObserve Inc.
// Runs the assistant flows declared for ASSISTANT_E2E_MODE, narrowed by ASSISTANT_E2E_GREP; extra arguments go to `playwright test`.
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { MODE, grepFor, isStack } from "../harness/modes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const uiTesting = join(here, "..", "..", "..");
const folder = relative(uiTesting, join(here, ".."));
const narrow = process.env.ASSISTANT_E2E_GREP;
// Playwright keeps one --grep, so the title filter joins the mode tag as a second lookahead.
const source = narrow ? `^(?=.*${grepFor(MODE)})(?=.*(?:${narrow}))` : grepFor(MODE);
// The /…/ form keeps the match case-sensitive; Playwright's default "gi" lets "STACK-" match every @stack- tag.
const grep = `/${source}/`;
// A stack flow that passes only on retry is a flake, not green, so stack runs never retry.
const retries = isStack() ? ["--retries=0"] : [];
const args = ["playwright", "test", folder, "--grep", grep, "--workers=1", ...retries, ...process.argv.slice(2)];

console.log(`assistant e2e: ${MODE} → npx ${args.join(" ")}`);
const run = spawnSync("npx", args, { cwd: uiTesting, stdio: "inherit", env: { ...process.env, ASSISTANT_E2E_MODE: MODE } });
process.exit(run.status ?? 1);
