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

// Summary section — PACK-SPECIFIC invariants (tranche 1C). Generic rules live in
// lint.spec.ts. Every describe names the live measurement or the platform fact
// that motivated it, so a future reader can re-verify the claim rather than trust
// the assertion.
//
// This is the pack's FIRST custom_chart panel, so several assertions here are the
// only gate on a code path the panel editor's own validation never sees: the
// curated render path passes `type` straight through (resolve.ts:1031) with no
// allowlist, and panelValidation.ts / CUSTOM_QUERY_CHART_TYPES are panel-editor
// only. What is not pinned here ships unchecked.

import * as acorn from "acorn";
import DOMPurify from "dompurify";
import * as walk from "acorn-walk";
import { describe, it, expect } from "vitest";
import { kubernetesPage, FLEET_DRILLDOWN_EVENT, FLEET_DRILLDOWN_TAB } from "./kubernetes.page";
import { validateUserCode } from "@/utils/dashboard/convertCustomChartData";
import { b64DecodeUnicodeSafe } from "@/utils/zincutils";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import { raw } from "@/types/i18n";
import enLocale from "@/locales/languages/en-US.json";

const SECTION_ID = "summary";

/** The one panel this section exists to hold. */
const PANEL_ID = "k8s_sm_fleet_quadrant";

const section = () => {
  const found = kubernetesPage.sections.find((s: any) => s.id === SECTION_ID);
  if (!found) throw new Error(`section ${SECTION_ID} is not in the kubernetes pack`);
  return found;
};

const panels = () => section().panels;

const panel = (id: string) => {
  const found = panels().find((p: any) => p.id === id);
  if (!found) throw new Error(`panel ${id} is not in the ${SECTION_ID} section`);
  return found;
};

const queriesOf = (id: string): string[] =>
  panel(id).variants.flatMap((v: any) => v.queries.map((q: any) => q.query as string));

const copy = (key: string): string => {
  let node: any = enLocale;
  for (const segment of key.split(".")) node = node?.[segment];
  if (typeof node !== "string") throw new Error(`${key} resolves to no en-US copy`);
  return node;
};

/** The author JS, or a named throw — every assertion below reads through this. */
const chartCode = (id: string): string => {
  const code = (panel(id) as any).customChartContent;
  if (typeof code !== "string" || code.trim() === "") {
    throw new Error(`${id} declares no customChartContent — a custom_chart with no author JS`);
  }
  return code;
};

const parse = (code: string): acorn.Node => acorn.parse(code, { ecmaVersion: 2020 }) as acorn.Node;

const isDataIndex = (node: any): boolean =>
  node.computed &&
  node.object?.type === "Identifier" &&
  node.object.name === "data" &&
  node.property?.type === "Literal" &&
  typeof node.property.value === "number";

/** Only literal `data[<number>]` reads — the upper-bound check is sound for these alone. */
const literalDataIndices = (code: string): number[] => {
  const out: number[] = [];
  walk.simple(parse(code), {
    MemberExpression(node: any) {
      if (isDataIndex(node)) out.push(node.property.value);
    },
  });
  return out;
};

/** Detects `data` reads across all four idioms, so correctness is not judged by spelling. */
const dataConsumption = (code: string) => {
  const literalIndices = new Set<number>();
  let iterates = false;
  let touchesData = false;
  walk.simple(parse(code), {
    Identifier(node: any) {
      if (node.name === "data") touchesData = true;
    },
    MemberExpression(node: any) {
      if (isDataIndex(node)) literalIndices.add(node.property.value);
      // data.forEach/map/…, and data[i] where i is not a literal — both walk the whole array.
      if (node.object?.type === "Identifier" && node.object.name === "data" && !isDataIndex(node)) {
        if (node.property?.type !== "Identifier" || node.property.name !== "length") {
          iterates = true;
        }
      }
    },
    VariableDeclarator(node: any) {
      // const [cpu, mem, ...] = data
      if (node.id?.type === "ArrayPattern" && node.init?.type === "Identifier") {
        if (node.init.name === "data") iterates = true;
      }
    },
    ForOfStatement(node: any) {
      if (node.right?.type === "Identifier" && node.right.name === "data") iterates = true;
    },
  });
  return { literalIndices, iterates, touchesData };
};

/** Every name a binding pattern introduces, so destructured params are not read as free. */
const boundNames = (pattern: any): string[] => {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((p: any) => boundNames(p.value ?? p.argument));
    case "ArrayPattern":
      return pattern.elements.flatMap((e: any) => boundNames(e));
    case "AssignmentPattern":
      return boundNames(pattern.left);
    case "RestElement":
      return boundNames(pattern.argument);
    default:
      return [];
  }
};

/** True only where the identifier is READ as a value — never a property key or a `.member`. */
const isValuePosition = (node: any, ancestors: any[]): boolean => {
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return true;
  if (parent.type === "Property" && parent.key === node && !parent.computed) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === "MethodDefinition" && parent.key === node) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement") return false;
  if (parent.type === "ContinueStatement") return false;
  return true;
};

/** True when the node sits under the `o2_events` property, whose handlers run in the parent. */
const inO2Events = (ancestors: any[]): boolean =>
  ancestors.some(
    (node: any) => node.type === "Property" && (node.key?.name ?? node.key?.value) === "o2_events",
  );

/** Standard globals a sandboxed iframe genuinely has, plus the free `option` it must assign. */
const SANDBOX_GLOBALS = new Set([
  "option",
  "Math",
  "Number",
  "String",
  "Boolean",
  "Object",
  "Array",
  "JSON",
  "Map",
  "Set",
  "Date",
  "RegExp",
  "Error",
  "isNaN",
  "isFinite",
  "parseFloat",
  "parseInt",
  // An ECMAScript global like parseInt above, not a DOM one, so every realm has it.
  "encodeURIComponent",
  "decodeURIComponent",
  "undefined",
  "NaN",
  "Infinity",
]);

/**
 * DOM globals, legal ONLY inside `o2_events`. The sandbox iframe never CALLS
 * those handlers — it only `obj.toString()`s them across the postMessage
 * boundary (convertCustomChartData.ts:110-118) — and CustomChartRenderer
 * rebuilds them with `new Function` in the parent window, where the DOM exists.
 * Anywhere else in the body this list would be a render-time throw.
 */
const PARENT_ONLY_GLOBALS = new Set(["CustomEvent"]);

const UNIT_VALUES = new Set(
  getUnitOptions(((k: string) => raw(k)) as any)
    .map((o) => o.value)
    .filter((v): v is string => v != null),
);

/** kube-state families the five queries are allowed to anchor on. */
const KUBE_STATE_METRICS = [
  "kube_node_status_allocatable",
  "kube_pod_container_resource_requests",
  "kube_pod_status_phase",
  "kube_pod_container_status_restarts_total",
];

