import test from "node:test";
import assert from "node:assert/strict";
import { buildImpactContext, changedSymbols } from "../src/impact.mjs";

const diff = [
  "diff --git a/src/a.rs b/src/a.rs",
  "@@ -10,3 +10,4 @@ pub fn route_request(op: &str) -> bool {",
  "-    op == \"Search\"",
  "+    op == \"Search\" || op == \"SearchAround\"",
  "+fn cap_rows(rows: usize) -> usize { rows.min(100) }",
  "diff --git a/web/src/x.spec.ts b/web/src/x.spec.ts",
  "+const createMock = () => ({})",
].join("\n");

test("changedSymbols takes hunk-header and edited definitions, skipping test files", () => {
  const s = changedSymbols(diff);
  assert.deepEqual([...s.keys()].sort(), ["cap_rows", "route_request"]);
  assert.deepEqual([...s.get("route_request")], ["src/a.rs"]);
});

test("buildImpactContext lists outside uses and same-language parallel definitions", () => {
  const grep = {
    route_request: "src/a.rs:10:pub fn route_request(op: &str) -> bool {\nsrc/b.rs:5:    if route_request(op) {\nsrc/tests/t.rs:3:route_request(\"x\");\nsrc/c.rs:7:// route_request is old\n",
    cap_rows: "src/a.rs:13:fn cap_rows(rows: usize) -> usize { rows.min(100) }\nsrc/session.rs:40:fn cap_rows(rows: usize) -> usize { rows }\n",
  };
  const run = (_cmd, args) => {
    const out = grep[args[args.indexOf("-e") + 1]];
    if (!out) throw new Error("exit 1");
    return out;
  };
  const out = buildImpactContext(diff, "/pr", { run });
  assert.match(out, /cap_rows \(changed in src\/a\.rs\): 0 use\(s\) outside the diff, 1 other definition/);
  assert.match(out, /DEF src\/session\.rs:40/);
  assert.match(out, /route_request .*1 use\(s\) outside the diff, 1 in tests/);
  assert.match(out, /src\/b\.rs:5/);
  assert.doesNotMatch(out, /src\/c\.rs/); // comment hit
  assert.doesNotMatch(out, /src\/a\.rs:10:/); // inside the diff
});

test("buildImpactContext is empty without a PR tree", () => {
  assert.equal(buildImpactContext(diff, ""), "");
});
