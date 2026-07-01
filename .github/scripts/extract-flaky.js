#!/usr/bin/env node
/**
 * Extract flaky + failed tests from a Playwright JSON report for OpenObserve.
 *
 * Usage:  node extract-flaky.js <path-to-report.json>
 * Output: a JSON array on stdout, one object per flaky-or-failed test:
 *           [{ module, title, file, status }]   status = "flaky" | "failed"
 *
 *   "flaky"  = Playwright status "flaky"      (failed, then passed on retry)
 *   "failed" = Playwright status "unexpected" (failed even after retries)
 *
 * BOTH are captured on purpose. The consumer stream is `ci_test_results` (NOT
 * `ci_test_flaky`) and every row carries a `status` field so dashboards can tell
 * flaky from failed — a shard that failed then passed on rerun is flaky, not
 * failed, and the per-test verdict here is what keeps that distinction honest.
 *
 * `title` comes from the SPEC (sp.title): in Playwright's JSON schema the spec is
 * the test() call and holds the title; the per-project `test` objects nested under
 * it have NO title field, so t.title would be undefined. Do not change to t.title.
 *
 * Never throws: a missing/malformed report is logged to stderr and prints `[]`
 * with exit 0, so the calling workflow step stays non-fatal.
 */
const fs = require("fs");

const reportPath = process.argv[2];
if (!reportPath || !fs.existsSync(reportPath)) {
  console.error(`extract-flaky: report not found at ${reportPath || "<no path>"}`);
  process.stdout.write("[]");
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (e) {
  console.error("extract-flaky: report.json parse failed:", e && e.message);
  process.stdout.write("[]");
  process.exit(0);
}

const out = [];
(function walk(suite) {
  (suite.specs || []).forEach((sp) =>
    (sp.tests || []).forEach((t) => {
      if (t.status === "flaky" || t.status === "unexpected") {
        const file = sp.file || suite.file || "";
        out.push({
          module: file.split("/")[0] || "unknown", // top-level test folder
          title: sp.title,
          file,
          status: t.status === "flaky" ? "flaky" : "failed",
        });
      }
    })
  );
  (suite.suites || []).forEach(walk);
})({ suites: report.suites || [] });

process.stdout.write(JSON.stringify(out));