describe("summary — shape", () => {
  it("is a section of the kubernetes pack", () => {
    expect(kubernetesPage.sections.map((s: any) => s.id)).toContain(SECTION_ID);
  });

  it("IS the landing tab", () => {
    // CuratedPageView.vue:151-164 selects tabs[0], so sections[0] is what every
    // user sees first: the fleet roll-up leads because it answers "which cluster
    // should I look at" — the question that precedes drilling into any one of them.
    const ids = kubernetesPage.sections.map((s: any) => s.id);
    expect(ids[0], `${SECTION_ID} must be the landing tab`).toBe(SECTION_ID);
  });

  it("holds exactly one panel", () => {
    // The fault data (pending pods, restarts, failed pods) is FOLDED INTO the
    // quadrant rather than split off into a neighbour: a second panel would make
    // the reader join two views by cluster name by eye, which is the join the
    // bubble chart exists to have already done.
    expect(panels().map((p: any) => p.id)).toEqual([PANEL_ID]);
  });

  it("the panel is a custom_chart", () => {
    // A quadrant with a third (size) and fourth (colour) encoding has no builtin
    // equivalent — scatter in the v8 builder carries no per-point size or colour
    // channel driven by a separate query.
    expect(panel(PANEL_ID).type).toBe("custom_chart");
  });

  it("declares exactly one variant", () => {
    // `variants: []` passes every for-loop in this file vacuously and then crashes
    // at resolve.ts:964 where selectedVariant! is dereferenced. There is no drift
    // alternative here — kube-state is the only collector that publishes
    // allocatable and requests together — so one variant is the correct shape.
    expect(panel(PANEL_ID).variants).toHaveLength(1);
  });

  it("reads the kube-state group", () => {
    // Every metric below is kube-state. A kubeletstats group would resolve the
    // ${f:} concepts to k8s_namespace_name/k8s_pod_name, which these streams do
    // not have.
    expect(panel(PANEL_ID).groupId).toBe("kube-state");
  });

  // COUPLED EDIT, not testable from here: lint.spec.ts keeps GOLDEN_NAMES module-
  // private and asserts the pack's section ids equal it. Adding this section
  // REQUIRES adding "summary" there, plus the frozen tab lists in resolve.spec.ts
  // and the section-id list and panel count in kubernetes.page.spec.ts.
});

describe("summary — the panel is fleet-wide by construction", () => {
  // The whole point of the quadrant is that ten clusters are ONE scatter: the
  // over-provisioned corner (o2-nava 28.8%/18.8%, prosegur 28.0%/31.4%) is only
  // legible NEXT TO the tight corner (introspection 83.5%/79.8%). Filter to one
  // cluster and the chart degenerates to a single dot, which answers nothing.
  it("carries no ${scope:} token on any query", () => {
    for (const query of queriesOf(PANEL_ID)) {
      expect(query, `${PANEL_ID} must not narrow the fleet`).not.toContain("${scope:");
    }
  });

  it("declares no scopedBy and no fleetWide — the only shape lint lets ship", () => {
    // The fleetWide escape hatch is unreachable here: a section that declared
    // scopedBy: ["cluster"] beside a panel that never carries ${scope:cluster}
    // trips lint's scoped-by-unused rule (resolve.ts:795-803), which lint.spec.ts:110
    // requires to be empty. So a no-scopedBy section is not the preferred shape, it
    // is the ONLY one, and fleetWide has nothing left to opt out of.
    expect((section() as any).scopedBy ?? [], `${SECTION_ID} must declare no scopedBy`).toEqual([]);
    expect(
      (panel(PANEL_ID) as any).fleetWide ?? [],
      `${PANEL_ID} has no picker to opt out of`,
    ).toEqual([]);
  });

  it("groups by cluster, so every query returns one series per cluster", () => {
    // The chart's row identity IS the cluster. A query that forgot to group by
    // cluster returns one fleet total and the author JS silently plots a single
    // bubble. The pack resolves the cluster field through the semantic token
    // ${f:k8s-cluster} (kubernetes.page.ts:21) rather than a literal field name, so
    // requiring the literal would force hardcoding `k8s_cluster` and return an empty
    // vector on any org whose cluster field is spelled differently. `without (...)`
    // is accepted because it PRESERVES the cluster label rather than dropping it —
    // but only when it does not name cluster among the labels it strips.
    const CLUSTER_LABEL = /k8s_cluster|\$\{f:k8s-cluster\}/;
    for (const query of queriesOf(PANEL_ID)) {
      const byClauses = [...query.matchAll(/\bby\s*\(([^)]*)\)/g)].map((m) => m[1]);
      const withoutClauses = [...query.matchAll(/\bwithout\s*\(([^)]*)\)/g)].map((m) => m[1]);
      const keepsCluster =
        byClauses.some((labels) => CLUSTER_LABEL.test(labels)) ||
        (withoutClauses.length > 0 &&
          withoutClauses.every((labels) => !CLUSTER_LABEL.test(labels)));
      expect(
        keepsCluster,
        `${PANEL_ID}: a query that does not preserve the cluster label: ${query}`,
      ).toBe(true);
    }
  });
});

describe("summary — the panel is an instant snapshot, never a range reduction", () => {
  // Every number on this chart is a ratio across two SEPARATE queries: x is
  // requests/allocatable, y the same for memory. Under a range window the author JS
  // reduces each series with lastValue(), and the two sides' final samples are not
  // required to share a timestamp — measured on an autoscaling cluster, numerator and
  // denominator landed 300s apart and the panel reported 11.6% where the true
  // instantaneous ratio was 41.9%. Reloads of one URL swung 30.7% to 99.6% and flipped
  // the health colour, so two readers of the same page reached opposite conclusions.
  it("pins every query to one evaluation with queryMode instant", () => {
    for (const variant of panel(PANEL_ID).variants) {
      expect(
        (variant as any).queryMode,
        `${PANEL_ID}: a range window lets the numerator and denominator come from different instants`,
      ).toBe("instant");
    }
  });

  it("emits query_type instant on EVERY query, not just the first", () => {
    // resolve.ts stamps query_type per query and usePanelPromQLExecutor sends
    // start == end for "instant". One unstamped query silently reverts to a range and
    // reintroduces the mismatched-timestamp ratio it is paired into.
    const emitted = panel(PANEL_ID).variants.flatMap((v: any) =>
      v.queries.map(() => (v.queryMode ? { query_type: v.queryMode } : {})),
    );
    expect(emitted.length, `${PANEL_ID} must declare queries`).toBeGreaterThan(0);
    for (const config of emitted) {
      expect(config, `${PANEL_ID}: every query must carry query_type instant`).toEqual({
        query_type: "instant",
      });
    }
  });

  it("reduces BOTH response shapes, because an instant query returns a vector", () => {
    // start == end makes the backend answer resultType "vector", where each series
    // carries `value` rather than the matrix `values`. A lastValue() that reads only
    // `values` returns 0 for every series and the chart renders empty with no error.
    const js = chartCode(PANEL_ID);
    expect(js, "the author JS must read the matrix shape").toMatch(/\.values\b/);
    expect(js, "the author JS must read the instant vector shape").toMatch(/\.value\b/);
  });

  it("carries a title that promises an instant, matching the query mode", () => {
    // The panel says "(now)". A range window made that a lie in the direction that
    // matters most: over a wide picker a decommissioned cluster still has a last
    // value, so it plotted as live. An instant query at now drops it on PromQL
    // staleness, which is why widening the picker no longer resurrects dead clusters.
    expect(copy(panel(PANEL_ID).titleKey)).toMatch(/\(now\)/);
  });
});

