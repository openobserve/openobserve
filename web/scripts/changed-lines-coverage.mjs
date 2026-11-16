#!/usr/bin/env node
// Fails when too few changed, executable web/src lines run under the unit tests (UI_CHANGED_LINES_MIN, default 70%).
// Usage (from web/): node scripts/changed-lines-coverage.mjs (--diff <file> | --base <ref> [--head <ref>])
//                    [--coverage coverage/coverage-final.json] [--report-only] [--summary file]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { globToRe } from "./select-ui-tests.mjs";

// web/src path -> Set of added line numbers, from a `git diff -U0`.
export function parseDiff(text) {
  const files = new Map();
  let cur = null;
  let line = 0;
  for (const l of text.split("\n")) {
    if (l.startsWith("+++ ")) {
      const m = /^\+\+\+ b\/web\/(src\/.*)$/.exec(l);
      cur = m ? new Set() : null;
      if (m) files.set(m[1], cur);
    } else if (l.startsWith("@@")) line = Number(/\+(\d+)/.exec(l)[1]);
    else if (cur && l.startsWith("+")) cur.add(line++);
  }
  return files;
}

// line -> covered, for lines where a statement starts.
export function lineCoverage(fileCov) {
  const lines = new Map();
  for (const [id, loc] of Object.entries(fileCov.statementMap)) {
    const l = loc.start.line;
    lines.set(l, lines.get(l) || fileCov.s[id] > 0);
  }
  return lines;
}

// Without coverage data every non-blank, non-comment changed line counts as executable and uncovered.
export function fileStats(changed, lines, source) {
  const src = (source ?? "").split("\n");
  let exec = 0;
  let covered = 0;
  const uncovered = [];
  for (const n of [...changed].sort((a, b) => a - b)) {
    if (lines) {
      if (!lines.has(n)) continue;
      exec++;
      if (lines.get(n)) covered++;
      else uncovered.push(n);
    } else {
      const t = (src[n - 1] ?? "").trim();
      if (!t || /^(\/\/|\/\*|\*)/.test(t)) continue;
      exec++;
      uncovered.push(n);
    }
  }
  return { exec, covered, uncovered };
}

// include/exclude globs of test.coverage in vitest.config.ts, so excluded files are not counted.
function coverageScope(configText) {
  const block = configText.slice(configText.indexOf("coverage:")).replace(/\/\/.*$/gm, "");
  const list = (name) =>
    [
      ...(new RegExp(`${name}:\\s*\\[([^\\]]*)\\]`).exec(block)?.[1] ?? "").matchAll(
        /["']([^"']+)["']/g,
      ),
    ].map((m) => globToRe(m[1]));
  const inc = list("include");
  const exc = list("exclude");
  if (!inc.length) inc.push(globToRe("src/**/*.{js,ts,vue}"));
  return (f) => inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f));
}

export function gate({ diff, coverage, inScope, readSource, min }) {
  const byFile = new Map();
  for (const [k, v] of Object.entries(coverage))
    byFile.set(/(?:^|\/)web\/(src\/.*)$/.exec(k)?.[1] ?? k, v);
  const rows = [];
  for (const [f, changed] of parseDiff(diff)) {
    if (/\.spec\.(ts|js|vue)$/.test(f) || !inScope(f)) continue;
    const cov = byFile.get(f);
    const s = fileStats(changed, cov ? lineCoverage(cov) : null, cov ? null : readSource(f));
    if (s.exec) rows.push({ file: f, noData: !cov, ...s });
  }
  const exec = rows.reduce((a, r) => a + r.exec, 0);
  const covered = rows.reduce((a, r) => a + r.covered, 0);
  const pct = exec ? (100 * covered) / exec : 100;
  return { rows, exec, covered, pct, pass: exec === 0 || pct >= min };
}

function report(r, min) {
  const out = [
    `### Changed-lines coverage: ${r.pct.toFixed(1)}% (${r.covered}/${r.exec}), minimum ${min}% ${r.pass ? "passed" : "FAILED"}`,
    "",
  ];
  if (!r.exec) return out.concat("No executable changed lines.").join("\n") + "\n";
  out.push("| File | Changed lines | Covered | % | Uncovered lines |", "|---|---|---|---|---|");
  for (const x of r.rows.sort((a, b) => b.exec - b.covered - (a.exec - a.covered))) {
    const un = x.uncovered.slice(0, 10).join(", ") + (x.uncovered.length > 10 ? ", ..." : "");
    const note = x.noData ? " (no coverage data: every code line counted)" : "";
    out.push(
      `| \`${x.file}\`${note} | ${x.exec} | ${x.covered} | ${((100 * x.covered) / x.exec).toFixed(0)}% | ${un} |`,
    );
  }
  return out.join("\n") + "\n";
}

function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const min = Number(process.env.UI_CHANGED_LINES_MIN || 70);
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    console.error(
      `UI_CHANGED_LINES_MIN must be a number from 0 to 100, got "${process.env.UI_CHANGED_LINES_MIN}"`,
    );
    process.exit(2);
  }
  const covPath = opt("--coverage", "coverage/coverage-final.json");
  const diff = opt("--diff")
    ? fs.readFileSync(opt("--diff"), "utf8")
    : execFileSync(
        "git",
        [
          "diff",
          "-U0",
          "--no-renames",
          execFileSync("git", ["merge-base", opt("--base", "origin/main"), opt("--head", "HEAD")])
            .toString()
            .trim(),
          opt("--head", "HEAD"),
          "--",
          "src",
        ],
        { maxBuffer: 1 << 30 },
      ).toString();
  const coverage = fs.existsSync(covPath) ? JSON.parse(fs.readFileSync(covPath, "utf8")) : {};
  const r = gate({
    diff,
    coverage,
    inScope: coverageScope(fs.readFileSync("vitest.config.ts", "utf8")),
    readSource: (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""),
    min,
  });
  const md = report(r, min);
  const summaryFile = opt("--summary", process.env.GITHUB_STEP_SUMMARY);
  if (summaryFile) fs.appendFileSync(summaryFile, md);
  process.stdout.write(md);
  if (!r.pass && !argv.includes("--report-only")) process.exit(1);
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)
)
  main(process.argv.slice(2));
