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

// Utilization section — PACK-SPECIFIC invariants (tranche 1A). Generic rules live
// in lint.spec.ts. Every describe below names the live measurement that motivated
// it, so a future reader can re-verify the claim rather than trust the assertion.

import { describe, it, expect } from "vitest";
import { kubernetesPage } from "./kubernetes.page";
import enLocale from "@/locales/languages/en-US.json";

const SECTION_ID = "utilization";

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

/** Operands of a binary op, keeping only the sides that actually select a metric. */
const operandsOf = (query: string, op: string): string[] =>
  query.split(op).filter((side) => /[a-z_]+\{/.test(side));

const TILE_IDS = [
  "k8s_ut_over_limit",
  "k8s_ut_near_limit",
  "k8s_ut_cpu_idle_pods",
  "k8s_ut_mem_idle_pods",
  "k8s_ut_cpu_commit",
  "k8s_ut_cpu_free",
];

const TABLE_IDS = [
  "k8s_ut_over_limit_top",
  "k8s_ut_cpu_waste_top",
  "k8s_ut_mem_waste_top",
  "k8s_ut_node_commit_top",
];

describe("utilization — shape", () => {
  it("sits directly after overview, ahead of node capacity", () => {
    // Asserted RELATIVE to the sections that exist, not as a frozen full list:
    // tranche 1B inserts `health` between overview and utilization, and this pin
    // must not fail on a correct 1A just because 1B has not landed.
    const ids = kubernetesPage.sections.map((s: any) => s.id);
    expect(ids[0]).toBe("overview");
    expect(ids).toContain(SECTION_ID);
    expect(ids.indexOf(SECTION_ID)).toBeLessThan(ids.indexOf("nodes"));
    expect(ids.indexOf(SECTION_ID)).toBeGreaterThan(ids.indexOf("overview"));
  });

  it("every panel declares exactly one variant with exactly one query", () => {
    // A panel with `variants: []` passes every `for (const variant of ...)` loop in
    // this file vacuously, then crashes at resolve.ts:964 where selectedVariant! is
    // dereferenced — a runtime failure instead of a lint failure. None of these 11
    // has a drift alternative, so one variant is the correct shape.
    for (const p of panels()) {
      expect(p.variants.length, `${p.id} must declare exactly one variant`).toBe(1);
      // The trend plots reserved AND allocatable as separate series: a single ratio
      // line shows 54% but never the two quantities, so a rise cannot be read as
      // "requests grew" or "capacity shrank".
      const expected = p.id === "k8s_ut_commit_trend" ? 2 : 1;
      expect(p.variants[0].queries.length, `${p.id} query count`).toBe(expected);
    }
  });

  it("holds exactly the 11 designed panels", () => {
    expect(panels().map((p: any) => p.id)).toEqual([
      ...TILE_IDS,
      "k8s_ut_commit_trend",
      ...TABLE_IDS,
    ]);
  });

  // COUPLED EDIT, not testable from here: lint.spec.ts:59-65 keeps GOLDEN_NAMES
  // module-private and asserts the pack's section ids equal it (:366-373). Adding
  // this section REQUIRES adding "utilization" there, plus updating the frozen
  // lists at resolve.spec.ts:1155 and :2118 and the panel count in
  // kubernetes.page.spec.ts. Exporting GOLDEN_NAMES purely to assert it here would
  // loosen the governance file, so the requirement is recorded rather than pinned.

  it("scopes by cluster and namespace, and declares no pod picker", () => {
    // No panel here is pod-scoped: the tables list pods as ROWS, so scoping their
    // input by pod would be circular. Lint rule 18 forbids an unused picker.
    expect(section().scopedBy).toEqual(["cluster", "namespace"]);
  });

  it("every panel reads the kube-state or kubeletstats group, never a new one", () => {
    // One collector must not present two setup doors (design §4).
    const groupIds = new Set(panels().map((p: any) => p.groupId));
    expect([...groupIds].sort()).toEqual(["kube-state", "kubelet-pod"]);
  });
});

describe("utilization — the lying gauge (measured: 61.8% vs 9.1%)", () => {
  // Scoping ONE side of a ratio understates it by the ratio of fleet to cluster.
  // Measured on `production`: both sides scoped reads 0.6177; scoping only the
  // numerator reads 0.0906 — a 6.8x understatement that renders as a plausible
  // gauge. Lint rule 16 polices `/` only for section-scoped panels, so this pins
  // it directly rather than relying on the rule.
  it("every division operand carries the cluster token", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!query.includes(" / ")) continue;
        for (const side of operandsOf(query, " / ")) {
          expect(side, `${id}: division operand without cluster scope`).toContain(
            "${scope:cluster}",
          );
        }
      }
    }
  });

  it("no ratio panel is namespace-scoped on one side only", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!query.includes(" / ")) continue;
        const sides = operandsOf(query, " / ");
        const withNs = sides.filter((s) => s.includes("${scope:namespace}")).length;
        expect(withNs === 0 || withNs === sides.length, `${id}: half-namespaced ratio`).toBe(true);
      }
    }
  });
});

