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

// ONE shared governance spec, parameterized over the pack registry — registering
// a pack IS opting into every generic invariant (design §9). Assertions call
// `lintManifest` from resolve.ts so the same rules are runnable outside vitest.

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { describe, it, expect } from "vitest";
import type { FieldAlias } from "@/services/service_streams";
import { lintManifest } from "../resolve";
import { validateUserCode } from "@/utils/dashboard/convertCustomChartData";
import { curatedPacks } from "./index";
import defaultSemanticGroups from "./__fixtures__/semanticGroups.default.json";
import enLocale from "@/locales/languages/en-US.json";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import { b64DecodeUnicodeSafe } from "@/utils/zincutils";
import { raw } from "@/types/i18n";

const groups = defaultSemanticGroups as FieldAlias[];
const REAL_GROUP_IDS = new Set(groups.map((g) => g.id));

const UNIT_VALUES = new Set(
  getUnitOptions(((k: string) => raw(k)) as any)
    .map((o) => o.value)
    .filter((v): v is string => v != null),
);

/** Labels the cardinality rule accepts as enumerable without a topk bound. */
const ENUMERABLE_LABELS = new Set([
  "phase",
  "condition",
  "direction",
  "status",
  "action",
  // §4.1 amendment (cold review loop 2, finding 1): the three host-shaped labels.
  // Their domains are fixed by the kernel, not by fleet size — CPU states, block
  // devices and mountpoints are per-host constants — and no registered pack
  // groups on them unpinned, so they cannot fan out with the fleet.
  "state",
  "device",
  "mountpoint",
]);

/** Collector tokens a capability-first label must not START with (finding 21). */
const COLLECTOR_TOKENS = ["kubeletstats", "kube-state", "cluster receiver", "kubelet"];

/** The v1 public identifiers — renames are deliberate, release-noted decisions. */
const GOLDEN_NAMES: Record<string, { pickers: string[]; sections: string[] }> = {
  kubernetes: {
    pickers: ["cluster", "namespace", "pod"],
    // "summary" leads deliberately: the landing tab is tabs[0]
    // (CuratedPageView.vue:151-164) and the fleet roll-up is the page's answer to
    // "which cluster should I look at" before any single one is worth opening.
    sections: ["summary", "overview", "health", "utilization", "nodes", "workloads"],
  },
  hosts: { pickers: ["host"], sections: ["host"] },
};

const packs = Object.entries(curatedPacks) as Array<[string, any]>;

const i18nHas = (key: string): boolean => {
  let node: any = enLocale;
  for (const segment of key.split(".")) {
    if (node == null || typeof node !== "object" || !(segment in node)) return false;
    node = node[segment];
  }
  return typeof node === "string";
};

const panelsOf = (manifest: any): any[] =>
  manifest.sections.flatMap((section: any) =>
    section.panels.map((panel: any) => ({ ...panel, sectionId: section.id })),
  );

const queriesOf = (panel: any): string[] =>
  panel.variants.flatMap((v: any) => v.queries.map((q: any) => q.query as string));

const allTokens = (manifest: any, prefix: "f" | "scope"): string[] => {
  const out: string[] = [];
  const pattern = new RegExp(`\\$\\{${prefix}:([^}]+)\\}`, "g");
  for (const panel of panelsOf(manifest)) {
    for (const text of [
      ...queriesOf(panel),
      ...panel.variants.flatMap((v: any) => v.queries.map((q: any) => q.legend ?? "")),
    ]) {
      for (const match of String(text).matchAll(pattern)) out.push(match[1]);
    }
  }
  return out;
};

const isProbeGroup = (manifest: any, groupId: string): boolean =>
  Boolean(manifest.groups.find((g: any) => g.id === groupId)?.probe);

describe("lintManifest is the governance gate itself", () => {
  it.each(packs)("%s passes lintManifest with zero violations", (_id, manifest) => {
    expect(lintManifest(manifest)).toEqual([]);
  });

  it("lintManifest CATCHES a violation rather than always returning []", () => {
    // A lint that cannot fail is not a lint. Break one rule deliberately.
    const broken = {
      ...curatedPacks.kubernetes,
      sections: curatedPacks.kubernetes.sections.map((s: any, i: number) =>
        i === 0 ? { ...s, panels: [...s.panels, { ...s.panels[0] }] } : s,
      ),
    };
    expect(lintManifest(broken).length).toBeGreaterThan(0);
  });
});

