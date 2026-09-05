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

// Health section — PACK-SPECIFIC invariants (tranche 1B). Generic rules live in
// lint.spec.ts. Every describe names the live measurement that motivated it, so a
// future reader can re-verify the claim rather than trust the assertion.

import { describe, it, expect } from "vitest";
import { kubernetesPage } from "./kubernetes.page";
import enLocale from "@/locales/languages/en-US.json";

const SECTION_ID = "health";

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

const TILE_IDS = [
  "k8s_wh_containers_failing",
  "k8s_wh_deploy_short",
  "k8s_wh_sts_short",
  "k8s_wh_ds_unavailable",
  "k8s_wh_jobs_failed",
  "k8s_wh_pvc_unbound",
];

const TABLE_IDS = [
  "k8s_wh_waiting_top",
  "k8s_wh_terminated_top",
  "k8s_wh_hpa_limited",
  "k8s_wh_deploy_short_top",
  "k8s_wh_sts_short_top",
  "k8s_wh_ds_unavailable_top",
  "k8s_wh_jobs_failed_top",
  "k8s_wh_pvc_unbound_top",
];

/** Real failure reasons, as opposed to the transient startup states. */
const FAILURE_REASONS = [
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "ErrImageNeverPull",
  "CreateContainerConfigError",
];

describe("health — shape", () => {
  it("sits directly after overview, ahead of utilization", () => {
    // Triage first: a reader who opened the page because something is wrong should
    // reach "what is broken" before "what is wasteful".
    const ids = kubernetesPage.sections.map((s: any) => s.id);
    expect(ids[0]).toBe("overview");
    expect(ids[1]).toBe(SECTION_ID);
    expect(ids.indexOf(SECTION_ID)).toBeLessThan(ids.indexOf("utilization"));
  });

  it("holds exactly the 14 designed panels in tile-then-table order", () => {
    expect(panels().map((p: any) => p.id)).toEqual([...TILE_IDS, ...TABLE_IDS]);
  });

  it("every panel declares exactly one variant with exactly one query", () => {
    // `variants: []` passes every for-loop in this file vacuously and then crashes
    // at resolve.ts:964 where selectedVariant! is dereferenced.
    for (const p of panels()) {
      expect(p.variants.length, `${p.id} must declare one variant`).toBe(1);
      expect(p.variants[0].queries.length, `${p.id} must declare one query`).toBe(1);
    }
  });

  it("scopes by cluster and namespace, and declares no pod picker", () => {
    // The tables list pods as ROWS, so scoping their input by pod is circular.
    expect(section().scopedBy).toEqual(["cluster", "namespace"]);
  });

  it("every panel reads the kube-state group", () => {
    // Every metric here is kube-state. A kubeletstats group would resolve the ${f:}
    // concepts to k8s_namespace_name/k8s_pod_name, which these streams do not have.
    for (const p of panels()) expect(p.groupId, p.id).toBe("kube-state");
  });
});

