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

import { describe, it, expect } from "vitest";
import type { FieldAlias } from "@/services/service_streams";
import { lintManifest } from "../resolve";
import { curatedPacks } from "./index";
import defaultSemanticGroups from "./__fixtures__/semanticGroups.default.json";
import enLocale from "@/locales/languages/en-US.json";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import { raw } from "@/types/i18n";

const groups = defaultSemanticGroups as FieldAlias[];
const REAL_GROUP_IDS = new Set(groups.map((g) => g.id));

const UNIT_VALUES = new Set(
  getUnitOptions(((k: string) => raw(k)) as any)
    .map((o) => o.value)
    .filter((v): v is string => v != null),
);

/** Labels the cardinality rule accepts as enumerable without a topk bound. */
const ENUMERABLE_LABELS = new Set(["phase", "condition", "direction", "status", "action"]);

/** Collector tokens a capability-first label must not START with (finding 21). */
const COLLECTOR_TOKENS = ["kubeletstats", "kube-state", "cluster receiver", "kubelet"];

/** The v1 public identifiers — renames are deliberate, release-noted decisions. */
const GOLDEN_NAMES: Record<string, { pickers: string[]; sections: string[] }> = {
  kubernetes: {
    pickers: ["cluster", "namespace", "pod"],
    sections: ["overview", "nodes", "workloads"],
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
    for (const text of [...queriesOf(panel), ...panel.variants.flatMap((v: any) => v.queries.map((q: any) => q.legend ?? ""))]) {
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
    for (const section of manifest.sections) expect(i18nHas(section.titleKey), section.titleKey).toBe(true);
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
      const copy = String((enLocale as any) && i18nHas(group.labelKey) ? group.labelKey : "");
      // Resolve the actual copy, not the key, so the rule reads the sentence.
      let node: any = enLocale;
      for (const segment of group.labelKey.split(".")) node = node?.[segment];
      const text = String(node ?? copy).toLowerCase().trim();
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
        // The title must disclose the same N.
        let node: any = enLocale;
        for (const segment of panel.titleKey.split(".")) node = node?.[segment];
        expect(String(node ?? ""), panel.titleKey).toContain(topk[1]);
        // …and the query must actually honour it. A range topk is a per-step
        // selector: measured, topk(20) over 3h returned 450 rows.
        expect(query, panel.id).toMatch(/last_over_time\(.*\[\d+[smh]:\]\)/s);
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
      expect(required.has(picker.valuesFrom.stream), `${picker.name} → ${picker.valuesFrom.stream}`).toBe(
        true,
      );
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