describe("utilization — waste is topk on the wasted fraction, never bottomk", () => {
  // `bottomk(20, ratio < 0.2)` returns the pods NEAREST the threshold (0.20,
  // 0.199) — the least interesting ones — and `bottomk` does not contain the
  // substring "topk", so lint rule 14's cardinality bound does not match it and
  // the panel would ship unbounded. `topk(20, 1 - ratio)` is bounded, lint-clean,
  // and surfaces the true worst offenders (measured: 1.0 = all requested CPU idle).
  it("no query uses bottomk", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        expect(query, `${id} uses bottomk, which lint rule 14 cannot bound`).not.toMatch(
          /bottomk\s*\(/,
        );
      }
    }
  });

  it("the waste tables rank on 1 - ratio, not on a threshold-filtered ratio", () => {
    for (const id of ["k8s_ut_cpu_waste_top", "k8s_ut_mem_waste_top"]) {
      const [query] = queriesOf(id);
      expect(query, `${id} must rank on the wasted fraction`).toContain("1 - sum by");
      // A trailing `< 0.2` would re-introduce the nearest-the-threshold bug.
      expect(query, `${id} must not filter the ranked expression`).not.toMatch(/\)\s*<\s*[\d.]+/);
    }
  });

  it("the waste tables group by the pod identity triple, never by a partial key", () => {
    // The ratio metrics carry k8s_container_name too, so a grouping key that omits
    // any of (cluster, namespace, pod) would SUM sibling series and inflate the
    // ratio past 1 — making `1 - ratio` negative for a genuinely idle pod and
    // letting the clamp hide it. Measured, the triple is 1:1 with the series count
    // (997/997 cpu, 874/874 mem-request, 817/817 mem-limit), so `sum by` over it is
    // a passthrough rather than an aggregation.
    for (const id of ["k8s_ut_cpu_waste_top", "k8s_ut_mem_waste_top", "k8s_ut_over_limit_top"]) {
      const clause = queriesOf(id)[0].match(/sum by \(([^)]*)\)/);
      expect(clause, `${id} must aggregate explicitly`).not.toBeNull();
      const labels = clause![1].split(",").map((l) => l.trim());
      expect(labels, `${id} groups by a partial identity`).toEqual([
        "${f:k8s-cluster}",
        "${f:k8s-namespace}",
        "${f:k8s-pod-name}",
      ]);
    }
  });

  it("the waste tables exclude pods using nothing at all, or the ranking is arbitrary", () => {
    // Measured: 43 pods report a CPU-request ratio of exactly 0, so all 43 clamp to
    // a waste of exactly 1.0 and topk(20) returned 20 rows with ONE distinct value —
    // an unstable selection that pushes a genuinely interesting pod at 0.97 off the
    // page. Absolute wasted cores would rank better but needs a kube-state join,
    // which returns 0 series on this engine, so the degenerate set is excluded
    // instead; the count tiles already report it.
    for (const id of ["k8s_ut_cpu_waste_top", "k8s_ut_mem_waste_top"]) {
      expect(queriesOf(id)[0], `${id} must exclude the zero-usage set`).toMatch(/\}\s*>\s*0\)/);
    }
  });

  it("the waste fraction is clamped at zero, so over-consuming pods read 0 not negative", () => {
    // Measured: 11 pods exceed their CPU request (max 3.12x), so an unclamped
    // `1 - ratio` reaches -2.12. A "wasted fraction" column showing -212% is
    // simply wrong — that pod wastes nothing, it over-consumes. clamp_min keeps
    // every pod in the result (no threshold filter) while reporting 0 waste.
    for (const id of ["k8s_ut_cpu_waste_top", "k8s_ut_mem_waste_top"]) {
      expect(queriesOf(id)[0], `${id} must clamp the wasted fraction at 0`).toContain(
        "clamp_min(1 - sum by",
      );
    }
  });
});

