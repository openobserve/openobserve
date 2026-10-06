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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/stores";
import WorkloadDetails from "./WorkloadDetails.vue";
import RelatedPodsTable from "./RelatedPodsTable.vue";
import { buildInventory, type AnyRow, type Inventory, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { joinObjects, parseObjects } from "./kubernetesObjects";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", namespace: "shop", ...metric },
  value,
});
const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const pod = (name: string, extra: Record<string, string> = {}) =>
  ksm({ pod: name, uid: `${name}-u`, ...extra });

const OTableStub = defineComponent({
  name: "OTable",
  props: { data: Array, columns: Array },
  setup(props, { slots }) {
    return () =>
      h(
        "div",
        { "data-test": "table" },
        (props.data as any[]).map((row) =>
          h(
            "div",
            { "data-test": "row", "data-name": row.name },
            (props.columns as any[]).map((col) =>
              h(
                "span",
                { "data-col": col.id },
                slots[`cell-${col.id}`]?.({ row }) ?? String(col.accessorFn?.(row) ?? ""),
              ),
            ),
          ),
        ),
      );
  },
});

const inventory: Inventory = buildInventory(
  results({
    D1: [ksm({ deployment: "web" }, 3), ksm({ deployment: "other" }, 1)],
    D2: [ksm({ deployment: "web" }, 2)],
    D3: [ksm({ deployment: "web" }, 3)],
    D4: [ksm({ deployment: "web" }, 2)],
    D6: [ksm({ deployment: "web" }, 1)],
    P5: [
      ksm({ replicaset: "web-abc", owner_kind: "Deployment", owner_name: "web" }),
      ksm({ replicaset: "web-old", owner_kind: "Deployment", owner_name: "web" }),
      ksm({ replicaset: "other-1", owner_kind: "Deployment", owner_name: "other" }),
    ],
    RS2: [
      ksm({ replicaset: "web-old" }, 0),
      ksm({ replicaset: "web-abc" }, 3),
      ksm({ replicaset: "other-1" }, 1),
    ],
    RS4: [ksm({ replicaset: "web-abc" }, 2), ksm({ replicaset: "web-old" }, 0)],
    P1: [
      pod("web-abc-1", { phase: "Running" }),
      pod("web-abc-2", { phase: "Pending" }),
      pod("other-1-x", { phase: "Running" }),
    ],
    P4: [
      pod("web-abc-1", { owner_kind: "ReplicaSet", owner_name: "web-abc" }),
      pod("web-abc-2", { owner_kind: "ReplicaSet", owner_name: "web-abc" }),
      pod("other-1-x", { owner_kind: "ReplicaSet", owner_name: "other-1" }),
    ],
    P10: [
      pod("web-abc-1", { container: "app", image: "shop/web:2" }),
      pod("web-abc-2", { container: "app", image: "shop/web:2" }),
      pod("web-abc-2", { container: "proxy", image: "envoy:1" }),
      pod("other-1-x", { container: "app", image: "shop/other:1" }),
    ],
    CJ1: [ksm({ cronjob: "nightly-report", schedule: "0 2 * * *" })],
    CJ2: [ksm({ cronjob: "nightly-report" }, 0)],
    CJ3: [ksm({ cronjob: "nightly-report" }, 1)],
    J1: [ksm({ job_name: "nightly-report-1" }, 0), ksm({ job_name: "nightly-report-2" }, 0)],
    J3: [ksm({ job_name: "nightly-report-2", reason: "BackoffLimitExceeded" }, 1)],
    J5: [ksm({ job_name: "nightly-report-1" })],
    J7: [
      ksm({ job_name: "nightly-report-1", owner_kind: "CronJob", owner_name: "nightly-report" }),
      ksm({ job_name: "nightly-report-2", owner_kind: "CronJob", owner_name: "nightly-report" }),
    ],
    V1: [ksm({ persistentvolumeclaim: "data-db-0", phase: "Bound" })],
    V2: [ksm({ persistentvolumeclaim: "data-db-0", storageclass: "gp3" })],
    V3: [ksm({ persistentvolumeclaim: "data-db-0" }, 10 * 1024 ** 3)],
    K7: [
      {
        metric: {
          k8s_cluster_name: "prod",
          k8s_namespace_name: "shop",
          k8s_pod_name: "db-0",
          k8s_persistentvolumeclaim_name: "data-db-0",
        },
        value: 1,
      },
    ],
    H1: [ksm({ horizontalpodautoscaler: "web" }, 5), ksm({ horizontalpodautoscaler: "lone" }, 4)],
    H2: [ksm({ horizontalpodautoscaler: "web" }, 1)],
    H3: [ksm({ horizontalpodautoscaler: "web" }, 2)],
    H4: [ksm({ horizontalpodautoscaler: "web", condition: "AbleToScale", status: "true" })],
    H8: [
      ksm({
        horizontalpodautoscaler: "web",
        scaletargetref_kind: "Deployment",
        scaletargetref_name: "web",
      }),
    ],
    NS1: [ksm({ phase: "Active" })],
  }),
);

const find = <T extends AnyRow>(rows: T[], name: string) => rows.find((r) => r.name === name)!;

const mountRow = (row: AnyRow) =>
  mount(WorkloadDetails, {
    props: { row, inventory, end: 0 },
    global: {
      plugins: [i18n, store],
      stubs: { OTable: OTableStub, RelatedPodsTable: true },
    },
  });

