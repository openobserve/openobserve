// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Product names live only in the "brand" block of en-US.json, so a rename is one edit there.
// Locale values link to them as @:{'brand.x'}; code uses t("brand.x"), specs and e2e read the block. Example: a translator who
// types the name instead of @:{'brand.autobot'} fails "no locale value spells a product name".

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import enMessages from "@/locales/languages/en-US.json";
import { useAssistantName } from "@/composables/assistant/useAssistantName";
import { localeStems, readLocaleMessages } from "@/test/unit/helpers/localeFiles";

// Flip to true once every old name is gone; until then the old-name checks are skipped.
// BRAND_GUARD_STRICT=1 runs them anyway, so the remaining list can be read.
const ENFORCE_OLD_NAMES = true;
const enforceOld = ENFORCE_OLD_NAMES || process.env.BRAND_GUARD_STRICT === "1";

const REPO = resolve(__dirname, "../../..");
const SELF = "web/src/locales/brandNames.spec.ts";
const SOURCE = "web/src/locales/languages/en-US.json";
const brand: Record<string, string> = enMessages.brand;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEW_NAMES = new RegExp(
  Object.values(brand)
    .map((name) => `\\b${escape(name)}\\b`)
    .join("|"),
);

// Old names in locale values. "the assistant" and the bare label "Assistant" count (D2, D5).
const OLD_IN_LOCALES =
  /O2 Assistant|\bO2 AI\b|\bAI [Aa]ssistant\b|\bAsk AI\b|\bAI[ -]SRE\b|\bRCA\b|\b[Tt]he assistant\b|^Assistant$|› Assistant\b|\bInvestigator\b/;
// Old product names in any file, comments included, so the next rename finds nothing.
const OLD_IN_FILES = /O2 Assistant|\bO2 AI\b|\bAI[ -]SRE\b/;

// The model's message role, not this product. Example: a trace row "Assistant: Hello".
const LOCALE_ALLOWLIST = new Set([
  "llmObservability.threadView.assistant",
  "traces.sessionDetail.roles.assistant",
  "traces.lLMContentRenderer.roleAssistant",
  "aiObservability.playground.roleAssistant",
  "aiObservability.playground.addToMessagesTooltip",
  // A sign-up answer naming outside AI assistants as how the user heard of us.
  "login.heardFrom.aiAssistant",
]);

// Files that may keep an old name, with why.
const FILE_ALLOWLIST = [
  "web/src/lib/", // shared library comments; that folder is edited only with owner approval
  "tests/ui-testing/playwright-tests/assistant/harness/mocks.mjs", // backend error text (D10)
  "tests/ui-testing/pages/iamPages/iamPage.js", // backend service-account label (D10)
];

const SKIP_DIRS = new Set(["node_modules", "playwright-results", "test-results", "dist"]);
const TEXT_FILE = /\.(vue|ts|js|mjs|cjs|json|css|scss|md|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(path, out);
    } else if (TEXT_FILE.test(name)) out.push(path);
  }
  return out;
}

const files = [
  ...walk(join(REPO, "web/src")).filter((path) => !path.includes("/src/locales/languages/")),
  ...walk(join(REPO, "tests/ui-testing")),
].map((path) => ({ path: relative(REPO, path), text: readFileSync(path, "utf8") }));

function leaves(node: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node))
      leaves(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const locales = localeStems().map((stem) => ({
  stem,
  values: leaves(readLocaleMessages(stem)),
}));

const BRAND_LINK = /@:\{'brand\.([^']*)'\}/g;
const links = (value: string) => [...value.matchAll(BRAND_LINK)].map((m) => m[1]).sort();

describe("brand names have one source", () => {
  it("reads 17 locales", () => {
    expect(locales).toHaveLength(17);
  });

  // The brand block is the one allowed place.
  it("no locale value spells a product name", () => {
    const found = locales.flatMap(({ stem, values }) =>
      values
        .filter(([key, value]) => !key.startsWith("brand.") && NEW_NAMES.test(value))
        .map(([key]) => `${stem}: ${key}`),
    );
    expect(found).toEqual([]);
  });

  // The bare form @:brand.x swallows the next "." "'" "," ":" or letter and renders the key path.
  it("links brand names only as @:{'brand.x'} and only to names the brand block has", () => {
    const found = locales.flatMap(({ stem, values }) =>
      values
        .filter(
          ([, value]) =>
            /@(\.\w+)?:brand\./.test(value) || links(value).some((name) => !(name in brand)),
        )
        .map(([key, value]) => `${stem}: ${key} = ${value}`),
    );
    expect(found).toEqual([]);
  });

  it("no file outside the brand block spells a product name", () => {
    const found = files
      .filter((file) => file.path !== SOURCE && NEW_NAMES.test(file.text))
      .map((file) => file.path);
    expect(found).toEqual([]);
  });

  it("useAssistantName reads the brand block", () => {
    expect(useAssistantName().product).toBe(brand.autobot);
  });

  it.runIf(enforceOld)("no locale value keeps an old name", () => {
    const found = locales.flatMap(({ stem, values }) =>
      values
        .filter(([key, value]) => !LOCALE_ALLOWLIST.has(key) && OLD_IN_LOCALES.test(value))
        .map(([key, value]) => `${stem}: ${key} = ${value}`),
    );
    expect(found).toEqual([]);
  });

  it.runIf(enforceOld)("no file keeps an old name", () => {
    const found = files
      .filter(
        (file) =>
          file.path !== SELF &&
          !FILE_ALLOWLIST.some((allowed) => file.path.startsWith(allowed)) &&
          OLD_IN_FILES.test(file.text),
      )
      .map((file) => file.path);
    expect(found).toEqual([]);
  });

  it.runIf(enforceOld)("every translation keeps the brand links en-US has", () => {
    const english = new Map(locales.find(({ stem }) => stem === "en-US")!.values);
    const found = locales.flatMap(({ stem, values }) =>
      values
        .filter(([key, value]) => {
          const source = english.get(key);
          return source !== undefined && links(value).join() !== links(source).join();
        })
        .map(([key]) => `${stem}: ${key}`),
    );
    expect(found).toEqual([]);
  });
});
