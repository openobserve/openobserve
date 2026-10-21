// Copyright 2026 OpenObserve Inc.

// Fails CI when a translation drops a placeholder or merges plural forms, the same rule translator.py enforces on new output.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LANGUAGES_DIR = resolve(__dirname, "./languages");
const STATE_FILE = resolve(__dirname, "../../../scripts/translations/.translation_state.json");
const SOURCE_LOCALE = "en-US";

// Mismatches that predate this spec; fix a key, then delete it here.
const KNOWN_MISMATCHES: Record<string, string[]> = Object.fromEntries(
  ["zh-CN", "zh-TW"].map((code) => [
    code,
    [
      "alerts.downtimes.confirmCancel.confirm",
      "alerts.downtimes.confirmCancel.keep",
      "dashboard.dashboards.deletedSuccessfullyCount",
      "dashboard.saveConflict.panelCount",
      "dashboard.saveConflict.tabCount",
      "dashboard.saveConflict.variableCount",
      "dashboard.saveConflict.yourChange",
      "iam.appGroups.bulkDeleteFailed",
      "iam.appGroups.bulkDeleteSuccess",
      "iam.appRoles.bulkDeleteFailed",
      "iam.appRoles.bulkDeleteSuccess",
      "modelPricing.confirmDeleteSelectedMessage",
      "serviceAccounts.toast.bulkDeleteSuccess",
      "settings.cipherKeysPage.bulkDeleteFailed",
      "settings.cipherKeysPage.bulkDeleteSuccess",
      "settings.regexPatternList.bulkDeleteFailed",
      "settings.regexPatternList.bulkDeleteSuccess",
      "synthetics.journey.extract.title",
      "synthetics.journey.extract.unit.hours",
      "synthetics.journey.extract.unit.minutes",
      "synthetics.journey.subtest.pickSteps",
      "synthetics.journey.subtest.pickUsedBy",
      "synthetics.journey.subtest.stepsBadge",
      "synthetics.save.usedByCount",
      "synthetics.save.usedByTitle",
      "synthetics.table.usedByCount",
    ],
  ]),
);

const LITERAL_ESCAPE = /\{\s*'[^']*'\s*\}/g;
const TOKEN = /\{\s*([A-Za-z_$][\w$]*|\d+)\s*\}|@(?:\.[A-Za-z_$][\w$]*)?:[\w.]+|%[sd]/g;

function flatten(node: unknown, path = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out.set(path, node);
  }
  return out;
}

const loadJson = (path: string): Map<string, unknown> =>
  flatten(JSON.parse(readFileSync(path, "utf8")));

function tokens(message: string): string[] {
  const text = message.replace(LITERAL_ESCAPE, "");
  return [...text.matchAll(TOKEN)].map((m) => m[0].replace(/\s/g, "")).sort();
}

function pluralForms(message: string): number {
  return message.replace(LITERAL_ESCAPE, "").split("|").length;
}

const sourceHash = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

const source = loadJson(resolve(LANGUAGES_DIR, `${SOURCE_LOCALE}.json`));
const state = loadJson(STATE_FILE);

// A key whose English changed since the last pipeline run is pending, and the pipeline re-translates it.
const settled = [...source].filter(
  (entry): entry is [string, string] =>
    typeof entry[1] === "string" && state.get(entry[0]) === sourceHash(entry[1]),
);

const locales = readdirSync(LANGUAGES_DIR)
  .map((name) => name.replace(/\.json$/, ""))
  .filter((code) => code !== SOURCE_LOCALE)
  .sort();

describe("tokens and pluralForms", () => {
  it("count placeholders and forms but not literal escapes", () => {
    expect(tokens("{count} item {'|'} {'{'}x{'}'} @:common.save | {count} items")).toEqual([
      "@:common.save",
      "{count}",
      "{count}",
    ]);
    expect(pluralForms("{count} item | {count} items")).toBe(2);
    expect(pluralForms("a {'|'} b")).toBe(1);
  });
});

describe.each(locales)("%s matches en-US placeholders and plural forms", (code) => {
  const target = loadJson(resolve(LANGUAGES_DIR, `${code}.json`));
  const known = new Set(KNOWN_MISMATCHES[code] ?? []);
  const mismatched = settled
    .filter(([key, en]) => {
      const value = target.get(key);
      if (typeof value !== "string") return false;
      return tokens(value).join() !== tokens(en).join() || pluralForms(value) !== pluralForms(en);
    })
    .map(([key]) => key);

  it("has no new mismatch", () => {
    expect(mismatched.filter((key) => !known.has(key))).toEqual([]);
  });

  it("lists no key that is already fixed", () => {
    expect([...known].filter((key) => !mismatched.includes(key))).toEqual([]);
  });
});