describe("health — the waiting table ranks failures above transient states", () => {
  // Measured live, and the crowding-out is REAL, not theoretical: 39 waiting rows
  // against a topk(20) cap. Every series is a single 0/1 datapoint, so an unweighted
  // topk orders arbitrarily and returned {PodInitializing 12, CrashLoopBackOff 5,
  // ContainerCreating 3} — it showed 5 of 9 crash loops and dropped ImagePullBackOff
  // ENTIRELY, spending 15 of 20 slots on healthy starting pods. The same query with
  // failures weighted x2 returned {CrashLoopBackOff 9, ImagePullBackOff 1,
  // PodInitializing 9, ContainerCreating 1} — every failure kept, transient rows
  // filling the remainder. So the weight is load-bearing, not decoration.
  //
  // At the row grouping the table uses, each series is one datapoint, so a failure
  // is exactly 2 and a transient exactly 1. (A COARSER `sum by (reason)` would let
  // group size compete with the weight — 25 PodInitializing rows sum to 25 and
  // outrank 9 crash loops at 18 — which is why the grouping key is pinned below.)
  it("weights the failure reasons above the unfiltered set", () => {
    const [query] = queriesOf("k8s_wh_waiting_top");
    expect(query, "failures must outrank transient states").toContain("* 2 or");
    for (const reason of FAILURE_REASONS) {
      expect(query, `${reason} must be in the priority set`).toContain(reason);
    }
  });

  it("groups at the row level, so the weight cannot be swamped by group size", () => {
    // The weight only orders correctly when each group is ONE series. A coarser key
    // (e.g. by reason alone) makes 25 transient rows sum to 25 and outrank 9 weighted
    // failures at 18 — measured.
    const [query] = queriesOf("k8s_wh_waiting_top");
    for (const clause of [...query.matchAll(/sum by \(([^)]*)\)/g)]) {
      const labels = clause[1].split(",").map((l) => l.trim());
      expect(labels, "the waiting table must group by the full row identity").toEqual([
        "${f:k8s-cluster}",
        "${f:k8s-namespace}",
        "${f:k8s-pod-name}",
        "${f:k8s-container-name}",
        "reason",
      ]);
    }
  });

  it("still shows the transient states rather than filtering them out", () => {
    // The `or` arm is the unfiltered selector: a novel reason nobody predicted still
    // renders, which an allowlist-only table would silently drop.
    const [query] = queriesOf("k8s_wh_waiting_top");
    const arms = query.split(" or ");
    expect(arms, "expected a weighted arm and an unfiltered arm").toHaveLength(2);
    expect(arms[1], "the second arm must not filter by reason").not.toContain("reason=~");
  });

  it("the failing-to-start TILE filters to real failures only", () => {
    // A tile is one scalar with nowhere to put the caveat: counting the transient
    // states would make it spike during any healthy rollout (measured 10 transient
    // vs 11 failing). Filter where you cannot explain; explain where you cannot filter.
    const [query] = queriesOf("k8s_wh_containers_failing");
    for (const reason of FAILURE_REASONS) expect(query).toContain(reason);
    expect(query, "the tile must not count normal startup").not.toContain("PodInitializing");
    expect(query, "the tile must not count normal startup").not.toContain("ContainerCreating");
  });
});

describe("health — a shortfall states severity, not a bare difference", () => {
  // "2.00" is ambiguous: it could be 2 of 3 ready (mild) or desired 2 with 0 ready
  // (a total outage). Measured on common-dev, o2synthetic-openobserve-ingester is
  // desired=2 ready=0 current=0 — completely down — and the old panel rendered that
  // identically to a 5-of-3 partial degradation. Every degraded controller on this
  // fleet is in fact at 0.0 ready.
  //
  // A readiness FRACTION is unambiguous by construction: 0 = nothing running,
  // 0.67 = two of three. Two value columns are not an option — a second query
  // renders as extra ROWS, not columns (verified through the real converter), and
  // PromQL cannot turn a value into a label.
  it("the controller tables rank on readiness, never on a raw subtraction", () => {
    for (const id of ["k8s_wh_deploy_short_top", "k8s_wh_sts_short_top"]) {
      const [query] = queriesOf(id);
      expect(query, `${id} must report a readiness fraction`).toContain(" / ");
      expect(query, `${id} must not rank on a bare difference`).not.toContain(" - ");
      expect(query, `${id} must select the degraded set`).toMatch(/<\s*1/);
    }
  });

  it("both sides of the readiness ratio carry the same scope", () => {
    // Scoping one operand produces a ratio against a fleet-wide denominator — a
    // plausible-looking number that is silently wrong.
    for (const id of ["k8s_wh_deploy_short_top", "k8s_wh_sts_short_top"]) {
      const [query] = queriesOf(id);
      for (const side of query.split(" / ")) {
        if (!/[a-z_]+\{/.test(side)) continue;
        expect(side, `${id}: operand without cluster scope`).toContain("${scope:cluster}");
        expect(side, `${id}: operand without namespace scope`).toContain("${scope:namespace}");
      }
    }
  });

  it("the readiness tables render as a percentage", () => {
    for (const id of ["k8s_wh_deploy_short_top", "k8s_wh_sts_short_top"]) {
      expect(panel(id).unit, `${id} reports a 0..1 fraction`).toBe("percent-1");
    }
  });
});

describe("health — count tiles use the lint-legal aggregation form", () => {
  // Lint rule 14 scans EVERY by(...) and exempts only the fully re-aggregated
  // `count(count by (…))` spelling. `count(sum by (…) (a) - sum by (…) (b) > 0)`
  // carries non-enumerable labels and does NOT match the exemption, so it fails —
  // verified by simulating the rule's own regex. Both forms return identical
  // numbers, which is exactly why the wrong one is easy to reach for.
  it("every multi-operand tile uses count(count by (...))", () => {
    for (const id of ["k8s_wh_deploy_short", "k8s_wh_sts_short", "k8s_wh_containers_failing"]) {
      expect(queriesOf(id)[0], `${id} must use the re-aggregated form`).toContain(
        "count(count by (",
      );
    }
  });

  it("no tile uses the count(sum by (...)) spelling", () => {
    for (const id of TILE_IDS) {
      expect(queriesOf(id)[0], `${id} would fail lint rule 14`).not.toContain("count(sum by (");
    }
  });
});

describe("health — one-hot metrics carry a value test", () => {
  // kube_persistentvolumeclaim_status_phase is one-hot: 243 PVCs x 3 phases = 729
  // series, exactly one of which is 1 per PVC. Measured, `{phase!="Bound"}` with no
  // value test counts 486; with `== 1` it counts 1 — wrong by 486x. Lint rule (e)
  // polices `status=`/`condition=` ONLY, never `phase=`, so this is the sole gate.
  it("every phase selector asserts == 1", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!/phase\s*[!=]=/.test(query)) continue;
        expect(query, `${id} selects a phase without a value test`).toMatch(/==\s*1/);
      }
    }
  });

  it("every panel filters to a non-zero value, tile and table alike", () => {
    // Mutation-verified: dropping `> 0` from the DaemonSet tile and the Jobs table
    // passed all 451 tests. Live, the DaemonSet tile then reads 89 on a fleet where
    // nothing is unavailable (correct answer: empty), and the Jobs table lists 44
    // jobs of which 40 failed nothing. Lint rule (e) polices only status=/condition=
    // selectors, so nothing else guards this.
    for (const p of panels()) {
      for (const query of queriesOf(p.id)) {
        // A readiness RATIO selects the degraded set with `< 1`; a count selects it
        // with `> 0` or `== 1`. Either way a healthy row must be excluded.
        expect(query, `${p.id} would count rows with nothing wrong`).toMatch(
          /(>\s*0|==\s*1|<\s*1)/,
        );
      }
    }
  });

  it("the HPA condition selector asserts == 1 too", () => {
    // status="true" selects the series; the assertion lives in the VALUE.
    const [query] = queriesOf("k8s_wh_hpa_limited");
    expect(query).toContain('status="true"');
    expect(query).toMatch(/==\s*1/);
  });
});