describe("summary — the query set carries every encoding the chart claims", () => {
  // Five queries reach the author JS as data[0]..data[4]: resolve.ts:1037 emits one
  // v8 query per authored query and usePanelPromQLExecutor.ts:101,242 indexes the
  // results by queryIndex. Precedent: k8s_ut_commit_trend has 2, hd_load has 3.
  it("declares roughly the five designed queries", () => {
    // A RANGE, not a frozen 5: query 4 (node/deployment counts) may ship as one
    // label_replace'd query carrying a `kind` label or as two separate ones, and
    // that is the implementer's call. What must not happen is a panel that quietly
    // drops an encoding down to two or three queries.
    const count = queriesOf(PANEL_ID).length;
    expect(
      count,
      `${PANEL_ID} needs the capacity, commitment and fault queries`,
    ).toBeGreaterThanOrEqual(5);
    expect(
      count,
      `${PANEL_ID} declares more queries than the design describes`,
    ).toBeLessThanOrEqual(6);
  });

  it("puts the always-populated capacity query at index 0, never a fault query", () => {
    // convertPanelData.ts:231 gates the WHOLE custom_chart on `data[0].result.length
    // > 0` — query 0 alone. If query 0 comes back empty the panel renders blank and
    // PanelSchemaRenderer.vue:1452 returns "" for the custom_chart noData case, so
    // there is not even an error to see. Measured: a phase-filtered fault query
    // returns 2 series on a healthy fleet, so a fault query at index 0 blanks the
    // panel exactly when nothing is wrong. kube_node_status_allocatable is the one
    // family that reports for every node regardless of workload health.
    const first = queriesOf(PANEL_ID)[0];
    expect(first, `${PANEL_ID} declares no queries`).toBeTruthy();
    expect(first, "query 0 must be the allocatable-capacity query").toContain(
      "kube_node_status_allocatable",
    );
    expect(first, "query 0 must not be the restarts query").not.toContain(
      "kube_pod_container_status_restarts_total",
    );
    expect(first, "query 0 must not be phase-filtered").not.toMatch(
      /phase\s*=~?\s*"[^"]*(Pending|Failed)/,
    );
  });

  it("every query anchors on a real kube-state metric", () => {
    for (const query of queriesOf(PANEL_ID)) {
      const hit = KUBE_STATE_METRICS.some((metric) => query.includes(metric));
      expect(hit, `no known kube-state family in: ${query}`).toBe(true);
    }
  });

  it("reads allocatable capacity — the x/y denominator and the bubble size", () => {
    // Bubble size is allocatable CPU cores, so the same query feeds two encodings.
    // Measured: 931.45 cores fleet-wide, with common-dev alone at 564 — a chart
    // that plotted percentages ALONE would rank a 4-core cluster beside it.
    const all = queriesOf(PANEL_ID).join("\n");
    expect(all).toContain("kube_node_status_allocatable");
    expect(all, "allocatable must be read per resource, not as one blended total").toMatch(
      /kube_node_status_allocatable\{[^}]*resource=~?"/,
    );
  });

  it("reads container resource requests — the x/y numerator", () => {
    const all = queriesOf(PANEL_ID).join("\n");
    expect(all).toContain("kube_pod_container_resource_requests");
  });

  it("asks for cpu and memory on both sides of the commitment ratio", () => {
    // x is CPU committed %, y is memory committed %. A requests query that only
    // selected cpu would leave the y axis to be computed from nothing, and the
    // chart would plot every cluster on a line.
    const requests = queriesOf(PANEL_ID).filter((q) =>
      q.includes("kube_pod_container_resource_requests"),
    );
    const allocatable = queriesOf(PANEL_ID).filter((q) =>
      q.includes("kube_node_status_allocatable"),
    );
    for (const [label, set] of [
      ["requests", requests],
      ["allocatable", allocatable],
    ] as const) {
      const text = set.join("\n");
      expect(text, `${label} must select cpu`).toContain("cpu");
      expect(text, `${label} must select memory`).toContain("memory");
    }
  });

  it("keeps the ratio unsplit — both sides are grouped by the same key pair", () => {
    // The commitment percentage is computed in the AUTHOR JS from two separate
    // queries, not by PromQL division, so the join happens on the label set the
    // two queries return. Grouping them differently makes the join silently miss:
    // a cluster present in one and absent in the other simply vanishes from the
    // scatter with no error anywhere.
    // EVERY by() clause of EVERY matching query is compared, not just the first of
    // each: on `sum by (a,b) (x) / sum by (a) (y)` a single non-global match reads
    // only [a,b] and the mismatched second clause — the one that breaks the join —
    // goes unseen.
    const groupings = (metric: string): string[][] => {
      const queries = queriesOf(PANEL_ID).filter((q) => q.includes(metric));
      expect(queries.length, `no query reads ${metric}`).toBeGreaterThan(0);
      const out: string[][] = [];
      for (const query of queries) {
        const clauses = [...query.matchAll(/\bby\s*\(([^)]*)\)/g)];
        expect(clauses.length, `${metric} query does not aggregate: ${query}`).toBeGreaterThan(0);
        for (const clause of clauses) {
          out.push(
            clause[1]
              .split(",")
              .map((l) => l.trim())
              .sort(),
          );
        }
      }
      return out;
    };
    const all = [
      ...groupings("kube_node_status_allocatable"),
      ...groupings("kube_pod_container_resource_requests"),
    ];
    const distinct = new Set(all.map((labels) => labels.join("|")));
    expect(
      [...distinct],
      "both sides of the ratio must aggregate on the SAME key pair in every clause",
    ).toHaveLength(1);
  });
});