const value = (wrapper: ReturnType<typeof mountRow>, id: string) =>
  wrapper.find(`[data-test="k8s2-wl-${id}"] dd`).text();

describe("WorkloadDetails: Deployment", () => {
  const row = find(inventory.deployments, "web");

  it("shows the replicas line from D1–D4 and D6", () => {
    expect(value(mountRow(row), "replicas")).toBe(
      "3 desired, 2 updated, 3 total, 2 available, 1 unavailable",
    );
  });

  it("lists exactly its owned ReplicaSets, by pods descending", () => {
    const revisions = mountRow(row).find('[data-test="k8s2-wl-revisions"]');
    expect(revisions.findAll('[data-test="row"]').map((r) => r.attributes("data-name"))).toEqual([
      "web-abc",
      "web-old",
    ]);
    expect(revisions.find('[data-name="web-abc"] [data-col="pods"]').text()).toBe("2/3");
  });

  it("links a revision to its ReplicaSet drawer", async () => {
    const wrapper = mountRow(row);
    await wrapper
      .find('[data-test="k8s2-wl-revisions"] [data-name="web-abc"] [data-col="name"] button')
      .trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "replicaset", cluster: "prod", namespace: "shop", name: "web-abc" }],
    ]);
  });

  it("shows member images, pod status counts and a pods table of the resolved members", () => {
    const wrapper = mountRow(row);
    expect(value(wrapper, "images")).toContain("envoy:1");
    expect(value(wrapper, "images")).toContain("shop/web:2");
    expect(value(wrapper, "images")).not.toContain("shop/other:1");
    expect(value(wrapper, "pod-status")).toBe("Running: 1 Pending: 1 Failed: 0");
    const pods = wrapper.findComponent(RelatedPodsTable).props("pods") as any[];
    expect(pods.map((p) => p.name).sort()).toEqual(["web-abc-1", "web-abc-2"]);
  });

  it("derives Available only from replica counts and says so", () => {
    expect(value(mountRow(find(inventory.deployments, "other")), "conditions")).toBe("—");
  });

  it("shows the observed selector and strategy", () => {
    const copy = buildInventory(results({ D1: [ksm({ deployment: "web" }, 3)] }));
    joinObjects(
      copy,
      "deployment",
      "prod",
      parseObjects([
        {
          uid: "d-uid",
          event_name: "web",
          k8s_namespace_name: "shop",
          body_type: "MODIFIED",
          body_object_metadata: "{}",
          body_object_spec: JSON.stringify({
            selector: { matchLabels: { app: "web" } },
            strategy: { type: "RollingUpdate" },
          }),
          body_object_status: "{}",
        },
      ]),
    );
    const wrapper = mountRow(copy.deployments[0]);
    expect(value(wrapper, "selector")).toContain("app=web");
    expect(value(wrapper, "strategy")).toContain("RollingUpdate");
  });
});

describe("WorkloadDetails: CronJob, Job, PVC, HPA, Namespace", () => {
  it("lists the CronJob's J7 jobs with their conditions", async () => {
    const wrapper = mountRow(find(inventory.cronjobs, "nightly-report"));
    expect(value(wrapper, "schedule")).toBe("0 2 * * *");
    expect(value(wrapper, "active")).toBe("1");
    expect(value(wrapper, "suspend")).toBe("false");
    const jobs = wrapper.find('[data-test="k8s2-wl-jobs"]');
    expect(jobs.findAll('[data-test="row"]').map((r) => r.attributes("data-name"))).toEqual([
      "nightly-report-1",
      "nightly-report-2",
    ]);
    expect(jobs.find('[data-name="nightly-report-1"] [data-col="condition"]').text()).toBe(
      "Complete",
    );
    expect(jobs.find('[data-name="nightly-report-2"] [data-col="condition"]').text()).toBe(
      "Failed",
    );
    await jobs.find('[data-name="nightly-report-2"] [data-col="name"] button').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "job", cluster: "prod", namespace: "shop", name: "nightly-report-2" }],
    ]);
    expect(wrapper.findComponent(RelatedPodsTable).exists()).toBe(false);
  });

  it("shows a Job's conditions", () => {
    const wrapper = mountRow(find(inventory.jobs, "nightly-report-2"));
    expect(value(wrapper, "conditions")).toContain("Failed");
  });

  it("links a PVC's pods from K7", async () => {
    const wrapper = mountRow(find(inventory.pvcs, "data-db-0"));
    expect(value(wrapper, "storage-class")).toBe("gp3");
    expect(value(wrapper, "status")).toBe("Bound");
    await wrapper.find('[data-test="k8s2-wl-pods"] button').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "pod", cluster: "prod", namespace: "shop", name: "db-0" }],
    ]);
  });

  it("links an HPA's reference from H8, and shows — without it", async () => {
    const wrapper = mountRow(find(inventory.hpas, "web"));
    expect(value(wrapper, "min")).toBe("1");
    expect(value(wrapper, "max")).toBe("5");
    expect(value(wrapper, "status")).toContain("AbleToScale");
    await wrapper.find('[data-test="k8s2-wl-reference"] button').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "deployment", cluster: "prod", namespace: "shop", name: "web" }],
    ]);
    const lone = mountRow(find(inventory.hpas, "lone"));
    expect(value(lone, "reference")).toBe("—");
    expect(lone.find('[data-test="k8s2-wl-reference"] button').exists()).toBe(false);
  });

  it("shows a namespace's status", () => {
    expect(value(mountRow(inventory.namespaces[0]), "status")).toBe("Active");
  });
});
