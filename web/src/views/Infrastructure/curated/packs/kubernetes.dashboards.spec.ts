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

import { describe, it, expect } from "vitest";
import { queryText } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";
import { lintManifest } from "../resolve";
import { GROUP } from "../types";
import { kubernetesPage } from "./kubernetes.page";
import { curatedPacks } from "./index";
import { NODE_PICKER, addNodeScope, kubernetesDashboardLayouts } from "./kubernetes.dashboards";

const pagePanels = kubernetesPage.sections.flatMap((section) => section.panels);
const layout = (key: string) => kubernetesDashboardLayouts.find((entry) => entry.key === key)!;
const panelsOf = (key: string) => layout(key).manifest.sections.flatMap((s) => s.panels);
const sectionIds = (key: string) => layout(key).manifest.sections.map((s) => s.id);
const pickerNames = (key: string) => layout(key).manifest.scopePickers.map((p) => p.name);

describe("kubernetes ready-made manifests — layout", () => {
  it("are the catalog's four, in its order, and never a curated page", () => {
    expect(kubernetesDashboardLayouts.map((entry) => entry.key)).toEqual([
      "cluster",
      "node",
      "pod",
      "workload",
    ]);
    expect(Object.values(curatedPacks)).not.toContain(layout("cluster").manifest);
  });

  it("cluster = inventory (with the fleet bars), health, utilization; no quadrant", () => {
    expect(sectionIds("cluster")).toEqual(["inventory", "health", "utilization"]);
    const ids = panelsOf("cluster").map((p) => p.id);
    expect(ids).toContain("k8s_sm_fleet_cpu");
    expect(ids).toContain("k8s_sm_fleet_memory");
    expect(ids).not.toContain("k8s_sm_fleet_quadrant");
    expect(pickerNames("cluster")).toEqual(["cluster", "namespace"]);
  });

  it("node = the nodes section behind a node picker; pod = workloads; workload = one tab per kind", () => {
    expect(sectionIds("node")).toEqual(["nodes"]);
    expect(pickerNames("node")).toEqual(["cluster", "node"]);
    expect(sectionIds("pod")).toEqual(["pods"]);
    expect(pickerNames("pod")).toEqual(["cluster", "namespace", "pod"]);
    expect(sectionIds("workload")).toEqual(["deployments", "statefulsets", "daemonsets", "jobs"]);
    expect(pickerNames("workload")).toEqual(["cluster", "namespace"]);
  });

  it("every curated panel but the quadrant lands on some dashboard", () => {
    const placed = new Set(kubernetesDashboardLayouts.flatMap((entry) => panelsOf(entry.key)));
    const placedIds = new Set([...placed].map((p) => p.id));
    const missing = pagePanels.map((p) => p.id).filter((id) => !placedIds.has(id));
    expect(missing).toEqual(["k8s_sm_fleet_quadrant"]);
  });
});

describe("shared panels reuse the pack's own objects", () => {
  it("cluster, pod and workload carry the SAME variant objects as the curated page", () => {
    for (const key of ["cluster", "pod", "workload"]) {
      for (const panel of panelsOf(key)) {
        const page = pagePanels.find((p) => p.id === panel.id);
        if (!page) continue;
        expect(panel.variants, `${key}/${panel.id}`).toBe(page.variants);
      }
    }
  });

  it("node panels differ from the page ONLY by the node matcher", () => {
    for (const panel of panelsOf("node")) {
      const page = pagePanels.find((p) => p.id === panel.id)!;
      const ours = panel.variants.flatMap((v) => v.queries.map((q) => q.query));
      const theirs = page.variants.flatMap((v) => v.queries.map((q) => q.query));
      expect(ours.every((query) => query.includes("${scope:node}"))).toBe(true);
      expect(ours.map((query) => query.replace(/,\$\{scope:node\}/g, ""))).toEqual(
        theirs.map((query) => query.replace(/(\w)\$\{scope:cluster\}/g, "$1{${scope:cluster}}")),
      );
    }
  });
});

describe("addNodeScope", () => {
  it("joins the cluster matcher inside braces", () => {
    expect(addNodeScope('m{status="true",${scope:cluster}} == 1')).toBe(
      'm{status="true",${scope:cluster},${scope:node}} == 1',
    );
  });

  it("brings its own braces where the cluster token stood alone", () => {
    expect(addNodeScope("avg by (${f:k8s-node-name}) (m${scope:cluster})")).toBe(
      "avg by (${f:k8s-node-name}) (m{${scope:cluster},${scope:node}})",
    );
    expect(addNodeScope("irate(m${scope:cluster}[5m])")).toBe(
      "irate(m{${scope:cluster},${scope:node}}[5m])",
    );
  });

  it("leaves a query with no cluster scope alone", () => {
    expect(addNodeScope("sum(m)")).toBe("sum(m)");
  });
});

describe("the node picker", () => {
  it("reads kube-state's node label, narrowed by cluster", () => {
    expect(NODE_PICKER).toMatchObject({
      name: "node",
      group: GROUP.node,
      valuesFrom: { groupId: "kube-state", stream: "kube_node_status_condition" },
      multiSelect: true,
      chainedOn: [{ picker: "cluster" }],
    });
    expect(NODE_PICKER.defaultFirstValue).toBeUndefined();
  });
});

describe("workload replica panels", () => {
  const SCOPE = { ksm: "${scope:cluster},${scope:namespace}", kubelet: null };

  it.each([
    ["k8s_rm_deploy_replicas", "D1", "D2"],
    ["k8s_rm_sts_replicas", "SS1", "SS2"],
    ["k8s_rm_ds_replicas", "DS1", "DS5"],
  ] as const)("%s wraps the explorer's own %s / %s queries", (id, desired, ready) => {
    const panel = panelsOf("workload").find((p) => p.id === id)!;
    expect(panel.variants[0].queries.map((q) => q.query)).toEqual([
      `topk(10, ${queryText(desired, SCOPE)})`,
      `topk(10, ${queryText(ready, SCOPE)})`,
    ]);
  });
});

describe("governance", () => {
  it.each(kubernetesDashboardLayouts.map((entry) => [entry.key, entry] as const))(
    "%s passes lintManifest (values-from aside: pickers share the page's sources)",
    (_key, entry) => {
      const violations = lintManifest(entry.manifest).filter((v) => v.rule !== "values-from");
      expect(violations).toEqual([]);
    },
  );

  it("every link targets a real dashboard and section", () => {
    for (const entry of kubernetesDashboardLayouts) {
      const ids = new Set(panelsOf(entry.key).map((p) => p.id));
      for (const [panelId, link] of Object.entries(entry.links)) {
        expect(ids.has(panelId), `${entry.key} links unknown ${panelId}`).toBe(true);
        if (link.section) expect(sectionIds(link.to)).toContain(link.section);
      }
    }
  });
});