describe("summary — the fault data is folded into THIS panel", () => {
  // The decision under test is the fold-in itself. Splitting faults into a second
  // panel is the obvious alternative and it is the one being rejected: a reader
  // would have to carry "production has 21 restarts/hr" across from one panel and
  // find production's dot in the other by eye. Colour-by-health does that join.
  //
  // Measured, and the reason the fault channel cannot be dropped: production sits
  // at a merely-warm 65.5%/60.0% — nowhere near the quadrant's hot corner — while
  // carrying 21.18 container restarts per hour. Position alone would paint it as
  // one of the healthier clusters on the chart.
  it("queries pod phase, covering both Pending and Failed", () => {
    const all = queriesOf(PANEL_ID).join("\n");
    expect(all, "the fault channel needs kube_pod_status_phase").toContain("kube_pod_status_phase");
    expect(all, "pending pods are a fault signal").toContain("Pending");
    expect(all, "failed pods are a fault signal").toContain("Failed");
  });

  it("queries container restarts as a RATE over a window, never a lifetime total", () => {
    // kube_pod_container_status_restarts_total is a counter: read raw it reports
    // every restart since each container started, so a long-lived healthy cluster
    // outranks a cluster crash-looping right now. increase(...[1h]) is the signal.
    const restarts = queriesOf(PANEL_ID).find((q) =>
      q.includes("kube_pod_container_status_restarts_total"),
    );
    expect(restarts, "no restarts query — the fault channel is incomplete").toBeTruthy();
    expect(restarts!, "a counter must be read through increase()/rate()").toMatch(
      /\b(increase|rate)\s*\(/,
    );
    expect(restarts!, "the counter window must be bounded").toMatch(/\[\d+[smhd]\]/);
  });

  it("counts Running pods too, so a fault count has a denominator", () => {
    // 16 pending on common-dev means something different against 1367 running than
    // against 20. The phase query must not filter down to the bad phases alone.
    const all = queriesOf(PANEL_ID).join("\n");
    expect(all, "the phase query must include Running").toContain("Running");
  });
});

describe("summary — requiresStreams completeness", () => {
  it("every metric a query reads is declared", () => {
    // A variant is satisfiable only when ALL its streams are present and live
    // (resolve.ts:405-414). With five queries the failure mode is worse than
    // elsewhere: an undeclared stream renders a chart missing one whole encoding
    // rather than an obviously empty panel.
    for (const variant of panel(PANEL_ID).variants) {
      const declared: string[] = variant.requiresStreams ?? [];
      const used = new Set(
        variant.queries
          .flatMap((q: any) => [...String(q.query).matchAll(/\bkube_\w+/g)])
          .map((m: any) => m[0]),
      );
      for (const metric of used) {
        expect(declared, `${PANEL_ID} reads ${metric} without declaring it`).toContain(metric);
      }
    }
  });

  it("element 0 of requiresStreams is the stream the panel anchors on", () => {
    // resolve.ts:432 assigns requiresStreams[0] to queryStream, which drives both
    // the drilldown target and the schema consulted for every ${f:} concept. The
    // convention is asserted in both sibling section specs, so it is pinned here
    // rather than left to a reader to infer.
    const first = panel(PANEL_ID).variants[0].requiresStreams?.[0];
    expect(first, `${PANEL_ID} has no schema stream`).toBeTruthy();
    const anchored = queriesOf(PANEL_ID).some((q) => q.includes(first!));
    expect(anchored, `${PANEL_ID}: requiresStreams[0] "${first}" is not queried`).toBe(true);
  });

  it("declares every one of the kube-state families the design names", () => {
    const declared = new Set<string>(panel(PANEL_ID).variants[0].requiresStreams ?? []);
    for (const metric of KUBE_STATE_METRICS) {
      expect(declared.has(metric), `${PANEL_ID} must declare ${metric}`).toBe(true);
    }
  });
});

describe("summary — the author JS is real, safe, and shaped for the sandbox", () => {
  it("declares a non-empty customChartContent as a TOP-LEVEL panel field", () => {
    // convertPanelData.ts:226 and convertCustomChartData.ts:52 both read
    // `panelSchema.customChartContent` — the panel object, never `config`. A JS
    // string parked under config renders an empty chart with no error at all.
    expect(typeof (panel(PANEL_ID) as any).customChartContent).toBe("string");
    expect(chartCode(PANEL_ID).trim().length).toBeGreaterThan(0);
    expect(
      (panel(PANEL_ID) as any).config?.customChartContent,
      "the JS must not be nested under config, where nothing reads it",
    ).toBeUndefined();
  });

  it("passes validateUserCode", () => {
    // convertCustomChartData.ts:207-326 runs this at RENDER time and rejects the
    // whole panel on a hit — so without this assertion an unsafe or unparseable
    // string ships green and fails only in the browser. It is not run by lint today.
    expect(validateUserCode(chartCode(PANEL_ID))).toBeNull();
  });

  it("parses as ES2020", () => {
    // The redundant-looking sibling of the rule above: validateUserCode swallows a
    // parse error into a translated STRING, so a syntax error and a forbidden call
    // are indistinguishable from its return value. This names which one it was.
    const code = chartCode(PANEL_ID);
    expect(() => parse(code)).not.toThrow();
  });

  it("assigns a BARE `option`, never a declared one", () => {
    // The sandbox runs the code as `(function(data, echarts) { <userCode> })` and
    // then reads a FREE `option` identifier from the enclosing scope
    // (convertCustomChartData.ts:151). `const option = ...` binds inside the IIFE,
    // so the postMessage line throws ReferenceError and the panel shows nothing.
    const code = chartCode(PANEL_ID);
    const ast = parse(code);
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
    expect(assigned, "the author JS never assigns `option`").toBe(true);
    expect(
      declared,
      "`option` must not be declared — the sandbox reads it as a free variable",
    ).toBe(false);
  });

  it("never reads a data index past the declared query count", () => {
    // data[i] is query i's result (usePanelPromQLExecutor.ts:101,242). Indexing
    // past the end yields `undefined`, and the very next property read throws
    // inside the sandbox — surfacing as a bare execution error with no hint that
    // a query was renamed or removed out from under the JS. Sound for literal
    // indices only, which is why it does not also require them.
    const limit = queriesOf(PANEL_ID).length;
    for (const index of literalDataIndices(chartCode(PANEL_ID))) {
      expect(index, `${PANEL_ID} reads data[${index}] with only ${limit} queries`).toBeLessThan(
        limit,
      );
    }
  });

  it("consumes every declared query, by index or by iterating `data`", () => {
    // An unread query still costs a PromQL round trip on every refresh and still
    // gates the panel's satisfiability. Deliberately idiom-agnostic: literal
    // data[0..n], `const [cpu, mem] = data`, `data.forEach`, and `for (i…) data[i]`
    // are all correct implementations, so requiring the literal spelling would fail
    // three of the four for style rather than for behaviour.
    const code = chartCode(PANEL_ID);
    const limit = queriesOf(PANEL_ID).length;
    const reads = dataConsumption(code);
    expect(reads.touchesData, "the author JS never reads `data` at all").toBe(true);
    if (reads.iterates) return;
    for (let index = 0; index < limit; index += 1) {
      expect(
        reads.literalIndices.has(index),
        `${PANEL_ID} declares query ${index} but never reads data[${index}]`,
      ).toBe(true);
    }
  });

  it("builds a real scatter option, not an empty shell that satisfies the walkers", () => {
    // Every other assertion in this describe is satisfiable by `option = { series: []
    // }` plus a throwaway mention of each data index — verified. Nothing else pins
    // that the option is the CHART the section exists to hold, so the encodings the
    // design names are asserted on the source directly. Not executed: the author JS
    // computes its series from live PromQL results this suite has none of.
    const code = chartCode(PANEL_ID);
    expect(code, "no scatter/effectScatter series type — this is the quadrant's mark").toMatch(
      /["']?type["']?\s*:\s*["'](scatter|effectScatter)["']/,
    );
    expect(code, "no symbolSize — that IS the allocatable-cores bubble-size encoding").toContain(
      "symbolSize",
    );
    expect(code, "a quadrant needs an x axis").toMatch(/\bxAxis\b/);
    expect(code, "a quadrant needs a y axis").toMatch(/\byAxis\b/);
    const ast = parse(code);
    let emptySeries = false;
    walk.simple(ast, {
      Property(node: any) {
        const key = node.key?.name ?? node.key?.value;
        if (key === "series" && node.value?.type === "ArrayExpression") {
          if (node.value.elements.length === 0) emptySeries = true;
        }
      },
    });
    expect(emptySeries, `${PANEL_ID} assigns a provably empty \`series: []\``).toBe(false);
  });

  it("references a bare identifier the sandbox does not provide", () => {
    // The IIFE's only parameters are `data` and `echarts`
    // (convertCustomChartData.ts:155), so any OTHER free identifier — `store`,
    // `theme`, `Vue` — throws at render while passing validateUserCode. Checks value
    // position only: property KEYS share the Identifier node type, so walking every
    // Identifier would fail on a harmless `{ document: … }` key or a `p.document`
    // member access.
    const ast = parse(chartCode(PANEL_ID));
    const bound = new Set<string>(["data", "echarts"]);
    walk.simple(ast, {
      VariableDeclarator(node: any) {
        for (const name of boundNames(node.id)) bound.add(name);
      },
      FunctionDeclaration(node: any) {
        if (node.id?.name) bound.add(node.id.name);
        for (const param of node.params ?? [])
          for (const name of boundNames(param)) bound.add(name);
      },
      FunctionExpression(node: any) {
        for (const param of node.params ?? [])
          for (const name of boundNames(param)) bound.add(name);
      },
      ArrowFunctionExpression(node: any) {
        for (const param of node.params ?? [])
          for (const name of boundNames(param)) bound.add(name);
      },
      CatchClause(node: any) {
        for (const name of boundNames(node.param)) bound.add(name);
      },
    });
    const free: string[] = [];
    walk.ancestor(ast, {
      Identifier(node: any, _state: any, ancestors: any[]) {
        if (!isValuePosition(node, ancestors)) return;
        if (bound.has(node.name) || SANDBOX_GLOBALS.has(node.name)) return;
        // A DOM global is only reachable from a handler the PARENT rebuilds, so
        // where it appears is the whole question — see PARENT_ONLY_GLOBALS.
        if (PARENT_ONLY_GLOBALS.has(node.name) && inO2Events(ancestors)) return;
        free.push(node.name);
      },
    });
    expect([...new Set(free)], `${PANEL_ID} reads globals the sandbox never passes in`).toEqual([]);
  });

  it("reaches for a DOM global ONLY from inside o2_events", () => {
    // The exemption above is scoped by POSITION, so it has to be proved rather
    // than trusted: a `new CustomEvent` hoisted into the option body would throw
    // at render inside the iframe, which has no such global in scope.
    const ast = parse(chartCode(PANEL_ID));
    const misplaced: string[] = [];
    walk.ancestor(ast, {
      Identifier(node: any, _state: any, ancestors: any[]) {
        if (!isValuePosition(node, ancestors)) return;
        if (!PARENT_ONLY_GLOBALS.has(node.name)) return;
        if (!inO2Events(ancestors)) misplaced.push(node.name);
      },
    });
    expect(misplaced, `${PANEL_ID} reads a DOM global outside o2_events`).toEqual([]);
  });
});

describe("summary — colours come from real theme data, never a hardcoded palette", () => {
  // The sandbox CSP is `default-src 'none'; style-src 'none'`, so NO stylesheet
  // reaches the iframe and getComputedStyle cannot resolve a --color-* token from
  // inside it. That leaves exactly two options: bake a palette into the JS, or
  // have the resolver substitute the parent-resolved colours into the string
  // before it is handed to the sandbox. The first is what makes a chart legible
  // in light mode and unreadable in dark, so the second is the decision.
  //
  // Assert on the ABSENCE of literal hex, plus the PRESENCE of a substitution
  // token — deliberately not on any one binding name, which is the implementer's
  // to choose.
  it("contains no literal hex colour anywhere in the author JS", () => {
    const code = chartCode(PANEL_ID);
    const hits = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hits, `${PANEL_ID} hardcodes ${hits.join(", ")} instead of reading the theme`).toEqual(
      [],
    );
  });

  it("contains no literal rgb()/rgba()/hsl() colour either", () => {
    // The hex rule alone is trivially sidestepped by spelling the same palette a
    // different way, which is exactly what a well-meaning fix would reach for.
    const code = chartCode(PANEL_ID);
    expect(code, `${PANEL_ID} hardcodes a colour function`).not.toMatch(
      /\b(rgba?|hsla?)\s*\(\s*\d/,
    );
  });

  it("contains no CSS named colour, which the hex and rgb() rules both miss", () => {
    // Verified: `color: ["red", "green"]` passes both rules above while being the
    // exact dark-mode illegibility they exist to prevent. Matched as quoted string
    // literals only, so a `legend`/`grid`-style word inside prose copy is untouched.
    const code = chartCode(PANEL_ID);
    const named = [
      "red",
      "green",
      "blue",
      "yellow",
      "orange",
      "purple",
      "black",
      "white",
      "gray",
      "grey",
      "cyan",
      "magenta",
      "pink",
      "brown",
      "lime",
      "navy",
      "teal",
      "olive",
      "maroon",
      "silver",
      "gold",
      "crimson",
      "salmon",
      "tomato",
      "indigo",
      "violet",
      "khaki",
      "coral",
      "orchid",
      "turquoise",
    ];
    const pattern = new RegExp(`["'](${named.join("|")})["']`, "gi");
    const hits = [...code.matchAll(pattern)].map((m) => m[0]);
    expect(hits, `${PANEL_ID} hardcodes CSS named colours: ${hits.join(", ")}`).toEqual([]);
  });

  it("assembles no colour string at runtime to dodge the literal rules", () => {
    // Verified: String.fromCharCode(35) + "ff0000" defeats the hex rule outright, and
    // "#" + hex does the same. Both are AST-visible even though neither shows a hex
    // literal, so the smuggling route is closed rather than the rules loosened.
    const code = chartCode(PANEL_ID);
    const ast = parse(code);
    walk.simple(ast, {
      CallExpression(node: any) {
        const callee = node.callee;
        const isCharCode =
          callee?.type === "MemberExpression" &&
          /^(fromCharCode|fromCodePoint)$/.test(callee.property?.name ?? "");
        expect(isCharCode, `${PANEL_ID} builds a string from char codes`).toBe(false);
      },
    });
    expect(code, `${PANEL_ID} concatenates a "#" into a colour string`).not.toMatch(
      /["']#["']\s*\+|\+\s*["']#["']/,
    );
    expect(code, `${PANEL_ID} interpolates a "#" into a colour template`).not.toMatch(
      /`[^`]*#\$\{/,
    );
  });

  it("carries a substitution token, so the parent injects the resolved colours", () => {
    // The pack's existing substitution vocabulary is ${f:...} and ${scope:...}
    // (resolve.ts:932-936); a theme token joins it. Accepting any ${...} here
    // keeps the prefix the implementer's decision while still failing a JS string
    // that resolves nothing at all.
    expect(chartCode(PANEL_ID), `${PANEL_ID} injects no theme values`).toMatch(/\$\{[a-z]+:/i);
  });

  it("no colour token survives into the sandbox unsubstituted", () => {
    // A token the resolver does not know is passed through verbatim, and ECharts
    // then receives the literal string "${theme:...}" as a colour and silently
    // paints the default palette — the exact failure a hardcoded palette was
    // supposed to avoid, arrived at by a different road. Pinned as a REQUIREMENT
    // on the resolver: whatever prefix ships must be one substituteQuery handles.
    const code = chartCode(PANEL_ID);
    const prefixes = new Set([...code.matchAll(/\$\{([a-z]+):/gi)].map((m) => m[1]));
    for (const prefix of prefixes) {
      expect(
        ["f", "scope", "theme"],
        `${PANEL_ID} uses \${${prefix}:...} — resolve.ts must learn to substitute it`,
      ).toContain(prefix);
    }
  });
});

describe("summary — the four quadrant zones are tellable apart", () => {
  // MEASURED from rendered pixels before this fix (light theme, 1920px): the four zone
  // fills came out at 1.12:1, 1.10:1, 1.04:1 and 1.04:1 against the plot background, and
  // the last two were BYTE-IDENTICAL — CPU-bound and Memory-bound both resolved through
  // `--color-warning-500` at alpha 0.065. Those are the two most actionable diagnoses on
  // the chart ("one resource is tight, the other is slack"), so being indistinguishable
  // from each other was the worst of the three defects.
  //
  // Asserted on the AUTHOR JS rather than on rendered pixels: the substitution happens in
  // useCuratedPage and a headless spec has no --color-* cascade to resolve, so the honest
  // invariant here is "these two zones read DIFFERENT tokens", which is exactly the thing
  // that was wrong. The pixel contrast itself is verified on the live page.

  /** The `${theme:...}` token each zone's fill is bound to, by zone label. */
  const zoneTokens = (): Record<string, string> => {
    const code = chartCode(PANEL_ID);
    // `zone(x0, x1, y0, y1, FILL, "Label", position, INK)` — capture FILL and the label.
    const calls = [
      ...code.matchAll(/zone\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(\w+),\s*"([^"]+)"/g),
    ];
    const byLabel: Record<string, string> = {};
    for (const [, binding, label] of calls) {
      // Resolve `var ZONE_X = "${theme:zone-x}"` back to the token name.
      const decl = new RegExp(`var\\s+${binding}\\s*=\\s*"\\$\\{theme:([a-z0-9-]+)\\}"`, "i").exec(
        code,
      );
      byLabel[label] = decl ? decl[1] : binding;
    }
    return byLabel;
  };

  it("binds all four zones, one fill token each", () => {
    const zones = zoneTokens();
    expect(Object.keys(zones).sort(), `${PANEL_ID} does not declare four named zones`).toEqual([
      "CPU-bound",
      "Memory-bound",
      "No headroom",
      "Over-provisioned",
    ]);
  });

  it("gives CPU-bound and Memory-bound DIFFERENT fill tokens", () => {
    // The regression this exists to catch: both bound to --color-warning-500 at the same
    // alpha, which renders two byte-identical blocks for two opposite diagnoses.
    const zones = zoneTokens();
    expect(
      zones["CPU-bound"],
      `${PANEL_ID} paints CPU-bound and Memory-bound with the same token, so they cannot be told apart`,
    ).not.toBe(zones["Memory-bound"]);
  });

  it("gives every zone a distinct fill token, not just the two that collided", () => {
    const fills = Object.values(zoneTokens());
    expect(new Set(fills).size, `${PANEL_ID} reuses a zone fill token: ${fills.join(", ")}`).toBe(
      fills.length,
    );
  });

  it("labels each zone in its own hue, so the cue survives a greyscale print", () => {
    // Colour alone fails CVD and greyscale; the corner label is the redundant channel, so
    // each zone passes an INK token as well as a fill and the two must not be the same.
    const code = chartCode(PANEL_ID);
    const calls = [
      ...code.matchAll(
        /zone\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(\w+),\s*"([^"]+)",\s*"[^"]+",\s*(\w+)\)/g,
      ),
    ];
    expect(calls.length, `${PANEL_ID} has zones with no label-ink argument`).toBe(4);
    for (const [, fill, label, ink] of calls) {
      expect(ink, `${PANEL_ID} zone ${label} inks its label with its own fill colour`).not.toBe(
        fill,
      );
    }
  });
});

