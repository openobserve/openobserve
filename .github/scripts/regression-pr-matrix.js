#!/usr/bin/env node
// Usage: regression-pr-matrix.js <matrix.json> <changed-files.txt> <oss-manifest.json> [ent-overlay.json ...]; prints the matrix cut down to the changed RegressionSet specs.
const fs = require("fs");

const ROOT = "tests/ui-testing/playwright-tests/";
const matrix = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const left = new Set(
  fs.readFileSync(process.argv[3], "utf8").split("\n")
    .filter((f) => f.startsWith(ROOT + "RegressionSet/") && f.endsWith(".spec.js"))
    .map((f) => f.slice(ROOT.length)),
);
const out = new Map();
const add = (shard, file) => {
  if (!out.has(shard.testfolder)) out.set(shard.testfolder, { ...shard, run_files: [] });
  out.get(shard.testfolder).run_files.push(file);
  left.delete(`${shard.actual_folder}/${file}`);
};
for (const shard of matrix.include) {
  for (const f of shard.run_files || []) if (left.has(`${shard.actual_folder}/${f}`)) add(shard, f);
}

// The built matrix drops disabled entries and disabled-only shards, so they are read from the source manifest.
const manifest = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const shards = Array.isArray(manifest) ? manifest : manifest.include || [];
const folderOf = new Map(shards.map((s) => [s.testfolder, s.actual_folder]));
const ossDisabled = new Set(shards.flatMap((s) => (s.disabled || []).map((e) => `${s.actual_folder}/${e.file}`)));
const entOnly = new Set();
for (const p of process.argv.slice(5)) {
  const o = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [tf, files] of Object.entries(o.append || {})) for (const f of files) entOnly.add(`${folderOf.get(tf)}/${f}`);
  for (const s of o.shards || []) for (const f of s.run_files || []) entOnly.add(`${s.actual_folder}/${f}`);
  for (const [tf, entries] of Object.entries(o.disabled || {})) for (const e of entries) entOnly.add(`${folderOf.get(tf)}/${e.file}`);
}
// ENT-only specs fail on the OSS binary, so they are left to ENT CI; a spec in neither manifest would never run anywhere.
let orphans = 0;
for (const f of left) {
  if (ossDisabled.has(f)) {
    console.error(`::notice::${f} is on its shard's disabled list in ci_matrix_regression.json, so it does not run`);
  } else if (entOnly.has(f)) {
    console.error(`::notice::${f} is registered only in ENT's regression overlay, so ENT CI runs it, not this OSS run`);
  } else {
    console.error(`::error::${f} is in no regression manifest; add it to tests/ui-testing/ci-matrix/ci_matrix_regression.json, or to ENT's ci_matrix_regression.ent.json if it is ENT-only`);
    orphans++;
  }
}
if (orphans) process.exit(1);
process.stdout.write(JSON.stringify({ include: [...out.values()] }));
