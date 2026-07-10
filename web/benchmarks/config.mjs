// Benchmark configuration — tune commits, routes, and run counts here.
//
// The harness compares two git states of the OpenObserve web frontend:
//   BASELINE  — Quasar-era, right before the first tabs-migration PR (#11595)
//   CURRENT   — reka-ui + custom O2 components (your working branch / main)
//
// It builds each commit in an isolated git worktree, serves the built `dist/`
// through a static server that proxies backend calls to a live OpenObserve,
// then measures bundle size, Lighthouse, accessibility (axe), interaction
// latency and keyboard-shortcut coverage. See README.md.

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root = two levels up from web/benchmarks/
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const WEB_DIR = path.resolve(__dirname, "..");

export const COMMITS = {
  // Right before `feat: ux improvement tabs and buttons (#11595)` merged.
  baseline: {
    ref: "75bda129983b4186bb50d37447d968989b195eb8",
    label: "Quasar (pre-tabs-migration, 2026-05-06)",
  },
  // Your current code. Override on the CLI: `node run.mjs --current=<ref>`
  current: {
    ref: "main",
    label: "reka-ui + O2 components",
  },
};

// Port the harness serves each build on. The frontend is BUILT with
// VITE_OPENOBSERVE_ENDPOINT=http://localhost:<PORT> so that all API calls are
// same-origin and get proxied to BACKEND_URL below.
export const SERVE_PORT = 8199;
export const BASE_PATH = "/web/"; // vite `--base /web/`

// Routes to benchmark. `path` is appended after BASE_PATH. Keep the
// org_identifier query so the app lands in the right org with seeded data.
// Edit these to match your environment / where your test data lives.
export const ORG = process.env.ORGNAME || "default";
const org = `?org_identifier=${ORG}`;

export const ROUTES = [
  { id: "home", label: "Login + Home", path: `${org}`, needsAuth: true, group: "load" },
  { id: "logs", label: "Logs / Search", path: `logs${org}`, needsAuth: true, group: "core" },
  { id: "dashboards", label: "Dashboards", path: `dashboards${org}`, needsAuth: true, group: "core" },
  { id: "streams", label: "Streams (OTable)", path: `streams${org}`, needsAuth: true, group: "migrated" },
  { id: "pipeline", label: "Pipelines (tabs/dialogs)", path: `pipeline${org}`, needsAuth: true, group: "migrated" },
];

// How many Lighthouse runs per route (median is reported). 5 is a good
// noise/time trade-off; drop to 3 for faster iteration.
export const LIGHTHOUSE_RUNS = Number(process.env.LH_RUNS || 5);

// Lighthouse throttling — keep IDENTICAL across both commits for fairness.
// NOTE: with "simulated" (lantern), Lighthouse needs a COMPLETE throttling
// object or metric computation fails (null FCP/LCP/TBT). This is a full desktop
// profile. Set method to "provided" to disable throttling entirely.
// "provided" = NO Lighthouse throttling. Chosen deliberately: this app proxies
// every API call to a REMOTE staging backend, so simulated/lantern throttling
// stacks on real network latency and produces meaningless ~50s FCP. Unthrottled
// still includes proxy latency, so treat Lighthouse lab perf as SECONDARY — the
// Playwright runtime timings are the primary performance signal here.
export const LIGHTHOUSE_THROTTLING = {
  method: "provided",
  cpuSlowdownMultiplier: 1,
};

// Which measurement steps to run. Toggle via CLI flags in run.mjs too.
export const STEPS = {
  bundle: true, // no backend needed
  lighthouse: true, // needs backend + auth
  axe: true, // needs backend + auth
  interaction: true, // needs backend + auth
  shortcuts: true, // static source analysis, no backend
};

export const RESULTS_DIR = path.resolve(__dirname, "results");
export const WORKTREE_DIR = path.resolve(__dirname, ".worktrees");

// Backend the built frontend proxies to. This is your running OpenObserve —
// same instance the Playwright suite uses. Read from env (.env).
export const BACKEND_URL = (
  process.env.ZO_BACKEND_URL ||
  process.env.ZO_BASE_URL ||
  "http://localhost:5080"
).replace(/\/+$/, "");

export const AUTH = {
  email: process.env.ZO_ROOT_USER_EMAIL || "",
  password: process.env.ZO_ROOT_USER_PASSWORD || "",
};