describe("summary — an over-committed cluster stays on the plot", () => {
  // Requests can exceed allocatable, so pct() legitimately returns >100. ECharts
  // DROPS any point outside a fixed axis range — verified: with `max: 100` a
  // 107.5/106.4 point paints nothing, with `max: 110` it paints. That makes the
  // one cluster this quadrant exists to surface render as ABSENCE, with no error.
  // Executed rather than regex-matched: a bare `max: 100` is only wrong in
  // combination with an unclamped pct(), and only running both together can tell.

  /** A PromQL-shaped instant frame: [metric, value] pairs, the shape eachSeries reads. */
  const frame = (rows: [Record<string, string>, number][]) => ({
    result: rows.map(([metric, v]) => ({ metric, value: [0, String(v)] })),
  });

  /** Runs the author JS the way the sandbox does, with the theme tokens already substituted. */
  const runChart = (cpuPct: number, memPct: number): any => {
    // Each token becomes a DISTINCT sentinel, so a colour comparison below is meaningful.
    const code = chartCode(PANEL_ID).replace(
      /\$\{theme:([a-z0-9-]+)\}/gi,
      (_m: string, name: string) => `token(${name})`,
    );
    const data = [
      frame([
        [{ cluster: "over", resource: "cpu" }, 100],
        [{ cluster: "over", resource: "memory" }, 100],
        [{ cluster: "calm", resource: "cpu" }, 100],
        [{ cluster: "calm", resource: "memory" }, 100],
      ]),
      frame([
        [{ cluster: "over", resource: "cpu" }, cpuPct],
        [{ cluster: "over", resource: "memory" }, memPct],
        [{ cluster: "calm", resource: "cpu" }, 50],
        [{ cluster: "calm", resource: "memory" }, 50],
      ]),
      frame([
        [{ cluster: "over", phase: "Running" }, 10],
        [{ cluster: "calm", phase: "Running" }, 10],
      ]),
      frame([]),
      frame([]),
    ];
    return new Function("data", "echarts", `${code}; return option;`)(data, {});
  };

  const bubbles = (option: any): any[] =>
    option.series.flatMap((series: any) => (Array.isArray(series.data) ? series.data : []));

  it("plots a >100% cluster inside the axis range instead of dropping it", () => {
    const option = runChart(107.5, 106.4);
    const over = bubbles(option).find((d: any) => d.name === "over");
    expect(over, "the over-committed cluster is not in the series data at all").toBeTruthy();
    expect(over.value[0]).toBeGreaterThan(100);
    expect(over.value[0]).toBeLessThanOrEqual(option.xAxis.max);
    expect(over.value[1]).toBeLessThanOrEqual(option.yAxis.max);
  });

  it("keeps the axis at 100 when nothing exceeds it, so the box does not float", () => {
    // The other half of the pin: a dynamic max must not drift on ordinary data.
    const option = runChart(90, 40);
    expect(option.xAxis.max).toBe(100);
    expect(option.yAxis.max).toBe(100);
  });

  it("reports the TRUE uncapped percentage, never a clamped one", () => {
    // A clamp-to-boundary fix is only honest if the real number survives somewhere.
    const option = runChart(107.5, 106.4);
    const over = bubbles(option).find((d: any) => d.name === "over");
    expect(over.meta.cpuPct, "cpuPct was clamped").toBeGreaterThan(100);
    expect(over.meta.memPct, "memPct was clamped").toBeGreaterThan(100);
  });

  it("does not read an over-committed cluster as healthy", () => {
    // Past-full is a measured capacity fact, so it must not paint the same as a
    // cluster with headroom just because its fault counters happen to be clean.
    const calm = bubbles(runChart(50, 50)).find((d: any) => d.name === "calm");
    const over = bubbles(runChart(107.5, 106.4)).find((d: any) => d.name === "over");
    expect(over.itemStyle.color).not.toBe(calm.itemStyle.color);
  });

  it("anchors the quadrant zones to fixed thresholds, not to the axis extent", () => {
    // The zones must mean the same thing whatever the data does: an 80% boundary
    // that slides with the axis would silently redefine "No headroom".
    const zonesOf = (option: any) =>
      option.series
        .flatMap((series: any) => series.markArea?.data ?? [])
        .map((pair: any) => pair[0].coord.join(","));
    expect(zonesOf(runChart(107.5, 106.4))).toEqual(zonesOf(runChart(50, 50)));
  });
});