describe.each(packs)("generic invariants — %s pack", (packId, manifest) => {
  const panels = panelsOf(manifest);

  it("registers under its own manifest id", () => {
    expect(manifest.id).toBe(packId);
  });

  it("has unique panel, group and section ids", () => {
    const ids = panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = manifest.groups.map((g: any) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const sectionIds = manifest.sections.map((s: any) => s.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it("every panel's groupId names a declared group", () => {
    const groupIds = new Set(manifest.groups.map((g: any) => g.id));
    for (const panel of panels) expect(groupIds.has(panel.groupId), panel.id).toBe(true);
  });

  it("every unit is a real getUnitOptions value, including variant overrides", () => {
    for (const panel of panels) {
      expect(UNIT_VALUES.has(panel.unit), `${panel.id} unit`).toBe(true);
      for (const variant of panel.variants) {
        if (variant.unit) expect(UNIT_VALUES.has(variant.unit), `${panel.id} variant`).toBe(true);
      }
    }
  });

  it("every layout w is within the 192-column grid", () => {
    for (const panel of panels) {
      expect(panel.layout.w, panel.id).toBeGreaterThan(0);
      expect(panel.layout.w, panel.id).toBeLessThanOrEqual(192);
      expect(panel.layout.h, panel.id).toBeGreaterThan(0);
    }
  });

  it("no WHITESPACE inside any =~ / !~ matcher value (the shipped-dashboard regression class)", () => {
    for (const panel of panels) {
      for (const query of queriesOf(panel)) {
        for (const match of query.matchAll(/[!=]~"([^"]*)"/g)) {
          expect(match[1], `${panel.id}: ${match[0]}`).not.toMatch(/\s/);
        }
      }
    }
  });

  it("every ${f:<gid>} token names a group that EXISTS in the committed defaults snapshot", () => {
    // The §3.3.1 pinning contract, made a CI failure — a typo'd `k8s-pod` fails
    // here rather than rendering an empty chart at runtime.
    for (const id of allTokens(manifest, "f")) {
      expect(REAL_GROUP_IDS.has(id), `\${f:${id}}`).toBe(true);
    }
  });

  it("every fieldOverrides and probeFields KEY is likewise a real group id", () => {
    for (const group of manifest.groups) {
      for (const key of Object.keys(group.fieldOverrides ?? {})) {
        expect(REAL_GROUP_IDS.has(key), `${group.id}.fieldOverrides.${key}`).toBe(true);
      }
      for (const key of Object.keys(group.probeFields ?? {})) {
        expect(REAL_GROUP_IDS.has(key), `${group.id}.probeFields.${key}`).toBe(true);
      }
    }
  });

  it("every scope picker's group is a real group id", () => {
    for (const picker of manifest.scopePickers) {
      expect(REAL_GROUP_IDS.has(picker.group), picker.name).toBe(true);
    }
  });

  it("every non-probe variant declares a NON-EMPTY requiresStreams", () => {
    for (const panel of panels) {
      if (isProbeGroup(manifest, panel.groupId)) continue;
      for (const variant of panel.variants) {
        expect(Array.isArray(variant.requiresStreams), panel.id).toBe(true);
        expect(variant.requiresStreams.length, panel.id).toBeGreaterThan(0);
      }
    }
  });

  it("every ${scope:} token names a picker declared in that panel's section scopedBy", () => {
    const pickerNames = new Set(manifest.scopePickers.map((p: any) => p.name));
    for (const panel of panels) {
      const section = manifest.sections.find((s: any) => s.id === panel.sectionId);
      const scopedBy = new Set(section.scopedBy ?? []);
      for (const query of queriesOf(panel)) {
        for (const match of query.matchAll(/\$\{scope:([^}]+)\}/g)) {
          expect(pickerNames.has(match[1]), `${panel.id} → ${match[1]}`).toBe(true);
          expect(scopedBy.has(match[1]), `${panel.id} not in ${section.id}.scopedBy`).toBe(true);
        }
      }
    }
  });

  it("every scopedBy entry is USED by at least one panel in that section", () => {
    // Scoping is declared, never accidental — an unused declaration is a dead
    // control the user can operate to no effect.
    for (const section of manifest.sections) {
      for (const name of section.scopedBy ?? []) {
        const used = section.panels.some((panel: any) =>
          queriesOf(panel).some((q) => q.includes(`\${scope:${name}}`)),
        );
        expect(used, `${section.id}.scopedBy: ${name}`).toBe(true);
      }
    }
  });

  it("every panel CARRIES every scope token its section declares, or declares fleetWide", () => {
    // The rule the two rules above do not cover: they check the tokens that ARE
    // written, never the one that is missing. A picker the user can operate must
    // move every panel beside it — a panel that stays fleet-wide while its
    // neighbours react reads as a broken page, and shipped exactly that way.
    for (const section of manifest.sections) {
      for (const panel of section.panels) {
        const declared = new Set<string>(panel.fleetWide ?? []);
        for (const name of section.scopedBy ?? []) {
          const queries = queriesOf(panel);
          const carriedBy = queries.filter((q) => q.includes(`\${scope:${name}}`)).length;
          if (carriedBy === queries.length) {
            // An opt-out on a panel that scopes anyway is a stale marker.
            expect(declared.has(name), `${panel.id} marks ${name} fleetWide yet carries it`).toBe(
              false,
            );
            continue;
          }
          // Half-scoping is the worse bug: one variant reacts, the other lies.
          expect(carriedBy, `${panel.id} carries ${name} on only some queries`).toBe(0);
          expect(
            declared.has(name),
            `${panel.id} omits \${scope:${name}} declared by ${section.id}.scopedBy — ` +
              `add the token, or declare fleetWide: ["${name}"] with a reason`,
          ).toBe(true);
        }
        for (const name of declared) {
          expect(
            (section.scopedBy ?? []).includes(name),
            `${panel.id}.fleetWide names ${name}, which ${section.id} does not declare`,
          ).toBe(true);
        }
      }
    }
  });

  it("a section scoping by a chained picker also scopes by every picker above it", () => {
    // The completeness rule the coverage rule above cannot reach: every rule keyed
    // off `scopedBy` is silent about the picker a section never listed, so omitting
    // one renders no control and silently answers a narrow question with fleet-wide
    // data — strictly worse than a visibly broken picker.
    //
    // Scoping narrowly is a legitimate editorial choice (an Overview stays fleet-
    // wide on purpose), so breadth alone is not the defect. Offering a CHILD while
    // withholding its PARENT is: the page invites the user to narrow to one pod
    // while quietly pooling every cluster's identically-named pods. That is exactly
    // how Workloads shipped fleet-wide under a chosen cluster.
    const parentsOf = (name: string): string[] => {
      const def: any = manifest.scopePickers.find((p: any) => p.name === name);
      return (def?.chainedOn ?? []).map((c: any) => c.picker);
    };
    for (const section of manifest.sections) {
      const scopedBy: string[] = section.scopedBy ?? [];
      for (const name of scopedBy) {
        for (const parent of parentsOf(name)) {
          expect(
            scopedBy.includes(parent),
            `${section.id}.scopedBy offers "${name}" but not its parent "${parent}" — ` +
              `its panels pool every ${parent} while the picker implies one`,
          ).toBe(true);
        }
      }
    }
  });

  it("cardinality: every by(...) reaching the output is topk(N ≤ 20) or allowlist-only", () => {
    // Curated pages render on any fleet size — an unbounded per-node fan-out is a
    // page that dies on the org that needs it most.
    for (const panel of panels) {
      for (const query of queriesOf(panel)) {
        for (const match of query.matchAll(/\bby\s*\(([^)]*)\)/g)) {
          const labels = match[1]
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean);
          if (labels.every((l) => ENUMERABLE_LABELS.has(l))) continue;
          // A fully re-aggregated inner by — count(count by (x)(…)) — is one series.
          if (/count\s*\(\s*count\s+by/.test(query)) continue;
          const topk = query.match(/topk\((\d+),/);
          expect(topk, `${panel.id}: ${match[0]}`).not.toBeNull();
          expect(Number(topk![1]), panel.id).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it("every probe group authors fieldOverrides (probe groups skip concept probing)", () => {
    for (const group of manifest.groups) {
      if (!group.probe) continue;
      expect(group.fieldOverrides, group.id).toBeDefined();
    }
  });

  it("every labelKey / capabilityKey / setupHintKey / titleKey exists in en-US.json", () => {
    for (const group of manifest.groups) {
      for (const key of [group.labelKey, group.capabilityKey, group.setupHintKey]) {
        expect(i18nHas(key), key).toBe(true);
      }
    }
    for (const section of manifest.sections)
      expect(i18nHas(section.titleKey), section.titleKey).toBe(true);
    for (const panel of panels) {
      expect(i18nHas(panel.titleKey), panel.titleKey).toBe(true);
      if (panel.subtitleKey) expect(i18nHas(panel.subtitleKey), panel.subtitleKey).toBe(true);
    }
    expect(i18nHas(manifest.titleKey), manifest.titleKey).toBe(true);
  });

  it("every group declares a NON-EMPTY capabilityKey (finding 8a)", () => {
    for (const group of manifest.groups) {
      expect(group.capabilityKey, group.id).toBeTruthy();
    }
  });

  it("NO pack declares a scope-picker labelKey — labels come from the group's display (§8.4)", () => {
    // The inverse guard for the §8.4 removal: an author re-adding one has to
    // justify it against this rule, not slip it in.
    for (const picker of manifest.scopePickers) {
      expect(picker.labelKey, picker.name).toBeUndefined();
    }
  });

  it("group labels are CAPABILITY-FIRST — no label copy STARTS with a bare collector token", () => {
    for (const group of manifest.groups) {
      // Resolve the actual copy, not the key, so the rule reads the sentence —
      // and require it to resolve, or a missing key would vacuously pass.
      let node: any = enLocale;
      for (const segment of group.labelKey.split(".")) node = node?.[segment];
      expect(typeof node, `${group.id}: ${group.labelKey} resolves to no copy`).toBe("string");
      const text = String(node).toLowerCase().trim();
      for (const token of COLLECTOR_TOKENS) {
        expect(text.startsWith(token), `${group.id}: "${text}"`).toBe(false);
      }
    }
  });

  it("picker names and section ids equal the frozen v1 golden list", () => {
    // They surface as ?var-<name>= deep links and tab ids — renaming one breaks
    // users' saved URLs, so it must be a deliberate edit here too.
    const golden = GOLDEN_NAMES[packId];
    expect(golden, `no golden list registered for ${packId}`).toBeDefined();
    expect(manifest.scopePickers.map((p: any) => p.name)).toEqual(golden.pickers);
    expect(manifest.sections.map((s: any) => s.id)).toEqual(golden.sections);
  });

  it("(a) topk/title, table half: an N in the title AND an instant-vector query", () => {
    for (const panel of panels.filter((p) => p.type === "table")) {
      for (const query of queriesOf(panel)) {
        const topk = query.match(/topk\((\d+),/);
        if (!topk) continue;
        // The title must disclose the same N — and must resolve, or a missing
        // key would pass this rule by asserting against "".
        let node: any = enLocale;
        for (const segment of panel.titleKey.split(".")) node = node?.[segment];
        expect(typeof node, `${panel.id}: ${panel.titleKey} resolves to no copy`).toBe("string");
        expect(String(node), panel.titleKey).toContain(topk[1]);
      }
    }
  });

  // A range topk is a per-step selector: measured, topk(20) over 3h returned 450
  // rows, one per series seen ANYWHERE in the window, which is what made the
  // table contradict the instant tiles above it. The window is pinned by running
  // the panel as an instant query, never by a `[Ns:]` subquery — that spelling
  // mis-types an EMPTY result as scalar and 500s the panel on a healthy cluster.
  it("(a2) every topk table is an INSTANT query and carries no subquery", () => {
    for (const panel of panels.filter((p) => p.type === "table")) {
      for (const variant of panel.variants) {
        for (const { query } of variant.queries) {
          if (!/topk\(\d+,/.test(query)) continue;
          expect(query, `${panel.id} must not use a [Ns:] subquery`).not.toMatch(/\[\d+[smh]:\]/);
          expect(variant.queryMode, `${panel.id} must declare queryMode "instant"`).toBe("instant");
        }
      }
    }
  });

  it("(a) topk/title, non-table half: a topk query must NOT interpolate an N into its title", () => {
    for (const panel of panels.filter((p) => p.type !== "table")) {
      const hasTopk = queriesOf(panel).some((q) => /topk\(\d+,/.test(q));
      if (!hasTopk) continue;
      let node: any = enLocale;
      for (const segment of panel.titleKey.split(".")) node = node?.[segment];
      expect(String(node ?? ""), panel.titleKey).not.toMatch(/\btop\s*\d+\b/i);
    }
  });

  it("(b) every non-probe CHART panel declares the openInMetricsExplorer byUrl drilldown", () => {
    // On a viewOnly page the description icon is hidden, so this is the ONLY path
    // from a number to the query behind it (§6.6).
    for (const panel of panels) {
      if (isProbeGroup(manifest, panel.groupId)) continue;
      expect(Array.isArray(panel.drilldown), panel.id).toBe(true);
      const explorer = (panel.drilldown ?? []).find((d: any) => d.type === "byUrl");
      expect(explorer, `${panel.id} has no byUrl drilldown`).toBeDefined();
      expect(explorer.data.url, panel.id).toContain("query_type=promql");
      expect(explorer.data.url, panel.id).toContain("query=");
    }
  });

  it("(b') the drilldown query param is BASE64, decoding back to the panel's own PromQL", () => {
    // `toContain("query=")` passes on a raw-string URL, which the metrics explorer
    // then feeds to b64DecodeUnicodeSafe and renders as garbage. METRICS_PARAMS
    // encodes this key with b64EncodeUnicode (metricsParamRegistry.ts:88-98), so
    // the pin decodes it — the one assertion a hand-built URL cannot fake.
    for (const panel of panels) {
      if (isProbeGroup(manifest, panel.groupId)) continue;
      const explorer = (panel.drilldown ?? []).find((d: any) => d.type === "byUrl");
      const encoded = new URL(explorer.data.url, "http://localhost").searchParams.get("query");
      expect(encoded, `${panel.id} has no query param`).toBeTruthy();
      const decoded = b64DecodeUnicodeSafe(encoded!);
      expect(decoded, `${panel.id} query is not base64`).toBeTruthy();
      // The decoded text is the panel's own query, tokens and all — not a stray
      // string that merely happens to survive a base64 round trip.
      expect(queriesOf(panel), panel.id).toContain(decoded);
    }
  });

  it("(e) no kube-state status/condition selector without a VALUE TEST", () => {
    // `status="true"` selects series; the assertion lives in the series VALUE.
    // This is the bug class that made k8s_nd_not_ready return 20 healthy nodes.
    for (const panel of panels) {
      for (const query of queriesOf(panel)) {
        if (!/\{[^}]*\b(status|condition)\s*=/.test(query)) continue;
        expect(query, panel.id).toMatch(/(==|>|<|>=|<=)\s*-?\d/);
      }
    }
  });

  it("(g) every valuesFrom.stream is required by some variant in that groupId", () => {
    // A picker cannot source from a stream the pack never proves live.
    for (const picker of manifest.scopePickers) {
      const groupPanels = panels.filter((p) => p.groupId === picker.valuesFrom.groupId);
      const required = new Set(
        groupPanels.flatMap((p) => p.variants.flatMap((v: any) => v.requiresStreams ?? [])),
      );
      expect(
        required.has(picker.valuesFrom.stream),
        `${picker.name} → ${picker.valuesFrom.stream}`,
      ).toBe(true);
    }
  });
});

// A `custom_chart` panel's author JS is the one part of a pack that NOTHING else
// checks. The curated render path passes `type` straight through (resolve.ts:1031)
// with no allowlist; panelValidation.ts and CUSTOM_QUERY_CHART_TYPES are panel-
// editor only and never run here; and validateUserCode fires at RENDER time, inside
// a sandboxed iframe, where its verdict reaches a console rather than CI. So an
// unsafe or misshapen string ships green and fails silently in the browser. These
// four rules move that verdict into the suite.
describe.each(packs)("author JS (custom_chart) — %s pack", (_packId, manifest) => {
  const chartPanels = panelsOf(manifest).filter((p) => p.type === "custom_chart");

  const parse = (code: string): acorn.Node =>
    acorn.parse(code, { ecmaVersion: 2020 }) as acorn.Node;

  /** Every `data[<literal>]` index the code reads. */
  const dataIndices = (code: string): number[] => {
    const out: number[] = [];
    walk.simple(parse(code), {
      MemberExpression(node: any) {
        if (
          node.computed &&
          node.object?.type === "Identifier" &&
          node.object.name === "data" &&
          node.property?.type === "Literal" &&
          typeof node.property.value === "number"
        ) {
          out.push(node.property.value);
        }
      },
    });
    return out;
  };

  it("every custom_chart panel declares a non-empty customChartContent", () => {
    // convertPanelData.ts:226 reads `panelSchema.customChartContent` — the panel
    // object, never `config`. A missing or misplaced string renders an empty chart
    // with no error anywhere.
    for (const panel of chartPanels) {
      expect(typeof panel.customChartContent, `${panel.id} customChartContent`).toBe("string");
      expect(String(panel.customChartContent).trim().length, panel.id).toBeGreaterThan(0);
    }
  });

  it("every customChartContent passes validateUserCode", () => {
    // The same function convertCustomChartData.ts:55 runs before execution, so a
    // hit here is a panel that would refuse to render at all.
    for (const panel of chartPanels) {
      expect(validateUserCode(String(panel.customChartContent)), panel.id).toBeNull();
    }
  });

  it("every customChartContent assigns a BARE `option`", () => {
    // The sandbox runs the code as `(function(data, echarts) { <userCode> })` and
    // then reads a FREE `option` identifier from the enclosing scope
    // (convertCustomChartData.ts:151). `const option = ...` binds inside the IIFE,
    // so the postMessage throws ReferenceError and the panel paints nothing.
    for (const panel of chartPanels) {
      const ast = parse(String(panel.customChartContent));
      let declared = false;
      let assigned = false;
      walk.simple(ast, {
        VariableDeclarator(node: any) {
          if (node.id?.type === "Identifier" && node.id.name === "option") declared = true;
        },
        AssignmentExpression(node: any) {
          if (node.left?.type === "Identifier" && node.left.name === "option") assigned = true;
        },
      });
      expect(assigned, `${panel.id} never assigns \`option\``).toBe(true);
      expect(declared, `${panel.id} DECLARES \`option\`, which the sandbox cannot read`).toBe(
        false,
      );
    }
  });

  it("no customChartContent reads a data index past its own query count", () => {
    // data[i] is query i's result (usePanelPromQLExecutor.ts:101,242). Reading past
    // the end yields undefined and the next property access throws inside the
    // sandbox — surfacing as a bare execution error that names no cause.
    for (const panel of chartPanels) {
      const limit = queriesOf(panel).length;
      for (const index of dataIndices(String(panel.customChartContent))) {
        expect(index, `${panel.id} reads data[${index}] with only ${limit} queries`).toBeLessThan(
          limit,
        );
      }
    }
  });
});

describe("registry", () => {
  it("keys every pack by its WorkloadId and carries the in-scope v1 packs", () => {
    expect(Object.keys(curatedPacks).sort()).toEqual(["hosts", "kubernetes"]);
    for (const [id, manifest] of packs) expect(manifest.id).toBe(id);
  });

  it("every registered pack sets contentVersion and a default relative period", () => {
    for (const [, manifest] of packs) {
      expect(typeof manifest.contentVersion).toBe("number");
      expect(manifest.defaultRelativePeriod).toBeTruthy();
    }
  });
});

// A ratio scoped on ONE side is the addendum's "lying gauge": measured live,
// production CPU used-over-fleet-allocatable reads 3.76% where the truth is
// 24.15%. The query succeeds and returns exactly one series, so nothing at
// runtime can catch it — only this rule can.
describe("lint (h): a division carries its scope token on BOTH sides", () => {
  for (const [packId, manifest] of Object.entries(curatedPacks)) {
    it(`${packId}: no query divides a scoped numerator by an unscoped denominator`, () => {
      for (const section of manifest.sections) {
        for (const name of section.scopedBy ?? []) {
          const token = `\${scope:${name}}`;
          for (const panel of section.panels) {
            if ((panel.fleetWide ?? []).includes(name)) continue;
            for (const variant of panel.variants) {
              for (const { query } of variant.queries) {
                if (!query.includes("/") || !query.includes(token)) continue;
                const sides = query.split("/");
                for (const [index, side] of sides.entries()) {
                  // A side with no metric selector (a bare literal like `* 100`)
                  // has nothing to scope, so it is not a violation.
                  if (!/[a-z_]+\{|[a-z_]{4,}\s*\)/i.test(side)) continue;
                  expect(
                    side.includes(token),
                    `${panel.id} side ${index} of "${query}" lacks ${token}`,
                  ).toBe(true);
                }
              }
            }
          }
        }
      }
    });
  }
});
