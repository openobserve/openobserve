// Run: node --test scripts/select-ui-tests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { select } from "./select-ui-tests.mjs";
import { gate, parseDiff } from "./changed-lines-coverage.mjs";

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "select-ui-tests-"));
const git = (...a) =>
  execFileSync("git", ["-C", repo, ...a])
    .toString()
    .trim();
const write = (files) => {
  for (const [f, t] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), t);
  }
};
const commit = () => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c");
  return git("rev-parse", "HEAD");
};

const alias = `alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }`;
const EN = {
  x: { hello: "Hello world", bye: "Goodbye" },
  y: { attr: "Edit item", dollar: "Delete item", glob: "Save item", tpl: "Close item" },
};
const FS_SPEC = "src/locales/keys.spec.ts";
// Specs other than the fs-reading one, which every web/src change picks.
const graphSpecs = (r) => r.specs.filter((s) => s !== FS_SPEC);
git("init", "-q");
write({
  "README.md": "x",
  "web/vite.config.ts": alias,
  "web/vitest.config.ts": `${alias}\nsetupFiles: ['src/test/setup.ts'],`,
  "web/package.json": "{}",
  "web/src/test/setup.ts": `import { q } from "@/utils/q";`,
  "web/src/utils/q.ts": "export const q = 1;",
  "web/src/test/helper.ts": "export const h = 1;",
  "web/src/utils/a.ts": "export const a = 1;",
  "web/src/comp/B.vue": `<script setup>import { a } from "@/utils/a";</script>`,
  "web/src/comp/B.spec.ts": `import B from "./B.vue";`,
  "web/src/utils/c.ts": "export const c = 1;",
  "web/src/utils/c.spec.ts": `import { c } from "./c";\nimport { h } from "../test/helper";`,
  "web/src/locales/languages/en-US.json": JSON.stringify(EN),
  "web/src/locales/languages/de-DE.json": JSON.stringify({ x: { hello: "Hallo Welt" } }),
  "web/src/locales/keys.spec.ts": `import fs from "node:fs";\nfs.readFileSync("en-US.json");`,
  "web/src/comp/Attr.vue": [
    `<template><b :title="t('y.attr')">{{ $t("y.dollar") }}</b></template>`,
    "<script setup>const a = i18n.global.t('y.glob'); const b = t(`y.tpl`);</script>",
  ].join("\n"),
  "web/src/comp/Attr.spec.ts": `import A from "./Attr.vue";`,
  "web/src/comp/Hi.vue": `<template>{{ t("x.hello") }}</template>`,
  "web/src/comp/Hi.spec.ts": `import Hi from "./Hi.vue";`,
});
const base = commit();

const run = (files) => {
  git("checkout", "-q", base);
  write(files);
  return select({ repo, base, head: commit() });
};

test("a changed spec selects itself", () => {
  assert.deepEqual(graphSpecs(run({ "web/src/utils/c.spec.ts": "// edit" })), [
    "src/utils/c.spec.ts",
  ]);
});

test("a code file selects specs through alias and relative imports", () => {
  assert.deepEqual(graphSpecs(run({ "web/src/utils/a.ts": "export const a = 2;" })), [
    "src/comp/B.spec.ts",
  ]);
});

test("a non-setup test helper is a normal graph node", () => {
  assert.deepEqual(graphSpecs(run({ "web/src/test/helper.ts": "export const h = 2;" })), [
    "src/utils/c.spec.ts",
  ]);
});

test("config and setup files run everything", () => {
  assert.equal(run({ "web/package.json": `{"a":1}` }).mode, "full");
  assert.equal(run({ "web/src/test/setup.ts": "//" }).mode, "full");
});

test("app code loaded by the setup file runs everything", () => {
  const r = run({ "web/src/utils/q.ts": "export const q = 2;" });
  assert.equal(r.mode, "full");
  assert.match(r.reason, /^loaded by setupTests for every spec: web\/src\/utils\/q\.ts$/);
  assert.equal(r.setupHits, 1);
});

test("an added locale key selects only the specs that read locale files", () => {
  const r = run({
    "web/src/locales/languages/en-US.json": JSON.stringify({ ...EN, z: { new: "New" } }),
  });
  assert.equal(r.mode, "picked");
  assert.deepEqual(r.specs, [FS_SPEC]);
});

test("a non-English locale change selects the specs that read locale files", () => {
  const r = run({ "web/src/locales/languages/de-DE.json": JSON.stringify({ x: { hello: "Hi" } }) });
  assert.deepEqual(r.specs, [FS_SPEC]);
});

test("specs that read source through fs run for any web/src change", () => {
  assert.ok(run({ "web/src/utils/a.ts": "export const a = 3;" }).specs.includes(FS_SPEC));
  assert.ok(run({ "web/src/utils/orphan.ts": "export {};" }).specs.includes(FS_SPEC));
});

test("keys used in vue attributes, $t, i18n.global.t and template literals are found", () => {
  for (const k of Object.keys(EN.y)) {
    const r = run({
      "web/src/locales/languages/en-US.json": JSON.stringify({
        ...EN,
        y: { ...EN.y, [k]: "Changed" },
      }),
    });
    assert.deepEqual(graphSpecs(r), ["src/comp/Attr.spec.ts"], k);
  }
});

test("a changed locale value selects the specs of the files using the key", () => {
  const r = run({
    "web/src/locales/languages/en-US.json": JSON.stringify({
      ...EN,
      x: { ...EN.x, hello: "Hi there" },
    }),
  });
  assert.deepEqual(graphSpecs(r), ["src/comp/Hi.spec.ts"]);
});

test("no web/ change skips the UI suite", () => {
  assert.equal(run({ "README.md": "y" }).mode, "skip");
});

test("the gate counts statement lines only and treats a file without coverage as uncovered", () => {
  const diff = [
    "+++ b/web/src/a.ts",
    "@@ -1,0 +1,3 @@",
    "+covered();",
    "+// comment",
    "+missed();",
    "+++ b/web/src/b.ts",
    "@@ -4,0 +5,2 @@",
    "+x();",
    "+",
  ].join("\n");
  assert.deepEqual([...parseDiff(diff).get("src/a.ts")], [1, 2, 3]);
  const st = (line) => ({ start: { line }, end: { line } });
  const coverage = {
    "/w/web/src/a.ts": { statementMap: { 0: st(1), 1: st(3) }, s: { 0: 4, 1: 0 } },
  };
  const r = gate({
    diff,
    coverage,
    inScope: () => true,
    readSource: () => "\n\n\n\nx();\n",
    min: 70,
  });
  assert.equal(r.exec, 3);
  assert.equal(r.covered, 1);
  assert.equal(r.pass, false);
  assert.equal(
    gate({ diff: "", coverage, inScope: () => true, readSource: () => "", min: 70 }).pass,
    true,
  );
});
process.on("exit", () => fs.rmSync(repo, { recursive: true, force: true }));