describe("health — the HPA signal is the Kubernetes-native one", () => {
  // An earlier draft compared status_current_replicas >= spec_max_replicas, which
  // returned ZERO samples over a 7-day window across all ten clusters. ScalingLimited
  // is what `kubectl describe hpa` reports, catches HPAs limited by policy or missing
  // metrics, and is live now (common-dev/ecrfront/ecrfront-hpa).
  it("reads the ScalingLimited condition, not a replica comparison", () => {
    const [query] = queriesOf("k8s_wh_hpa_limited");
    expect(query).toContain('condition="ScalingLimited"');
    expect(query, "the dead current>=max comparison must not return").not.toContain(
      "spec_max_replicas",
    );
  });
});

describe("health — Jobs never group by reason", () => {
  // Measured: 40 of 52 kube_job_status_failed series carry NO `reason` label at all,
  // so grouping by it yields a blank-label row and silently drops most failures.
  it("no Job query groups by reason", () => {
    for (const id of ["k8s_wh_jobs_failed", "k8s_wh_jobs_failed_top"]) {
      for (const query of queriesOf(id)) {
        // matchAll, not match: a non-global scan reads only the FIRST by(...) clause,
        // so a second one added later would be invisible. `\bby\s*\(` also accepts
        // the no-space `by(` spelling PromQL allows.
        for (const clause of query.matchAll(/\bby\s*\(([^)]*)\)/g)) {
          expect(clause[1], `${id} must not group Jobs by reason`).not.toContain("reason");
        }
      }
    }
  });
});

describe("health — every table strips plumbing labels", () => {
  // kube-state arrives via the OTel prometheusreceiver carrying nine plumbing labels
  // (flag, service_instance_id, url_scheme, ...). A curated table renders one column
  // per label key, so a bare `metric > 0` table renders 13 columns, nine of them
  // noise. Measured, `sum by` collapses it to the 4-5 identity labels.
  it("every table aggregates with sum by", () => {
    for (const id of TABLE_IDS) {
      expect(queriesOf(id)[0], `${id} must strip plumbing labels`).toContain("sum by (");
    }
  });
});

