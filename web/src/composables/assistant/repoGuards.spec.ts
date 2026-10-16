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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "../../..");
const SRC = join(WEB, "src");

// Frozen allow-lists: legacy code that predates the assistant rules. They only shrink (to zero at cutover, WP-15/WP-16).
const LEGACY_AI_EVENT_FILES = [
  "composables/useAiChat.ts",
  "composables/useChatStream.ts",
  "composables/useNLQuery.ts",
  "services/ai_toolsets.ts",
];
const LEGACY_ASSISTANT_UI = [
  /^components\/ai-assistant\/chat\//,
  /^components\/ai-assistant\/welcome\//,
  /^components\/ai-assistant\/share\/AiChat(ShareDialog|SharedByMe|ShareRow)\.vue$/,
];
const AUTO_AWESOME_CALL_SITES = [
  "components/ai-assistant/common/glyphs.ts",
  "components/alerts/AlertsDestinationList.vue",
  "components/alerts/TemplateList.vue",
  "components/autoobserve/v2/TopBar.vue",
  "components/login/firstSourceOptions.ts",
  "components/rum/productAnalytics/FunnelBuilder.vue",
  "components/settings/ServiceIdentitySetup.vue",
  "components/settings/TestModelMatchDialog.vue",
  "enterprise/components/onlineEvals/ScorerList.vue",
  "enterprise/views/AIObservability/Index.vue",
  "layouts/MainLayout.vue",
  "lib/core/EmptyState/presets.ts",
  "lib/core/Icon/OIcon.icons.ts",
  "plugins/logs/SearchResult.vue",
  "views/OverviewTab.vue",
];
// IW-01 AC 4: the assistant's legacy look may be read only by its own files (plus the frozen legacy consumers below).
const AI_TOKEN_OWNERS = [
  /^components\/ai-assistant\//,
  /^components\/O2AIChat/,
  /^components\/common\/O2AIContextAddBtn\.vue$/,
  /^components\/Header\.vue$/,
  /^lib\/styles\/tokens\//,
  /^styles\/utilities\.css$/,
];
const AI_TOKEN_LEGACY_CONSUMERS = [
  "components/alerts/IncidentTimeline.vue",
  "components/alerts/QueryEditorDialog.vue",
  "components/autoobserve/v2/ChangesPage.vue",
  "components/common/QueryErrorState.vue",
  "components/dbm/DbmSuggestFixButton.vue",
  "components/functions/FunctionsToolbar.vue",
  "components/pipeline/NodeForm/Query.vue",
  "components/pipeline/PipelineEditor.vue",
  "components/QueryEditor.vue",
  "components/settings/AddRegexPattern.vue",
  "lib/core/Button/OButton.vue",
  "lib/core/EmptyState/EmptyStateIngestionChip.vue",
  "utils/activityTimeline.ts",
  "views/HomeView.vue",
];
const AI_ASSISTANT_KEY_COUNT = 170;

const TOP_LEVEL_DECLARATIONS = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
]);

