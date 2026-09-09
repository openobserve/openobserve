#!/usr/bin/env node
/**
 * pw-triage-comment.js — render the sticky PR comment for Playwright shard triage.
 *
 * Reads the generated matrix from $MATRIX and the selection log (argv[1], the
 * generate_matrix job's /tmp/pw-select-log.txt) and prints a compact markdown body:
 * mode, shards with per-shard spec counts, total specs, and the selection reasoning
 * (only when the log has content — full-matrix runs have no log). Env $MARKER,
 * $SMOKE_ACTIVE, $HEAD_SHA, $ATTEMPT tune the header/footer. stdout is the comment body.
 */
const fs = require("fs");

function readLog(path) {
  if (!path) return "";
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

const marker = process.env.MARKER || "<!-- playwright-shard-triage -->";
const smokeActive = process.env.SMOKE_ACTIVE === "true";
const headSha = (process.env.HEAD_SHA || "").slice(0, 9);
const attempt = process.env.ATTEMPT || "1";
const log = readLog(process.argv[2]);

let matrix;
try {
  matrix = JSON.parse(process.env.MATRIX || "{}");
} catch {
  matrix = {};
}
const shards = Array.isArray(matrix.include) ? matrix.include : [];

// smoke_active only says selection ran; a global_paths hit still returns the full
// matrix, so infer the real mode from the log rather than the flag alone.
const fellBackToFull = /falling back to full matrix|full matrix:/.test(log);
const mode = smokeActive && !fellBackToFull ? "smoke (changed-path)" : "full matrix";

const specsOf = (s) => (Array.isArray(s.run_files) ? s.run_files.length : 0);
const totalSpecs = shards.reduce((n, s) => n + specsOf(s), 0);
const shardList = shards
  .map((s) => `${s.testfolder} (${specsOf(s)})`)
  .join(" · ");

const lines = [
  marker,
  "### 🎯 Playwright shard selection",
  `Mode: **${mode}** · **${shards.length} shard${shards.length === 1 ? "" : "s"}** · **${totalSpecs} spec${totalSpecs === 1 ? "" : "s"}**`,
  "",
  shardList || "_no shards selected_",
];

if (log) {
  lines.push(
    "",
    "<details><summary>Why these shards</summary>",
    "",
    "```",
    log,
    "```",
    "",
    "</details>"
  );
}

lines.push(
  "",
  `<sub>Updated for \`${headSha}\` · attempt ${attempt} · updates in place on every push.</sub>`
);

process.stdout.write(lines.join("\n") + "\n");
