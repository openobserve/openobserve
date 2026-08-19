#!/usr/bin/env node
/**
 * build-ci-matrix.js — single source of truth for the Playwright UI shard matrix.
 *
 * Prints a GitHub Actions matrix object: {"include":[ {testfolder,actual_folder,browser,run_files}, ... ]}
 * consumed by `strategy.matrix: ${{ fromJSON(needs.generate_matrix.outputs.matrix) }}`.
 *
 * Usage:
 *   node build-ci-matrix.js <base.json>                 # OSS: base manifest verbatim
 *   node build-ci-matrix.js <base.json> <overlay.json>  # ENT: base + enterprise overlay
 *
 * The base (OSS tests/ui-testing/ci-matrix/ci_matrix.json) is the ONLY place shared shards are
 * listed. ENT never re-lists shared specs — its overlay (ci_matrix.ent.json) carries
 * only the delta, so a spec added to OSS flows into ENT automatically:
 *   { "append": { "<testfolder>": ["extra.spec.js", ...] },   // add ENT-only specs to a shared shard
 *     "shards": [ {testfolder,actual_folder,browser,run_files} ], // whole ENT-only shards (Workflows, SDR…)
 *     "disabled": { "<testfolder>": [{file,reason}, ...] } }   // ENT-only specs turned off (doc only)
 *
 * DISABLING A SPEC (JSON has no // comments): don't delete it — move it into a
 * shard's "disabled": [{ "file": "x.spec.js", "reason": "why" }] array. Disabled
 * entries are documentation only: this script never emits them, so they don't run,
 * but the record + reason survive. "_comment" (or any _-prefixed key) is also ignored.
 *
 * This lives in OSS so ENT can reuse it from its tree-merged OSS checkout.
 */
const fs = require("fs");

function die(msg) {
  process.stderr.write(`build-ci-matrix: ${msg}\n`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    die(`cannot read/parse ${path}: ${e.message}`);
  }
}

const [basePath, overlayPath] = process.argv.slice(2);
if (!basePath) die("usage: build-ci-matrix.js <base.json> [overlay.json]");

const base = readJson(basePath);
if (!Array.isArray(base)) die(`base ${basePath} must be a JSON array of shards`);

// Deep-copy base so we never mutate the parsed source objects.
const include = base.map((s) => ({ ...s, run_files: [...(s.run_files || [])] }));
const byFolder = new Map(include.map((s) => [s.testfolder, s]));

if (overlayPath) {
  const overlay = readJson(overlayPath);

  // append: add enterprise-only specs to an EXISTING shared shard.
  for (const [folder, specs] of Object.entries(overlay.append || {})) {
    const shard = byFolder.get(folder);
    if (!shard) {
      die(`overlay append targets unknown folder "${folder}" — it must exist in the base manifest`);
    }
    for (const spec of specs) {
      if (shard.run_files.includes(spec)) {
        die(`overlay append: "${spec}" already in base shard "${folder}" — remove it from the overlay`);
      }
      shard.run_files.push(spec);
    }
  }

  // shards: whole enterprise-only shards (Workflows, SDR-Logs, SDR-Traces, …).
  for (const shard of overlay.shards || []) {
    if (byFolder.has(shard.testfolder)) {
      die(`overlay shard "${shard.testfolder}" collides with a base shard — use "append" instead`);
    }
    const copy = { browser: "chrome", ...shard, run_files: [...(shard.run_files || [])] };
    include.push(copy);
    byFolder.set(copy.testfolder, copy);
  }

  // disabled: enterprise-only turned-off specs, recorded against a shard for docs only.
  for (const [folder, entries] of Object.entries(overlay.disabled || {})) {
    const shard = byFolder.get(folder);
    if (!shard) die(`overlay disabled targets unknown folder "${folder}"`);
    shard.disabled = [...(shard.disabled || []), ...entries];
  }
}

// Sanity: unique testfolders, no empty shards, no dup specs, and no spec both
// active (run_files) and disabled in the same shard.
const seen = new Set();
for (const s of include) {
  if (!s.testfolder) die(`shard missing testfolder: ${JSON.stringify(s)}`);
  if (seen.has(s.testfolder)) die(`duplicate testfolder "${s.testfolder}"`);
  seen.add(s.testfolder);
  if (!s.actual_folder) s.actual_folder = s.testfolder;
  if (!s.run_files || s.run_files.length === 0) die(`shard "${s.testfolder}" has no run_files`);
  if (new Set(s.run_files).size !== s.run_files.length) {
    die(`shard "${s.testfolder}" has duplicate run_files`);
  }
  for (const d of s.disabled || []) {
    if (s.run_files.includes(d.file)) {
      die(`shard "${s.testfolder}": "${d.file}" is in both run_files and disabled`);
    }
  }
}

// Emit ONLY the fields the CI matrix consumes — disabled/_comment/notes are stripped,
// so turned-off specs never reach `npx playwright test`.
//
// quick_mode_enabled is always emitted (defaulting to "false") so every shard
// carries the key: the workflow feeds it to ZO_QUICK_MODE_ENABLED when starting
// that shard's OpenObserve process. The flag is read once at server start, so it
// cannot vary per test — a shard is the smallest unit that can change it.
//
// ingest_allowed_upto follows the same rule and for the same reason. It is how
// far back (HOURS) ingestion accepts a record; the workflow default is 5, which
// silently DROPS older rows while still returning a success-shaped response. A
// suite that seeds history — SLOs measure a rolling 7-day window — needs a wider
// one, and scoping it to those shards keeps every other shard on the default.
//
// slo_backfill_chunk_secs follows the same rule for the same class of reason:
// it's how much history one SLO backfill chunk covers, read once at server
// start. The workflow default (86400 = 1 day) makes a 7-day-window test SLO
// backfill in 7 sequential chunks under ZO_SCHEDULER_SLO_BACKFILL_CONCURRENCY=1;
// SLO-Measurement widens it to the full window so its 3 backfilled SLOs don't
// pay 21 chunks serially.
const matrix = include.map((s) => ({
  testfolder: s.testfolder,
  actual_folder: s.actual_folder,
  browser: s.browser || "chrome",
  run_files: s.run_files,
  quick_mode_enabled:
    s.quick_mode_enabled === true || s.quick_mode_enabled === "true" ? "true" : "false",
  ingest_allowed_upto:
    s.ingest_allowed_upto === undefined || s.ingest_allowed_upto === null
      ? ""
      : String(s.ingest_allowed_upto),
  slo_backfill_chunk_secs:
    s.slo_backfill_chunk_secs === undefined || s.slo_backfill_chunk_secs === null
      ? ""
      : String(s.slo_backfill_chunk_secs),
  // Per-shard worker count. Empty = use playwright.config.js (5 in CI).
  //
  // `fullyParallel` runs separate spec FILES concurrently, and
  // `test.describe.configure({mode:'serial'})` only orders tests inside one file.
  // A shard whose specs contend for a shared server-side resource therefore has
  // to pin workers to 1 — otherwise the files race each other, which is not
  // something the specs themselves can express.
  workers: s.workers === undefined || s.workers === null ? "" : String(s.workers),
}));

process.stdout.write(JSON.stringify({ include: matrix }));