interface SourceFile {
  path: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sources: SourceFile[] = walk(SRC)
  .map((full) => relative(SRC, full).split("\\").join("/"))
  .filter((path) => /\.(vue|ts|js|css)$/.test(path))
  .filter(
    (path) =>
      !/\.(spec|test)\.[jt]s$/.test(path) && !/(^|\/)(__fixtures__|__mocks__|test)\//.test(path),
  )
  .map((path) => ({ path, text: readFileSync(join(SRC, path), "utf8") }));

const inAssistantUi = (path: string) =>
  path.startsWith("components/ai-assistant/") && !LEGACY_ASSISTANT_UI.some((re) => re.test(path));

const offenders = (predicate: (file: SourceFile) => boolean) =>
  sources.filter(predicate).map((file) => file.path);

function leaves(node: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node))
      leaves(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const locale = JSON.parse(readFileSync(join(SRC, "locales/languages/en-US.json"), "utf8"));

describe("assistant repo guards", () => {
  it("changes placement only inside the store", () => {
    expect(
      offenders(
        (f) =>
          /shell\.placement\s*=[^=]/.test(f.text) &&
          f.path !== "composables/assistant/assistantStore.ts",
      ),
    ).toEqual([]);
  });

  it("builds ai_* events only in services/assistantAnalytics.ts", () => {
    const call = /\b\w*(?:track|addAction)\w*\s*\(\s*(?:[\w.]+\s*,\s*)?["'`]ai_[a-z_]+/;
    expect(
      offenders(
        (f) =>
          call.test(f.text) &&
          f.path !== "services/assistantAnalytics.ts" &&
          !LEGACY_AI_EVENT_FILES.includes(f.path),
      ),
    ).toEqual([]);
  });

  it("keeps v-html out of assistant components except transcript/markdown.ts", () => {
    expect(
      offenders(
        (f) =>
          inAssistantUi(f.path) &&
          /\bv-html\b/.test(f.text) &&
          f.path !== "components/ai-assistant/transcript/markdown.ts",
      ),
    ).toEqual([]);
  });

  it.each([
    ["ai-gradient", /ai-gradient/],
    ["gradient-ai", /gradient-ai/],
    ["chat-bubble-", /chat-bubble-/],
    ["uppercase", /\buppercase\b/],
    ['OIcon name="', /<OIcon[^>]*\sname="/],
  ])("bans %s in assistant components", (_label, pattern) => {
    expect(offenders((f) => inAssistantUi(f.path) && pattern.test(f.text))).toEqual([]);
  });

  it("allows rounded-full only in the status dot", () => {
    expect(
      offenders(
        (f) =>
          inAssistantUi(f.path) &&
          /\brounded-full\b/.test(f.text) &&
          f.path !== "components/ai-assistant/common/AssistantStatusDot.vue",
      ),
    ).toEqual([]);
  });

  it("names auto-awesome only in glyphs.ts and the frozen call sites", () => {
    const found = offenders((f) => /["']auto-awesome["']|\/auto-awesome/.test(f.text));
    expect(found.filter((path) => !AUTO_AWESOME_CALL_SITES.includes(path))).toEqual([]);
    expect(found).toContain("components/ai-assistant/common/glyphs.ts");
    expect(found).not.toContain("plugins/traces/ThreadView.vue");
  });

  it("adds no aiAssistant.* keys", () => {
    expect(leaves(locale.aiAssistant).length).toBeLessThanOrEqual(AI_ASSISTANT_KEY_COUNT);
  });

  it("keeps the product literal only in assistant.name", () => {
    const literal = leaves(locale.assistant, "assistant").filter(
      ([key, value]) => value.includes("O2 Assistant") && key !== "assistant.name",
    );
    expect(literal).toEqual([]);
    expect(locale.assistant.name).toBe("O2 Assistant");
  });

  it("keeps the product literal in code only in useAssistantName.ts", () => {
    expect(
      offenders(
        (f) =>
          (inAssistantUi(f.path) || f.path.startsWith("composables/assistant/")) &&
          f.text.includes("O2 Assistant") &&
          f.path !== "composables/assistant/useAssistantName.ts",
      ),
    ).toEqual([]);
  });

  it("reads --color-ai-accent, --color-chat-bubble-* and --color-gradient-ai* only from the assistant's files", () => {
    const found = offenders((f) => /ai-accent|chat-bubble-|gradient-ai/.test(f.text));
    const outside = found.filter((path) => !AI_TOKEN_OWNERS.some((re) => re.test(path)));
    expect(outside.filter((path) => !AI_TOKEN_LEGACY_CONSUMERS.includes(path))).toEqual([]);
    expect(
      found.filter((path) =>
        /plugins\/traces\/|enterprise\/(components|views)\/AIObservability/.test(path),
      ),
    ).toEqual([]);
  });

  it("keeps every composables/assistant module free of import-time side effects", () => {
    const files = sources.filter(
      (f) => f.path.startsWith("composables/assistant/") && f.path.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    const statements = files.flatMap((f) =>
      ts
        .createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
        .statements.filter((s) => !TOP_LEVEL_DECLARATIONS.has(s.kind))
        .map(
          (s) =>
            `${f.path}: ${s.getText(ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest)).slice(0, 60)}`,
        ),
    );
    expect(statements).toEqual([]);
  });

  it("resolves every assistant colour utility to a registered token", () => {
    const css = readFileSync(join(SRC, "lib/styles/tokens/component.css"), "utf8");
    const registered = new Set(
      [...css.matchAll(/@theme inline \{([\s\S]*?)\n\}/g)].flatMap((block) =>
        [...block[1].matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]),
      ),
    );
    const used = new Set(
      sources
        .filter((f) => inAssistantUi(f.path))
        .flatMap((f) =>
          [...f.text.matchAll(/\b(?:bg|text|ring|border)-(assistant-[a-z-]+)/g)].map((m) => m[1]),
        ),
    );
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !registered.has(name))).toEqual([]);
  });
});

describe("assistant lint config", () => {
  it("keeps the global vue-i18n useI18n ban on assistant files", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: WEB });
    const config = await eslint.calculateConfigForFile(
      join(WEB, "src/components/ai-assistant/x.vue"),
    );
    const [, options] = config.rules["no-restricted-imports"];
    expect(options.paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "vue-i18n", importNames: ["useI18n"] }),
      ]),
    );
    expect(config.rules["vue/no-v-html"][0]).toBe(2);
    expect(config.rules["vuejs-accessibility/no-autofocus"][0]).toBe(2);
  }, 60_000);
});