describe("health — scope symmetry on multi-operand queries", () => {
  // Scoping one side of a subtraction produces a silently wrong shortfall. Lint rule
  // 16 fires only on `/`, so `-` is pinned here directly.
  const operands = (q: string) => q.split(" - ").filter((s) => /[a-z_]+\{/.test(s));

  it("every subtraction operand carries the cluster token", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!query.includes(" - ")) continue;
        for (const side of operands(query)) {
          expect(side, `${id}: operand without cluster scope`).toContain("${scope:cluster}");
        }
      }
    }
  });

  it("every arm of an `or` union carries the same scope tokens", () => {
    // Mutation-verified gap: stripping ${scope:namespace} from ARM 1 only passed all
    // 451 tests. Lint rule 19 cannot catch it either — it tests token presence per
    // QUERY STRING, and the mutant still contains the token in arm 2, so the rule
    // short-circuits. Live, scoped to one namespace, the mutant leaked 3 other
    // namespaces' failures into the view.
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!query.includes(" or ")) continue;
        const arms = query.split(" or ");
        for (const token of ["${scope:cluster}", "${scope:namespace}"]) {
          const armsWith = arms.filter((a) => a.includes(token)).length;
          expect(
            armsWith === 0 || armsWith === arms.length,
            `${id}: ${token} is on ${armsWith} of ${arms.length} arms`,
          ).toBe(true);
        }
      }
    }
  });

  it("a namespace-scoped subtraction carries the token on both sides", () => {
    for (const id of panels().map((p: any) => p.id)) {
      for (const query of queriesOf(id)) {
        if (!query.includes(" - ")) continue;
        const sides = operands(query);
        const withNs = sides.filter((s) => s.includes("${scope:namespace}")).length;
        expect(withNs === 0 || withNs === sides.length, `${id}: half-namespaced subtraction`).toBe(
          true,
        );
      }
    }
  });
});