describe("summary — unit, layout and drilldown", () => {
  it("declares a unit that is a real getUnitOptions value", () => {
    // lint.spec.ts:141 checks EVERY panel's unit, custom_chart included — the field
    // is required even where the author JS formats its own labels. Which value is the
    // implementer's call (the chart plots percentages, cores and counts at once, so
    // no single unit truly describes it); that it is a REAL option is the invariant.
    expect(UNIT_VALUES.has(panel(PANEL_ID).unit), `${PANEL_ID} unit`).toBe(true);
  });

  it("no variant overrides the unit", () => {
    // resolve.ts:436 — `base.unit = variant.unit ?? panel.unit`.
    for (const v of panel(PANEL_ID).variants) {
      expect(v.unit, `${PANEL_ID} variant overrides unit`).toBeUndefined();
    }
  });

  it("fills the grid row, because a quadrant needs both axes readable", () => {
    // flowLayout (resolve.ts:1046-1066) derives x/y from declaration order and w.
    // A ten-bubble scatter squeezed into a w:32 tile column has neither axis legible.
    // A LOWER BOUND, not 192: half the 192-column row still reads, and freezing the
    // exact width forbids a future second panel beside it for no stated reason.
    const layout = panel(PANEL_ID).layout;
    expect(
      layout.w,
      `${PANEL_ID} needs at least half the grid row to stay legible`,
    ).toBeGreaterThanOrEqual(96);
    expect(layout.h, `${PANEL_ID} needs vertical room for a y axis`).toBeGreaterThanOrEqual(16);
  });

  it("is tall enough that the plot is not a letterbox, and still fits a 1440x900 viewport", () => {
    // MEASURED on the live page: GridStack runs a 17px cellHeight (RenderDashboardCharts
    // .vue:849), and the rendered canvas came out at exactly `h * 17 - 39` px at every
    // width tried. At the old h:24 that was a 369px canvas under a 1760px one — 1% of CPU
    // rendered 16.25px wide against 2.77px tall, a 5.9x distortion that flattened the
    // equal-commitment diagonal to 9.7 degrees and made "CPU-bound or memory-bound?"
    // unreadable. BOTH bounds are load-bearing and pin opposite failures:
    //   • too short  → the letterbox comes straight back
    //   • too tall   → the panel outgrows the page's inner scroller (MEASURED clientHeight
    //     748px at 1440x900, against 85px of non-panel content) and the user must scroll
    //     to see a chart that is supposed to be the tab's whole point.
    const layout = panel(PANEL_ID).layout;
    const canvasPx = layout.h * 17 - 39;
    expect(canvasPx, `${PANEL_ID} is letterboxed again at h:${layout.h}`).toBeGreaterThanOrEqual(
      560,
    );
    expect(
      layout.h * 17,
      `${PANEL_ID} at h:${layout.h} overflows the 1440x900 inner scroller`,
    ).toBeLessThanOrEqual(748 - 85);
  });

  it("carries a byUrl drilldown whose base64 decodes to one of its OWN queries", () => {
    // Lint rules 27/28 require the drilldown and require the query param to be
    // base64 that decodes back into the panel's query set. With FIVE queries the
    // copy-paste failure is live rather than theoretical: the pack's panel() helper
    // always encodes queries[0], so a reordering silently retargets the drilldown.
    const entry: any = (panel(PANEL_ID).drilldown ?? []).find((d: any) => d.type === "byUrl");
    expect(entry, `${PANEL_ID} has no byUrl drilldown`).toBeDefined();
    const url = new URL(entry.data.url, "http://localhost");
    expect(url.searchParams.get("query_type")).toBe("promql");
    const encoded = url.searchParams.get("query");
    expect(encoded, `${PANEL_ID} has no query param`).toBeTruthy();
    expect(queriesOf(PANEL_ID), `${PANEL_ID} drills into a query it does not own`).toContain(
      b64DecodeUnicodeSafe(encoded!),
    );
  });

  it("drills into its own anchor stream", () => {
    // Lint rules 27/28 check the base64 query but never `stream_name`, and the
    // pack helper takes the stream as a separate positional argument — so a
    // copy-paste opens the metrics explorer on an unrelated stream, lint green.
    const entry: any = (panel(PANEL_ID).drilldown ?? []).find((d: any) => d.type === "byUrl");
    const url = new URL(entry.data.url, "http://localhost");
    expect(url.searchParams.get("stream_name")).toBe(
      panel(PANEL_ID).variants[0].requiresStreams[0],
    );
  });
});

