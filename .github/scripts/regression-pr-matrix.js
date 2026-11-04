#!/usr/bin/env node
// Usage: regression-pr-matrix.js <matrix.json> <changed-files.txt>; prints the matrix cut down to the changed RegressionSet specs.
const fs = require("fs");
const path = require("path");

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
// A spec missing from the manifest still runs here, on the first shard serving its folder, so the PR proves it.
for (const f of [...left]) {
  const shard = matrix.include.find((s) => s.actual_folder === path.dirname(f));
  if (shard) {
    console.error(`::warning::${f} is in no ci_matrix_regression.json shard, so the scheduled suite will never run it`);
    add(shard, path.basename(f));
  } else {
    console.error(`::warning::${f} is in a folder no regression shard serves; not run`);
  }
}
process.stdout.write(JSON.stringify({ include: [...out.values()] }));
