#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
//
// One-shot codemod: ORefreshButton v1 (split/inline layouts, ghost/outline, toolbar/header/inset)
// → v2 (one secondary layout, sm/md, `shortcut`).
//
//   node scripts/codemods/orefreshbutton-v2.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(WEB, "package.json"));
const { parse } = require("@vue/compiler-sfc");
const DRY = process.argv.includes("--dry");

const DROPPED = new Set([
  "layout",
  "variant",
  "age-format",
  "ageFormat",
  "spinner",
  "data-from",
  "dataFrom",
]);
const SIZE = { toolbar: null, header: null, inset: "sm" };

function walk(node, visit) {
  if (node.type === 1) visit(node);
  for (const c of node.children ?? []) walk(c, visit);
  for (const b of node.branches ?? []) walk(b, visit);
}

function transform(src, rel, report) {
  const { descriptor } = parse(src, { filename: rel });
  const ast = descriptor.template?.ast;
  if (!ast) return src;
  const edits = [];
  const remove = (p) => {
    let start = p.loc.start.offset;
    while (start > 0 && /\s/.test(src[start - 1])) start--;
    edits.push({ start, end: p.loc.end.offset, text: "" });
  };
  walk(ast, (node) => {
    if (node.tag !== "ORefreshButton") return;
    for (const p of node.props) {
      const bound = p.type === 7 && p.name === "bind" && p.arg?.isStatic;
      const name = p.type === 6 ? p.name : bound ? p.arg.content : null;
      if (!name) continue;
      if (DROPPED.has(name)) {
        remove(p);
        if (!["layout", "variant"].includes(name)) {
          report.push(`${rel}:${node.loc.start.line} dropped "${name}"`);
        }
      } else if (name === "size") {
        const to = bound ? undefined : SIZE[p.value?.content];
        if (to === undefined)
          report.push(
            `${rel}:${node.loc.start.line} size "${p.value?.content ?? p.exp?.content}" by hand`,
          );
        else if (to === null) remove(p);
        else edits.push({ start: p.loc.start.offset, end: p.loc.end.offset, text: `size="${to}"` });
      } else if (name === "shortcut-id" || name === "shortcutId") {
        const text = src.slice(p.loc.start.offset, p.loc.end.offset);
        edits.push({
          start: p.loc.start.offset,
          end: p.loc.end.offset,
          text: text.replace(/shortcut-?[iI]d/, "shortcut"),
        });
      }
    }
  });
  if (!edits.length) return src;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const report = [];
let changed = 0;
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p);
    else if (entry.name.endsWith(".vue")) {
      const src = fs.readFileSync(p, "utf8");
      if (!src.includes("ORefreshButton")) continue;
      const rel = path.relative(path.join(WEB, "src"), p).replace(/\\/g, "/");
      const out = transform(src, rel, report);
      if (out !== src) {
        changed++;
        if (!DRY) fs.writeFileSync(p, out);
      }
    }
  }
})(path.join(WEB, "src"));
console.log(report.join("\n"));
console.log(`\n${changed} files ${DRY ? "would change" : "changed"}`);