describe("summary — i18n", () => {
  it("the section title resolves to non-blank en-US copy", () => {
    // copy() already throws on a missing key, so a bare toBeTruthy() here can never
    // fail. The reachable failure is a key present but empty or whitespace-only.
    expect(copy(section().titleKey).trim().length, `${SECTION_ID} title is blank`).toBeGreaterThan(
      0,
    );
  });

  it("the panel title resolves to non-blank en-US copy", () => {
    expect(
      copy(panel(PANEL_ID).titleKey).trim().length,
      `${PANEL_ID} title is blank`,
    ).toBeGreaterThan(0);
  });

  it("the panel title does not claim a top-N it does not have", () => {
    // Lint rule (a)'s non-table half fires only on a topk query; this chart has
    // none, so the copy is pinned directly.
    expect(copy(panel(PANEL_ID).titleKey)).not.toMatch(/\btop\s*\d+\b/i);
  });

  it("the title or the section note tells the reader the chart ignores the pickers", () => {
    // Every other section on this page reacts to the cluster picker. A tab that
    // silently does not is the "broken page" reading the scope-coverage lint rule
    // exists to prevent — but that rule is satisfied by a fleetWide DECLARATION,
    // which the user never sees. The disclosure has to be in the copy.
    const note = (section() as any).noteKey ? copy((section() as any).noteKey) : "";
    const text = `${copy(panel(PANEL_ID).titleKey)} ${note}`.toLowerCase();
    expect(text, "nothing tells the reader this chart is fleet-wide").toMatch(
      /fleet|all clusters|every cluster/,
    );
  });
});

