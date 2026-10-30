#!/usr/bin/env node
// bug-me-not checklist body → items JSON. Usage: parse-bug-items.mjs <body.md> | --self-test
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrivate } from "./private-config.mjs";

const PATH_PREFIXES = [
  "web/",
  "src/",
  "tests/",
  ".github/",
  "scripts/",
  "deploy/",
  "benchmarks/",
];
// Self-tests use this fake private repo prefix, never a real config.
export const FAKE_PRIVATE_PREFIXES = ["acme_ext/"];
const ITEM_RE = /^- \[([ xX])\] \*\*(.*)$/;
const PRIORITY_RE = /^`(P[0-4])`\s*[·:|\-–—]?\s*/;
const LABEL_RE = /\*\*([A-Za-z][A-Za-z /-]{0,40}?)(?::\*\*|\*\*(?:\s*\([^)\n]*\))?\s*:)/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pathRe = (extra) =>
  new RegExp(`(?<![\\w./-])(?:${[...PATH_PREFIXES, ...extra].map(escapeRe).join("|")})[\\w@+\\-\\[\\]./]*[\\w\\]/]`, "g");

function bugDescriptionSection(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^###\s+Bug Description\s*$/i.test(l.trim()));
  if (start === -1) return lines;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s+\S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function splitHead(head) {
  const pm = head.match(PRIORITY_RE);
  const priority = pm ? pm[1] : null;
  const afterPriority = pm ? head.slice(pm[0].length) : head;
  const close = afterPriority.indexOf("**");
  if (close === -1) return { priority, title: afterPriority.trim(), symptomHead: "" };
  return {
    priority,
    title: afterPriority.slice(0, close).trim(),
    symptomHead: afterPriority.slice(close + 2).trim(),
  };
}

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n").trim();
}

function extractDetails(blockLines) {
  const text = blockLines.join("\n");
  const open = text.search(/<details>/i);
  if (open === -1) return { before: text, details: "" };
  const closeIdx = text.slice(open).search(/<\/details>/i);
  const inner = closeIdx === -1 ? text.slice(open + 9) : text.slice(open + 9, open + closeIdx);
  const withoutSummary = inner.replace(/<summary>[\s\S]*?<\/summary>/i, "");
  return { before: text.slice(0, open), details: dedent(withoutSummary.split("\n")) };
}

function labelledSections(details) {
  const marks = [...details.matchAll(LABEL_RE)].map((m) => ({
    key: m[1].trim().toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
  const out = {};
  marks.forEach((m, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].start : details.length;
    const value = details
      .slice(m.end, stop)
      .replace(/\n\s*[-*]\s*$/, "")
      .trim();
    if (!(m.key in out) && value) out[m.key] = value;
  });
  return out;
}

function extractPaths(text, re) {
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const p = m[0];
    const base = p.split("/").pop();
    // A directory would widen the fix scope to a whole subtree, so only files count.
    if (p.endsWith("/") || p.includes("..") || p.includes("//") || !/\.[A-Za-z0-9]+$/.test(base)) continue;
    seen.add(p);
  }
  return [...seen];
}

function buildItem(index, checked, head, blockLines, re) {
  const { priority, title, symptomHead } = splitHead(head);
  const { before, details } = extractDetails(blockLines);
  const symptom = [symptomHead, dedent(before.split("\n"))].filter(Boolean).join("\n").trim();
  const sections = labelledSections(details);
  return {
    index,
    priority,
    checked,
    title: title.replace(/\.$/, ""),
    symptom,
    details,
    where: sections.where ?? null,
    proposed_fix: sections["proposed fix"] ?? null,
    how_to_verify: sections["how to verify"] ?? null,
    // Paths outside Where are context and must not widen the fix scope; bodies with no Where label fall back to all details.
    paths: extractPaths(sections.where ?? details, re),
  };
}

export function parseBugItems(rawBody, privatePrefixes = []) {
  const re = pathRe(privatePrefixes);
  const body = String(rawBody ?? "").replace(/\r\n?/g, "\n");
  const lines = bugDescriptionSection(body);
  const items = [];
  let current = null;
  const flush = () => {
    if (current) items.push(buildItem(items.length + 1, current.checked, current.head, current.lines, re));
  };
  for (const line of lines) {
    const m = line.match(ITEM_RE);
    if (m) {
      flush();
      current = { checked: m[1] !== " ", head: m[2], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  const ranked = items.filter((i) => i.priority).map((i) => i.priority).sort();
  return {
    items,
    top_priority: ranked[0] ?? null,
    eligible_indexes: items
      .filter((i) => (i.priority === "P2" || i.priority === "P3") && !i.checked)
      .map((i) => i.index),
    body_sha256: createHash("sha256").update(String(rawBody ?? ""), "utf8").digest("hex"),
  };
}

function selfTest() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const cases = readdirSync(dir).filter((f) => f.endsWith(".md"));
  let failed = 0;
  for (const f of cases) {
    const expected = JSON.parse(readFileSync(join(dir, f.replace(/\.md$/, ".expected.json")), "utf8"));
    const raw = readFileSync(join(dir, f), "utf8");
    // .gitattributes forces LF on checkout, so CRLF fixtures get their line endings back here.
    const got = parseBugItems(f.includes("crlf") ? raw.replace(/\r?\n/g, "\r\n") : raw, FAKE_PRIVATE_PREFIXES);
    const problems = [];
    for (const [key, want] of Object.entries(expected)) {
      if (key === "items" || key === "item_count") continue;
      if (JSON.stringify(got[key]) !== JSON.stringify(want)) problems.push(`${key}: got ${JSON.stringify(got[key])}`);
    }
    (expected.items ?? []).forEach((want, i) => {
      const item = got.items[i] ?? {};
      for (const [key, value] of Object.entries(want)) {
        const actual = item[key];
        const ok =
          key.endsWith("_contains") ?
            typeof item[key.replace(/_contains$/, "")] === "string" && item[key.replace(/_contains$/, "")].includes(value)
          : JSON.stringify(actual) === JSON.stringify(value);
        if (!ok) problems.push(`item ${i + 1} ${key}: got ${JSON.stringify(key.endsWith("_contains") ? item[key.replace(/_contains$/, "")] : actual)}`);
      }
    });
    if (expected.item_count !== undefined && got.items.length !== expected.item_count) {
      problems.push(`item_count: got ${got.items.length}`);
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${f}`);
    problems.forEach((p) => console.log(`     ${p}`));
    failed += problems.length ? 1 : 0;
  }
  console.log(`${cases.length - failed}/${cases.length} fixtures passed`);
  process.exit(failed || !cases.length ? 1 : 0);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const arg = process.argv[2];
  if (arg === "--self-test") selfTest();
  else if (!arg) {
    console.error("usage: parse-bug-items.mjs <body.md> | --self-test");
    process.exit(2);
  } else {
    process.stdout.write(`${JSON.stringify(parseBugItems(readFileSync(arg, "utf8"), loadPrivate()?.route_prefixes ?? []), null, 2)}\n`);
  }
}
