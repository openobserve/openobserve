#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
//
// Pre-flight before deleting any CSS class rule (O2_STYLE_MIGRATION_PLAN.md §7.3).
// Answers: "who actually uses this class?" — covering the ways a class name can
// reach the DOM and escape a naive template grep (plan risks R1 / R5):
//
//   1. static  class="… foo …"
//   2. bound   :class="{ foo: cond }" / :class="['foo']" / :class="x ? 'foo' : ''"
//   3. JS      classList.add('foo'), `status-${x}` fragments, string literals in .ts
//   4. CSS     the rules that DEFINE it (so you can see every definition site)
//   5. specs   assertions on the class (these break when you delete it)
//
// Usage:
//   node scripts/find-class-consumers.mjs logPage_bkcss histogram-container
//   node scripts/find-class-consumers.mjs --quiet foo   # exit 1 if consumers exist
//
// Verdict per class:
//   NO CONSUMERS      → safe to delete
//   SELF-CONTAINED    → only the defining file uses it → colocate
//   HAS CONSUMERS     → migrate consumers in the same PR

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const EXTS = new Set([".css", ".vue", ".ts", ".js", ".scss"]);

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const names = args.filter((a) => !a.startsWith("--"));

if (names.length === 0) {
  console.error("Usage: node scripts/find-class-consumers.mjs <className>...");
  process.exit(2);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (EXTS.has(extname(entry))) files.push(full);
  }
  return files;
}

const files = walk(SRC_DIR);
const cache = new Map();
for (const f of files) cache.set(f, readFileSync(f, "utf8").split("\n"));

const rel = (f) => f.replace(SRC_DIR + "/", "src/");

/**
 * Split a .vue file into template / script / style line ranges so we can say
 * *where* a hit lives — a hit in <style> is a definition, in <template> a consumer.
 */
function sectionOf(file, lines, lineIdx) {
  if (extname(file) !== ".vue") return extname(file) === ".css" || extname(file) === ".scss" ? "style" : "script";
  let section = "script";
  for (let i = 0; i <= lineIdx; i++) {
    const l = lines[i];
    if (/^\s*<template[\s>]/i.test(l)) section = "template";
    else if (/^\s*<script[\s>]/i.test(l)) section = "script";
    else if (/^\s*<style[\s>]/i.test(l)) section = "style";
  }
  return section;
}

let anyConsumers = false;

for (const name of names) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // A definition: `.name` appearing in a selector position inside CSS.
  const defRe = new RegExp(`\\.${esc}(?![\\w-])`);
  // A usage: the bare word inside a class-ish string context.
  const wordRe = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`);
  // Dynamic construction: `status-${x}` style — flag prefixes of the name.
  const parts = name.split("-");
  const dynRes = [];
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join("-");
    dynRes.push(new RegExp("[\"'`]" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-\\$\\{"));
  }

  const definitions = [];
  const consumers = [];
  const specs = [];
  const dynamic = [];

  for (const [file, lines] of cache) {
    lines.forEach((line, i) => {
      const section = sectionOf(file, lines, i);
      const isSpec = /\.spec\.(ts|js)$/.test(file);

      if (wordRe.test(line)) {
        const hit = { file: rel(file), line: i + 1, text: line.trim().slice(0, 100) };
        if (section === "style" && defRe.test(line)) definitions.push(hit);
        else if (isSpec) specs.push(hit);
        else if (section === "template" || section === "script") consumers.push(hit);
        else if (defRe.test(line)) definitions.push(hit);
      }
      for (const dre of dynRes) {
        if (dre.test(line)) dynamic.push({ file: rel(file), line: i + 1, text: line.trim().slice(0, 100) });
      }
    });
  }

  const defFiles = new Set(definitions.map((d) => d.file));
  const consumerFiles = new Set(consumers.map((c) => c.file));
  const external = [...consumerFiles].filter((f) => !defFiles.has(f));

  let verdict;
  if (consumers.length === 0 && specs.length === 0) verdict = "NO CONSUMERS — safe to delete";
  else if (external.length === 0) verdict = "SELF-CONTAINED — colocate into the defining file";
  else verdict = `HAS CONSUMERS (${external.length} external file(s)) — migrate them in the same PR`;

  if (verdict.startsWith("HAS")) anyConsumers = true;

  if (quiet) continue;

  console.log(`\n\x1b[1m.${name}\x1b[0m — ${verdict}`);

  const show = (label, arr) => {
    if (arr.length === 0) return;
    console.log(`  ${label} (${arr.length}):`);
    for (const h of arr.slice(0, 12)) console.log(`    ${h.file}:${h.line}  ${h.text}`);
    if (arr.length > 12) console.log(`    ...and ${arr.length - 12} more`);
  };

  show("definitions", definitions);
  show("consumers", consumers);
  show("specs (update in-PR)", specs);
  if (dynamic.length > 0) {
    console.log(`  \x1b[33mdynamic-construction candidates\x1b[0m (${dynamic.length}) — review manually:`);
    for (const h of dynamic.slice(0, 6)) console.log(`    ${h.file}:${h.line}  ${h.text}`);
  }
}

process.exit(quiet && anyConsumers ? 1 : 0);