describe("summary — a bubble click ANNOUNCES the cluster, and never navigates itself", () => {
  // The click handler is the page's only answer to "which cluster should I look
  // at" actually leading anywhere. It travels as `o2_events`, which the sandbox
  // serializes to a string (convertCustomChartData.ts:110-118) and
  // CustomChartRenderer.vue:118-124 rebuilds with `new Function` in the PARENT.
  // It gets the DOM but never the router, so it dispatches and CuratedPageView
  // routes: `location.assign` here tore down and reloaded the entire SPA.
  // Extracted and EXECUTED here, because the string surviving is not evidence
  // that the dispatch is right.
  const handlerSource = (): string => {
    const code = chartCode(PANEL_ID);
    const ast = parse(code);
    let source: string | null = null;
    walk.simple(ast, {
      Property(node: any) {
        const key = node.key?.name ?? node.key?.value;
        if (key !== "o2_events") return;
        for (const prop of node.value?.properties ?? []) {
          const event = prop.key?.name ?? prop.key?.value;
          if (event === "click") source = code.slice(prop.value.start, prop.value.end);
        }
      },
    });
    if (!source) throw new Error("no o2_events.click handler on the fleet quadrant");
    return source;
  };

  /** Rebuilds the handler the way CustomChartRenderer does, over a fake chart DOM. */
  const runClick = (params: unknown, source = handlerSource()) => {
    const events: CustomEvent[] = [];
    const assigned: string[] = [];
    const ownerDocument = {
      dispatchEvent: (event: CustomEvent) => events.push(event),
      defaultView: {
        location: {
          search: "?org_identifier=default",
          pathname: "/web/infra/kubernetes",
          assign: (url: string) => assigned.push(url),
          replace: (url: string) => assigned.push(url),
        },
      },
    };
    const handler = new Function(`return ${source}`)();
    handler(params, { getDom: () => ({ ownerDocument }) });
    return { events, assigned };
  };

  const bubble = (name: string) => ({ data: { name, meta: { name } } });

  it("survives DOMPurify byte-for-byte — a `<` would TRUNCATE the handler", () => {
    // The sandbox serializes this function with DOMPurify.sanitize over its TEXT
    // (convertCustomChartData.ts:110-118). Measured: `&` becomes `&amp;` and `<`
    // silently cuts the function off mid-body, so `for (i = 0; i < n; i++)`
    // rebuilt as a syntax error and the whole panel rendered a blank canvas with
    // NO console error. Executing the sanitized text is the only honest check.
    const source = handlerSource();
    expect(DOMPurify.sanitize(source), "sanitize rewrote the handler").toBe(source);
  });

  it("still dispatches after a real sanitize round trip", () => {
    const { events } = runClick(bubble("prod-eu"), DOMPurify.sanitize(handlerSource()));
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ cluster: "prod-eu" });
  });

  it("NEVER touches location — that is the whole reload bug", () => {
    // location.assign/replace is a document navigation: it discards the SPA, so
    // every panel refetches and the user watches a white flash. A regression here
    // is invisible in a screenshot and only shows up as the reload itself.
    const { assigned } = runClick(bubble("prod-eu"));
    expect(assigned).toEqual([]);
    expect(handlerSource()).not.toMatch(/location/);
  });

  it("dispatches the event name CuratedPageView actually listens for", () => {
    // A typo on either side is a click that silently does nothing at all.
    const { events } = runClick(bubble("prod-eu"));
    expect(events[0].type).toBe(FLEET_DRILLDOWN_EVENT);
  });

  it("bubbles, because the listener sits on the document and not on this chart", () => {
    const { events } = runClick(bubble("prod-eu"));
    expect(events[0].bubbles).toBe(true);
  });

  it("carries the clicked cluster verbatim, escaping nothing", () => {
    // The name rides a structured `detail`, so a name that would have broken a
    // query string needs no encoding here — the router encodes it downstream.
    const { events } = runClick(bubble("eu&west=1"));
    expect(events[0].detail).toEqual({ cluster: "eu&west=1" });
  });

  it("targets a tab id the manifest actually declares", () => {
    // "health" is a frozen section id, not copy: a rename would route to a tab
    // that does not exist and land the reader back on the default one.
    expect(kubernetesPage.sections.map((s: any) => s.id)).toContain(FLEET_DRILLDOWN_TAB);
  });

  it("names the picker the cluster scope actually binds to", () => {
    // var-cluster only scopes the destination if "cluster" is a real picker
    // (useVariablesManager.ts:865-925 matches on the picker's own name).
    expect(kubernetesPage.scopePickers.map((p: any) => p.name)).toContain("cluster");
  });

  it("ignores a click that carries no cluster", () => {
    // markArea/markLine zones and axis clicks all reach this handler with no
    // `meta`, and drilling into `var-cluster=undefined` would blank every panel.
    expect(runClick({}).events).toEqual([]);
    expect(runClick({ data: {} }).events).toEqual([]);
  });

  it("the bubbles show a pointer cursor, so the affordance is visible", () => {
    // A drill-down nothing signals is one nobody finds.
    expect(chartCode(PANEL_ID)).toContain('cursor: "pointer"');
  });
});