describe("health — instant reads, units and titles", () => {
  it("every panel is an instant query", () => {
    // Health answers "what is broken NOW". A range read would list one row per series
    // seen anywhere in the window and contradict the tiles above.
    for (const p of panels()) {
      for (const v of p.variants) expect(v.queryMode, `${p.id}`).toBe("instant");
    }
  });

  it("counts render as numbers; the readiness tables render as percentages", () => {
    // The two controller tables report a 0..1 readiness fraction — a bare shortfall
    // could not tell a total outage from a partial one. Everything else counts
    // objects or is a one-hot presence row.
    const READINESS = ["k8s_wh_deploy_short_top", "k8s_wh_sts_short_top"];
    for (const p of panels()) {
      expect(p.unit, `${p.id}`).toBe(READINESS.includes(p.id) ? "percent-1" : "numbers");
      for (const v of p.variants) expect(v.unit, `${p.id} variant override`).toBeUndefined();
    }
  });

  it("every table title discloses its topk N", () => {
    for (const id of TABLE_IDS) {
      const n = queriesOf(id)[0].match(/topk\((\d+),/);
      expect(n, `${id} has no topk`).not.toBeNull();
      expect(copy(panel(id).titleKey)).toContain(n![1]);
    }
  });

  it("every title marks the instant read", () => {
    for (const p of panels()) {
      expect(copy(p.titleKey).toLowerCase(), `${p.id}`).toContain("(now)");
    }
  });

  it("no tile title claims a top-N it does not have", () => {
    for (const id of TILE_IDS) {
      expect(copy(panel(id).titleKey)).not.toMatch(/\btop\s*\d+\b/i);
    }
  });
});

describe("health — fleet-wide tiles are declared, never silent", () => {
  it("every tile declares fleetWide for namespace", () => {
    // A tile answers "is anything wrong in this cluster"; pre-filtering it to one
    // namespace defeats its purpose. Lint rule 19 requires the omission be declared.
    for (const id of TILE_IDS) {
      expect(panel(id).fleetWide, `${id}`).toEqual(["namespace"]);
    }
  });

  it("every table honours the namespace filter", () => {
    for (const id of TABLE_IDS) {
      expect(panel(id).fleetWide, `${id} should respect the namespace picker`).toBeUndefined();
      expect(queriesOf(id)[0], `${id} must carry the namespace token`).toContain(
        "${scope:namespace}",
      );
    }
  });
});

describe("health — requiresStreams completeness", () => {
  it("every metric a query reads is declared", () => {
    // A variant is satisfiable only when ALL its streams are present and live
    // (resolve.ts:405-414); a missing declaration renders half a subtraction.
    for (const id of panels().map((p: any) => p.id)) {
      for (const variant of panel(id).variants) {
        const declared: string[] = variant.requiresStreams ?? [];
        const used = new Set(
          variant.queries
            .flatMap((q: any) => [...String(q.query).matchAll(/\b(?:k8s_pod_\w+|kube_\w+)/g)])
            .map((m: any) => m[0]),
        );
        for (const metric of used) {
          expect(declared, `${id} reads ${metric} without declaring it`).toContain(metric);
        }
      }
    }
  });

  it("element 0 of requiresStreams is the stream the query anchors on", () => {
    // resolve.ts:432 assigns requiresStreams[0] to queryStream, which drives both the
    // drilldown and the schema consulted for every ${f:} concept.
    for (const id of panels().map((p: any) => p.id)) {
      const first = panel(id).variants[0].requiresStreams?.[0];
      expect(first, `${id} has no schema stream`).toBeTruthy();
      expect(queriesOf(id)[0], `${id}: requiresStreams[0] is not queried`).toContain(first!);
    }
  });
});

describe("health — drilldown targets each panel's own stream", () => {
  it("every panel carries a byUrl drilldown on its own first stream", () => {
    // Lint rules 30/31 check the base64 query but never `stream_name`, and the pack
    // helper takes the stream as a positional second argument.
    for (const p of panels()) {
      const entry: any = (p.drilldown ?? []).find((d: any) => d.type === "byUrl");
      expect(entry, `${p.id} has no byUrl drilldown`).toBeDefined();
      const url = new URL(entry.data.url, "http://localhost");
      expect(url.searchParams.get("stream_name"), `${p.id}`).toBe(p.variants[0].requiresStreams[0]);
    }
  });
});

describe("health — layout", () => {
  it("the six tiles are w:32 h:6 and fill the grid row exactly", () => {
    for (const id of TILE_IDS) expect(panel(id).layout, id).toEqual({ w: 32, h: 6 });
    expect(TILE_IDS.reduce((sum, id) => sum + panel(id).layout.w, 0)).toBe(192);
  });

  it("every table is w:96 h:16", () => {
    for (const id of TABLE_IDS) expect(panel(id).layout, id).toEqual({ w: 96, h: 16 });
  });
});

describe("health — the section note discloses the transient-reason caveat", () => {
  it("names both transient states so the reader is never misled", () => {
    // Asserted against RESOLVED copy: deleting the caveat fails the build.
    const note = copy(section().noteKey);
    expect(note).toContain("ContainerCreating");
    expect(note).toContain("PodInitializing");
    expect(note).toContain("CrashLoopBackOff");
  });

  it("says the tiles count objects and ignore the namespace filter", () => {
    const note = copy(section().noteKey).toLowerCase();
    expect(note).toContain("namespace");
    expect(note).toMatch(/object/);
  });

  it("discloses that termination reasons show only the last exit", () => {
    // kube-state exposes only the LAST termination reason, so an OOM followed by any
    // other exit is lost. The panel must not imply a full history.
    expect(copy(section().noteKey).toLowerCase()).toMatch(/last/);
  });
});

describe("health — an empty panel reads as ALL CLEAR, not as missing data", () => {
  // kube-state omits a family entirely when nothing is in that state: on a healthy
  // cluster kube_job_status_failed has no series at all, so PromQL count() returns
  // an EMPTY VECTOR, never 0. Measured, no query idiom can manufacture the zero —
  // `or vector(0)` is unsupported here and actually BREAKS the query (a working 4
  // became empty), and sum()/`> bool 0`/unfiltered count() all stay empty. So the
  // distinction has to be carried to the renderer as intent.
  it("the section declares that empty means healthy", () => {
    expect(section().emptyMeansHealthy, "health is a triage tab: empty is good news").toBe(true);
  });

  it("no OTHER section claims it — an empty Utilization panel really is missing data", () => {
    for (const other of kubernetesPage.sections as any[]) {
      if (other.id === SECTION_ID) continue;
      expect(other.emptyMeansHealthy, `${other.id} must keep saying No Data`).toBeUndefined();
    }
  });
});

describe("health — i18n", () => {
  it("every title and the section note resolve to en-US copy", () => {
    expect(copy(section().titleKey)).toBeTruthy();
    expect(copy(section().noteKey)).toBeTruthy();
    for (const p of panels()) expect(copy(p.titleKey)).toBeTruthy();
  });
});