describe("utilization — every table strips plumbing labels", () => {
  // These metrics arrive via the OTel prometheusreceiver carrying nine plumbing
  // labels (flag, service_instance_id, url_scheme, ...). A curated table renders
  // one column per label key across the result, so a bare `metric > 1` table
  // renders 13 columns, nine of them noise. `sum by (...)` collapses it to the
  // identity labels — measured: 3 columns.
  it("every table query aggregates with sum by", () => {
    for (const id of TABLE_IDS) {
      for (const query of queriesOf(id)) {
        expect(query, `${id} must aggregate to strip plumbing labels`).toContain("sum by (");
      }
    }
  });

  it("no table query is a bare metric comparison", () => {
    for (const id of TABLE_IDS) {
      for (const query of queriesOf(id)) {
        expect(query, `${id} selects raw series`).not.toMatch(/^\s*[a-z_]+\{[^}]*\}\s*[<>]/);
      }
    }
  });
});

describe("utilization — instant reads and titles", () => {
  it("every tile and table is an instant query", () => {
    // A range read would list one row per series seen ANYWHERE in the window and
    // contradict the tiles above it.
    for (const id of [...TILE_IDS, ...TABLE_IDS]) {
      for (const variant of panel(id).variants) {
        expect(variant.queryMode, `${id} must read the current instant`).toBe("instant");
      }
    }
  });

  it("the trend panel is a range read and declares no instant mode", () => {
    for (const variant of panel("k8s_ut_commit_trend").variants) {
      expect(variant.queryMode).toBeUndefined();
    }
  });

  it("every table title discloses its topk N", () => {
    for (const id of TABLE_IDS) {
      const n = queriesOf(id)[0].match(/topk\((\d+),/);
      expect(n, `${id} has no topk`).not.toBeNull();
      expect(copy(panel(id).titleKey)).toContain(n![1]);
    }
  });

  it("instant panels say so in their copy", () => {
    for (const id of [...TILE_IDS, ...TABLE_IDS]) {
      expect(copy(panel(id).titleKey), `${id} title should mark the instant read`).toContain(
        "(now)",
      );
    }
  });
});

describe("utilization — units render ratios as percentages", () => {
  // convertDataIntoUnitValue.ts:188-200 — `percent-1` MULTIPLIES BY 100 (for a
  // 0..1 ratio), `percent` does not (for an already-0..100 value). Every value on
  // this section that is a ratio is 0..1, so `percent` would render the measured
  // 0.589 fleet commitment as "0.59%" instead of "58.9%". Lint rule 7 only checks
  // the unit is a REAL option; it cannot tell which of the two is correct here.
  /** Panels whose value is an absolute quantity, not a ratio. */
  const ABSOLUTE_PANELS = ["k8s_ut_cpu_free", "k8s_ut_commit_trend"];

  const COUNT_PANELS = [
    "k8s_ut_over_limit",
    "k8s_ut_near_limit",
    "k8s_ut_cpu_idle_pods",
    "k8s_ut_mem_idle_pods",
  ];

  const RATIO_PANELS = [
    "k8s_ut_cpu_commit",
    "k8s_ut_over_limit_top",
    "k8s_ut_cpu_waste_top",
    "k8s_ut_mem_waste_top",
    "k8s_ut_node_commit_top",
  ];

  it("every ratio panel uses percent-1, never percent", () => {
    for (const id of RATIO_PANELS) {
      expect(panel(id).unit, `${id} renders a 0..1 ratio`).toBe("percent-1");
    }
  });

  it("absolute panels carry their unit, so the number states its own scale", () => {
    // A percentage hides magnitude: 46% of 92 cores (39.8 free) and 46% of 4 cores
    // are not the same emergency. Measured on common-dev: 52.22 reserved of 92.04
    // allocatable. Cluster-level panels can show real units because BOTH operands
    // are kube-state; pod-level ratio tables cannot, since kubeletstats publishes
    // only ratios and the absolute limit lives in kube-state, which this engine
    // cannot join (label_replace is a no-op here).
    for (const id of ABSOLUTE_PANELS) {
      expect(panel(id).unit, `${id} must render a real unit`).toBe("custom");
      expect(panel(id).unitCustom, `${id} must name its unit`).toBeTruthy();
    }
  });

  it("the count tiles are plain numbers, not percentages", () => {
    for (const id of COUNT_PANELS) {
      expect(panel(id).unit, `${id} counts pods`).toBe("numbers");
    }
  });

  it("no variant overrides the panel unit", () => {
    // resolve.ts:436 — `base.unit = variant.unit ?? panel.unit`, so a variant-level
    // override silently wins over the unit asserted above.
    for (const p of panels()) {
      for (const v of p.variants) expect(v.unit, `${p.id} variant overrides unit`).toBeUndefined();
    }
  });

  it("every panel in the section is classified as either a ratio or a count", () => {
    // Both lists are hand-maintained literals. Without this, a 12th panel is
    // silently unpinned and lint rule 7 would accept `percent` on a 0..1 ratio.
    expect([...RATIO_PANELS, ...COUNT_PANELS, ...ABSOLUTE_PANELS].sort()).toEqual(
      panels()
        .map((p: any) => p.id)
        .sort(),
    );
  });
});

describe("utilization — group assignment follows the collector, per panel", () => {
  // A panel's group decides which stream list is checked for satisfiability
  // (resolve.ts:405-414) AND which fieldOverrides resolve its ${f:} concepts.
  // kube-state maps k8s-namespace -> "namespace"; the kubeletstats streams spell
  // it "k8s_namespace_name". Swapping a panel's group therefore produces a query
  // filtered on a column its stream does not have — no error, just no data.
  const KUBELET_PANELS = [
    "k8s_ut_over_limit",
    "k8s_ut_near_limit",
    "k8s_ut_cpu_idle_pods",
    "k8s_ut_mem_idle_pods",
    "k8s_ut_over_limit_top",
    "k8s_ut_cpu_waste_top",
    "k8s_ut_mem_waste_top",
  ];
  const KUBE_STATE_PANELS = [
    "k8s_ut_cpu_commit",
    "k8s_ut_cpu_free",
    "k8s_ut_commit_trend",
    "k8s_ut_node_commit_top",
  ];

  it("every k8s_pod_* panel reads the kubeletstats group", () => {
    for (const id of KUBELET_PANELS) {
      expect(panel(id).groupId, `${id} queries k8s_pod_* metrics`).toBe("kubelet-pod");
      for (const query of queriesOf(id)) expect(query).toMatch(/\bk8s_pod_\w+/);
    }
  });

  it("every kube_* panel reads the kube-state group", () => {
    for (const id of KUBE_STATE_PANELS) {
      expect(panel(id).groupId, `${id} queries kube_* metrics`).toBe("kube-state");
      for (const query of queriesOf(id)) expect(query).toMatch(/\bkube_\w+/);
    }
  });

  it("no panel mixes metrics from both collectors in one query", () => {
    // The two schemas cannot be joined — label_replace is a no-op on this engine —
    // so a query touching both would silently pair mismatched label sets.
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        const kubelet = /\bk8s_pod_\w+/.test(query);
        const kubeState = /\bkube_\w+/.test(query);
        expect(kubelet && kubeState, `${id} joins two uncojoinable schemas`).toBe(false);
      }
    }
  });
});

