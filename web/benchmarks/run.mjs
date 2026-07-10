import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import "dotenv/config";

import {
  COMMITS,
  ROUTES,
  SERVE_PORT,
  STEPS,
  RESULTS_DIR,
  AUTH,
  BACKEND_URL,
} from "./config.mjs";
import { buildCommit } from "./lib/build.mjs";
import { startServer } from "./lib/serve.mjs";
import { login } from "./lib/login.mjs";
import { measureBundle } from "./lib/measure-bundle.mjs";
import { measureRuntime } from "./lib/measure-runtime.mjs";
import { measureLighthouse } from "./lib/measure-lighthouse.mjs";
import { measureShortcuts } from "./lib/measure-shortcuts.mjs";
import { ingestData } from "./lib/ingest.mjs";
import { generateReport } from "./report.mjs";
import { ensureDir, writeJson, log } from "./lib/util.mjs";

const require = createRequire(import.meta.url);

// ---- CLI flags -------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};

const REUSE = flag("reuse"); // reuse existing dist if present
const INGEST = flag("ingest"); // POST the e2e dataset once before measuring
const ONLY = (opt("only", "") || "").split(",").filter(Boolean); // step subset
const WHICH = opt("commit", "both"); // baseline | current | both

if (opt("baseline")) COMMITS.baseline.ref = opt("baseline");
if (opt("current")) COMMITS.current.ref = opt("current");

const stepOn = (name) => (ONLY.length ? ONLY.includes(name) : STEPS[name]);

// ---- axe-core source (injected into pages) ---------------------------------
function loadAxeSource() {
  try {
    return fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    log("⚠ axe-core not installed — skipping accessibility. `npm i` in web/benchmarks.");
    return null;
  }
}

async function runCommit(key, axeSource) {
  const { ref, label } = COMMITS[key];
  log(`\n=== ${key.toUpperCase()}: ${label} (${ref}) ===`);
  const result = { key, ref, label, ts: new Date().toISOString() };

  const { distDir, webDir, short } = buildCommit(ref, { reuse: REUSE });
  result.short = short;

  if (stepOn("shortcuts")) {
    log("measuring keyboard-shortcut coverage…");
    result.shortcuts = measureShortcuts(webDir);
  }
  if (stepOn("bundle")) {
    log("measuring bundle size…");
    result.bundle = await measureBundle(distDir);
  }

  const runtimeWanted = stepOn("lighthouse") || stepOn("axe") || stepOn("interaction");
  if (runtimeWanted) {
    if (!AUTH.email || !AUTH.password) {
      log("⚠ runtime steps need auth — set ZO_ROOT_USER_EMAIL / ZO_ROOT_USER_PASSWORD in .env. Skipping.");
    } else {
      // Seed fresh data right before measuring THIS commit so the default
      // "last 15 min" views are populated (builds can take a while, so a
      // single up-front seed would go stale before we get here).
      if (INGEST) {
        log("seeding backend with e2e dataset before measurement…");
        await ingestData().catch((e) => log(`⚠ ingestion errored (continuing): ${e.message}`));
      }
      const server = await startServer(distDir, SERVE_PORT);
      try {
        const storagePath = await login(server.url, path.join(RESULTS_DIR, key));
        // Each step is isolated: a failure in one is logged but never aborts
        // the commit, so whatever completed still gets persisted below.
        if (stepOn("interaction") || stepOn("axe")) {
          log("measuring runtime (navigation timings + axe + interaction)…");
          try {
            result.runtime = await measureRuntime({
              origin: server.origin,
              baseUrl: server.url,
              storagePath,
              routes: ROUTES,
              axeSource: stepOn("axe") ? axeSource : null,
            });
          } catch (e) {
            result.runtimeError = e.message;
            log(`⚠ runtime step failed: ${e.message?.split("\n")[0]}`);
          }
        }
        if (stepOn("lighthouse")) {
          log("measuring Lighthouse…");
          try {
            result.lighthouse = await measureLighthouse({
              origin: server.origin,
              storagePath,
              routes: ROUTES,
            });
          } catch (e) {
            result.lighthouseError = e.message;
            log(`⚠ lighthouse step failed: ${e.message?.split("\n")[0]}`);
          }
        }
      } catch (e) {
        // e.g. login failed — record it but still persist bundle/shortcuts.
        result.runtimeError = e.message;
        log(`⚠ runtime measurement aborted: ${e.message?.split("\n")[0]}`);
      } finally {
        await server.close().catch(() => {});
      }
    }
  }

  writeJson(path.join(RESULTS_DIR, `${key}.json`), result);
  return result;
}

async function main() {
  ensureDir(RESULTS_DIR);
  log(`backend (proxy target): ${BACKEND_URL}`);
  const axeSource = stepOn("axe") ? loadAxeSource() : null;

  const results = {};
  const keys = WHICH === "both" ? ["baseline", "current"] : [WHICH];
  for (const key of keys) {
    try {
      results[key] = await runCommit(key, axeSource);
    } catch (e) {
      log(`✗ ${key} failed: ${e.message}`);
      results[key] = { key, error: e.message, ref: COMMITS[key]?.ref };
    }
  }

  // Backfill any commit we didn't run this time from its last saved per-commit
  // JSON, so a partial run (e.g. --commit=baseline) still yields a full report.
  for (const key of ["baseline", "current"]) {
    if (!results[key] || results[key].error) {
      const saved = path.join(RESULTS_DIR, `${key}.json`);
      if (fs.existsSync(saved)) {
        try {
          const prior = JSON.parse(fs.readFileSync(saved, "utf8"));
          if (!prior.error) {
            results[key] = prior;
            log(`backfilled ${key} from ${saved}`);
          }
        } catch {}
      }
    }
  }

  writeJson(path.join(RESULTS_DIR, "results.json"), results);
  const reportPath = path.join(RESULTS_DIR, "report.html");
  generateReport(results, reportPath);
  log(`\n✔ done. Report: ${reportPath}`);
  log(`  Raw JSON:   ${path.join(RESULTS_DIR, "results.json")}`);
}

main().catch((e) => {
  log("fatal:", e.stack || e.message);
  process.exit(1);
});