describe("utilization — fleet-wide tiles are declared, never silent", () => {
  it("every tile declares fleetWide for namespace", () => {
    // A tile answers "is anything wrong in this cluster"; pre-filtering it to one
    // namespace defeats its purpose. Lint rule 19 requires the omission be declared.
    for (const id of TILE_IDS) {
      expect(panel(id).fleetWide, `${id} must declare its namespace omission`).toEqual([
        "namespace",
      ]);
    }
  });

  it("every pod-level table honours the namespace filter, so declares no fleetWide", () => {
    // k8s_ut_node_commit_top is the deliberate exception, asserted below: a node's
    // commitment is the sum of every pod on it, so a namespace filter would report
    // a fraction of the node's real load and read as a healthy node.
    for (const id of TABLE_IDS.filter((t) => t !== "k8s_ut_node_commit_top")) {
      expect(panel(id).fleetWide, `${id} should respect the namespace filter`).toBeUndefined();
    }
  });

  it("the node-commitment ratio groups both sides by the same label pair", () => {
    // Live: kube_node_status_allocatable carries ONLY k8s_cluster and node, so a
    // mismatched grouping either fails the vector match or divides by a fleet
    // total — a plausible-looking ratio that is silently wrong.
    const [query] = queriesOf("k8s_ut_node_commit_top");
    const clauses = [...query.matchAll(/\bsum by \(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(clauses, "expected a grouped numerator and denominator").toHaveLength(2);
    expect(clauses[0]).toBe(clauses[1]);
    expect(clauses[0]).toContain("${f:k8s-node-name}");
  });

  it("the trend plots absolute cores, while the tile reports the ratio", () => {
    // Deliberately NOT the same query any more. A single ratio line shows 54% but
    // never the two quantities behind it, so a rise cannot be read as "requests
    // grew" or "capacity shrank"; the trend now carries both series in cores.
    expect(panel("k8s_ut_commit_trend").unit).toBe("custom");
    // Leading space: formatUnitValue concatenates value+unit with no separator
    // (convertDataIntoUnitValue.ts:254), which rendered "47.54cores".
    expect(panel("k8s_ut_commit_trend").unitCustom).toBe(" cores");
    expect(panel("k8s_ut_cpu_commit").unit).toBe("percent-1");
    const legends = panel("k8s_ut_commit_trend").variants[0].queries.map((q: any) => q.legend);
    expect(legends).toEqual(["reserved", "allocatable"]);
  });

  it("the node-commitment table is fleet-wide by namespace and says so", () => {
    // A node's commitment is the sum of every pod on it regardless of namespace;
    // filtering by namespace would report a fraction of the node's real load.
    const [query] = queriesOf("k8s_ut_node_commit_top");
    expect(query).not.toContain("${scope:namespace}");
    expect(panel("k8s_ut_node_commit_top").fleetWide).toEqual(["namespace"]);
  });
});

describe("utilization — layout is the pinned tile row plus full-width charts", () => {
  // flowLayout (resolve.ts:1046-1066) derives x/y purely from declaration order
  // and w, so panel ORDER implies the layout — but order alone does not pin the
  // widths. Simulated over these 11 panels: six w:32 tiles fill row 0 exactly
  // (192), then three rows of two w:96 charts, the last half-full.
  it("the six tiles are w:32 h:6", () => {
    for (const id of TILE_IDS) expect(panel(id).layout, id).toEqual({ w: 32, h: 6 });
  });

  it("every chart and table is w:96 h:16", () => {
    for (const id of ["k8s_ut_commit_trend", ...TABLE_IDS]) {
      expect(panel(id).layout, id).toEqual({ w: 96, h: 16 });
    }
  });

  it("the tile row fills the 192-column grid exactly", () => {
    const rowWidth = TILE_IDS.reduce((sum, id) => sum + panel(id).layout.w, 0);
    expect(rowWidth).toBe(192);
  });
});

describe("utilization — drilldown targets each panel's own stream", () => {
  // Lint rules 30/31 check the drilldown's base64 query decodes to one of the
  // panel's own queries, but never that `stream_name` matches. The pack's panel()
  // helper takes the stream as a SEPARATE argument, so a copy-paste opens the
  // metrics explorer on an unrelated stream and lint stays green.
  it("every panel carries a byUrl drilldown on its own first stream", () => {
    for (const p of panels()) {
      const entry = (p.drilldown ?? []).find((d: any) => d.type === "byUrl");
      expect(entry, `${p.id} has no byUrl drilldown`).toBeDefined();
      const url = new URL((entry as any).data.url, "http://localhost");
      expect(url.searchParams.get("stream_name"), `${p.id} drills into the wrong stream`).toBe(
        p.variants[0].requiresStreams[0],
      );
    }
  });
});

describe("utilization — requiresStreams completeness", () => {
  it("every metric a query reads is declared", () => {
    // A variant is satisfiable only when ALL its streams are present and live
    // (resolve.ts:405-414). A missing declaration renders half a ratio.
    for (const id of panels().map((p: any) => p.id)) {
      for (const variant of panel(id).variants) {
        const declared: string[] = variant.requiresStreams ?? [];
        const used = new Set(
          variant.queries
            .flatMap((q: any) => [...String(q.query).matchAll(/\b(k8s_pod_\w+|kube_\w+)/g)])
            .map((m: any) => m[1]),
        );
        for (const metric of used) {
          expect(declared, `${id} reads ${metric} without declaring it`).toContain(metric);
        }
      }
    }
  });

  it("element 0 of requiresStreams is the exact schema stream each panel needs", () => {
    // resolve.ts:432 assigns requiresStreams[0] to queryStream, which drives both
    // the drilldown and the schema consulted for every ${f:} concept. Ordering is
    // load-bearing, so it is pinned per panel rather than merely "non-empty":
    // k8s_ut_cpu_commit must anchor on the REQUESTS stream (which carries
    // namespace/pod/node), not on allocatable (which carries only node).
    const EXPECTED_ANCHOR: Record<string, string> = {
      k8s_ut_over_limit: "k8s_pod_memory_limit_utilization",
      k8s_ut_near_limit: "k8s_pod_memory_limit_utilization",
      k8s_ut_cpu_idle_pods: "k8s_pod_cpu_request_utilization",
      k8s_ut_mem_idle_pods: "k8s_pod_memory_request_utilization",
      k8s_ut_cpu_commit: "kube_pod_container_resource_requests",
      k8s_ut_cpu_free: "kube_node_status_allocatable",
      k8s_ut_commit_trend: "kube_pod_container_resource_requests",
      k8s_ut_over_limit_top: "k8s_pod_memory_limit_utilization",
      k8s_ut_cpu_waste_top: "k8s_pod_cpu_request_utilization",
      k8s_ut_mem_waste_top: "k8s_pod_memory_request_utilization",
      k8s_ut_node_commit_top: "kube_pod_container_resource_requests",
    };
    for (const [id, anchor] of Object.entries(EXPECTED_ANCHOR)) {
      expect(panel(id).variants[0].requiresStreams?.[0], `${id} anchors on the wrong stream`).toBe(
        anchor,
      );
    }
  });
});

describe("utilization — the unsized-pod blind spot is disclosed", () => {
  // Measured: 1,258 pods report usage but only 922 declare a memory request, so
  // 336 pods (27%) carry no request at all and produce NO utilization ratio.
  // Datadog's equivalent view drops those groups silently; the section note must
  // say we do not, or the tiles imply a completeness they do not have.
  it("the section note names the unsized-pod gap", () => {
    const note = copy(section().noteKey);
    expect(note.toLowerCase()).toContain("request");
    expect(note).toMatch(/no request|without a request|unsized/i);
    expect(note, "must disclose why the waste tables skip idle pods").toMatch(/skip|exclude/i);
  });

  it("the section note explains that tiles ignore the namespace filter", () => {
    expect(copy(section().noteKey).toLowerCase()).toContain("namespace");
  });
});

describe("utilization — i18n", () => {
  it("every title and the section note resolve to en-US copy", () => {
    expect(copy(section().titleKey)).toBeTruthy();
    expect(copy(section().noteKey)).toBeTruthy();
    for (const p of panels()) expect(copy(p.titleKey)).toBeTruthy();
  });
});
