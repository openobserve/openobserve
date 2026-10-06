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

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";
import type { Component } from "vue";
import { DialogContent } from "reka-ui";
import i18n from "@/locales";
import store from "@/stores";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import K8sDetailsDrawer from "./K8sDetailsDrawer.vue";
import { buildInventory, findRow, rowKey, type Inventory, type Series } from "./kubernetesModel";
import type { DetailKind, QueryId } from "./kubernetesQueries";
import type { DetailsRef } from "./kubernetesUrlState";
import { joinObjects, parseObjects } from "./kubernetesObjects";
import type { EventRow } from "./kubernetesEvents";
import { resolvePodLogs } from "./podLogsLink";

const renderer = vi.hoisted(() => ({ mounts: 0, props: [] as any[] }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "PanelSchemaRenderer",
      props: ["panelSchema", "selectedTimeObj", "variablesData", "forceLoad", "searchType"],
      setup(props) {
        renderer.mounts += 1;
        renderer.props.push(props);
        return () => h("div", { "data-test": "renderer" });
      },
    }),
  };
});

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent } = await import("vue");
  return {
    ...actual,
    DialogPortal: defineComponent(
      (_, { slots }) =>
        () =>
          slots.default?.(),
    ),
  };
});

// The chart's request transport, the last seam before the network, for the real-loader case.
const streamMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: streamMock,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
    resetAuthToken: vi.fn(),
  }),
}));

vi.mock("./podLogsLink", () => ({ resolvePodLogs: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toastMock(...a) }));

enableAutoUnmount(afterEach);

const RANGE = { start: 1_759_000_000_000_000, end: 1_759_003_600_000_000 };

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", namespace: "shop", ...metric },
  value,
});
const kub = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster_name: "prod", ...metric },
  value,
});
const pod = (name: string, extra: Record<string, string> = {}) =>
  ksm({ pod: name, uid: `${name}-u`, ...extra });
const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const buildFixture = (): Inventory =>
  buildInventory(
    results({
      P1: ["web-abc-1", "web-abc-2", "agent-x", "db-0"].map((p) => pod(p, { phase: "Running" })),
      P4: [
        pod("web-abc-1", { owner_kind: "ReplicaSet", owner_name: "web-abc" }),
        pod("web-abc-2", { owner_kind: "ReplicaSet", owner_name: "web-abc" }),
        pod("agent-x", { owner_kind: "DaemonSet", owner_name: "agent" }),
        pod("db-0", { owner_kind: "StatefulSet", owner_name: "db" }),
      ],
      P5: [ksm({ replicaset: "web-abc", owner_kind: "Deployment", owner_name: "web" })],
      P6: [pod("web-abc-1", { node: "n1" }), pod("web-abc-2", { node: "n1" })],
      K1: [
        kub(
          {
            k8s_namespace_name: "shop",
            k8s_pod_name: "web-abc-1",
            k8s_pod_uid: "web-abc-1-u",
          },
          0.2,
        ),
        kub({ k8s_namespace_name: "shop", k8s_pod_name: "web-abc-2" }, 0.1),
      ],
      N1: [ksm({ node: "n1", condition: "Ready", status: "true", namespace: "" })],
      K3: [kub({ k8s_node_name: "n1" }, 1)],
      D1: [ksm({ deployment: "web" }, 2)],
      RS2: [ksm({ replicaset: "web-abc" }, 2)],
      DS1: [ksm({ daemonset: "agent" }, 1)],
      SS1: [ksm({ statefulset: "db" }, 1)],
      J1: [ksm({ job_name: "nightly-report-29854200" }, 0)],
      J7: [
        ksm({
          job_name: "nightly-report-29854200",
          owner_kind: "CronJob",
          owner_name: "nightly-report",
        }),
      ],
      CJ1: [ksm({ cronjob: "nightly-report", schedule: "0 2 * * *" })],
      V1: [ksm({ persistentvolumeclaim: "data-db-0", phase: "Bound" })],
      H1: [ksm({ horizontalpodautoscaler: "web" }, 3)],
      NS1: [ksm({ phase: "Active" })],
    }),
  );

const ALL_STREAMS = () => true;

const refOf = (kind: DetailKind, name: string): DetailsRef => ({
  kind,
  cluster: "prod",
  namespace: kind === "node" || kind === "namespace" ? "" : "shop",
  name,
});

const rowOf = (inventory: Inventory, ref: DetailsRef) =>
  findRow(inventory, ref.kind, rowKey(ref.kind, ref.cluster, ref.namespace, ref.name));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/logs", component: { template: "<div />" } },
  ],
});

let inventory: Inventory;

const mountDrawer = (ref: DetailsRef, extra: Record<string, unknown> = {}) =>
  mount(K8sDetailsDrawer, {
    props: {
      details: ref,
      row: rowOf(inventory, ref),
      inventory,
      pending: false,
      observed: false,
      eventsScoped: true,
      events: [],
      range: RANGE,
      refreshNonce: 0,
      orgId: "org1",
      hasStream: ALL_STREAMS,
      anchor: "#k8s2-body",
      ...extra,
    },
    global: { plugins: [i18n, store, router] },
  });

type Wrapper = ReturnType<typeof mountDrawer>;

const lastRenderer = () => renderer.props[renderer.props.length - 1];

const queries = () => lastRenderer().panelSchema.queries.map((q: any) => q.query);

const tabIds = (wrapper: Wrapper) =>
  wrapper
    .findAll('[data-test^="k8s2-drawer-tab-"]')
    .map((b) => b.attributes("data-test")!.replace("k8s2-drawer-tab-", ""));

const clickTab = async (wrapper: Wrapper, id: string) => {
  await wrapper.find(`[data-test="k8s2-drawer-tab-${id}"]`).trigger("click");
  await flushPromises();
};

const dd = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"] dd`);

const event = (n: number, type = "Normal"): EventRow => ({
  key: `e${n}`,
  type,
  reason: "Pulled",
  note: `message ${n}`,
  object: { kind: "Pod", name: "web-abc-1", namespace: "shop", uid: "web-abc-1-u" },
  source: "kubelet n1",
  count: 2,
  firstSeen: null,
  lastSeen: RANGE.end - 120_000_000,
});

beforeEach(() => {
  inventory = buildFixture();
  renderer.mounts = 0;
  renderer.props = [];
  toastMock.mockReset();
  vi.mocked(resolvePodLogs).mockReset();
});

describe("K8sDetailsDrawer frame", () => {
  it("is a large, seamless, non-modal right drawer anchored to the page body", () => {
    const drawer = mountDrawer(refOf("pod", "web-abc-1")).findComponent(ODrawer);
    expect(drawer.props()).toMatchObject({
      open: true,
      side: "right",
      size: "lg",
      seamless: true,
      modal: false,
      anchor: "#k8s2-body",
    });
    expect(drawer.props("title")).toBe("Pod: web-abc-1");
    expect(drawer.props("subTitle")).toBe("shop · prod");
  });

  it("keeps the same ODrawer mounted when details changes, swapping its content", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    const before = wrapper.findComponent(ODrawer).vm.$.uid;
    const next = refOf("pod", "web-abc-2");
    await wrapper.setProps({ details: next, row: rowOf(inventory, next) });
    expect(wrapper.findComponent(ODrawer).vm.$.uid).toBe(before);
    expect(wrapper.findComponent(ODrawer).props("title")).toBe("Pod: web-abc-2");
  });

  it("emits open for the node link inside the drawer", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    await wrapper.find('[data-test="k8s2-pod-node-link"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([[refOf("node", "n1")]]);
  });

  it("emits close on the close button and on Escape", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    await wrapper.find('[data-test="o-drawer-close-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    const escaped = mountDrawer(refOf("pod", "web-abc-1"));
    const panel = escaped
      .findAllComponents(DialogContent)
      .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
    await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escaped.emitted("close")).toHaveLength(1);
  });
});

describe("K8sDetailsDrawer sections", () => {
  const order = (wrapper: Wrapper) =>
    wrapper
      .findAll('[data-test^="k8s2-drawer-section-"]')
      .map((s) => s.attributes("data-test")!.replace("k8s2-drawer-section-", ""));

  it.each([
    ["pod", "web-abc-1"],
    ["node", "n1"],
    ["deployment", "web"],
    ["daemonset", "agent"],
    ["statefulset", "db"],
    ["replicaset", "web-abc"],
    ["namespace", "shop"],
    ["pvc", "data-db-0"],
  ] as const)("renders a %s drawer as Metrics, Metadata, kind, Events", (kind, name) => {
    expect(order(mountDrawer(refOf(kind, name)))).toEqual([
      "metrics",
      "metadata",
      "kind",
      "events",
    ]);
  });

  it.each([
    ["cronjob", "nightly-report"],
    ["hpa", "web"],
  ] as const)("renders a %s drawer with no Metrics block", (kind, name) => {
    expect(order(mountDrawer(refOf(kind, name)))).toEqual(["metadata", "kind", "events"]);
    expect(renderer.mounts).toBe(0);
  });
});

describe("K8sDetailsDrawer metric tabs", () => {
  it("passes the renderer its contract props over the picker range, in a sized parent", () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    const props = lastRenderer();
    expect(props.selectedTimeObj.start_time).toEqual(new Date(RANGE.start));
    expect(props.selectedTimeObj.end_time).toEqual(new Date(RANGE.end));
    expect(props.variablesData).toEqual({});
    expect(props.forceLoad).toBe(true);
    expect(props.searchType).toBe("ui");
    expect(props.panelSchema).toMatchObject({ type: "area", queryType: "promql" });
    expect(wrapper.find('[data-test="k8s2-drawer-chart"]').classes()).toContain("h-50");
    expect(wrapper.findComponent({ name: "OSparkline" }).exists()).toBe(false);
  });

  it("builds the pod tabs from the row's matcher, with the uid only when its series had it", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    expect(tabIds(wrapper)).toEqual(["cpu", "memory", "network", "filesystem"]);
    const m =
      'k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-abc-1",k8s_pod_uid="web-abc-1-u"';
    expect(queries()).toEqual([`sum(k8s_pod_cpu_usage{${m}})`]);
    await clickTab(wrapper, "memory");
    expect(queries()).toEqual([`sum(k8s_pod_memory_working_set{${m}})`]);
    await clickTab(wrapper, "network");
    expect(queries()).toEqual([`sum by (direction) (rate(k8s_pod_network_io{${m}}[5m]))`]);
    await clickTab(wrapper, "filesystem");
    expect(queries()).toEqual([`sum(k8s_pod_filesystem_usage{${m}})`]);

    mountDrawer(refOf("pod", "web-abc-2"));
    expect(queries()[0]).toBe(
      'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-abc-2"})',
    );
  });

  it("builds the node tabs, with k8s_cluster on the KSM queries", async () => {
    const wrapper = mountDrawer(refOf("node", "n1"));
    expect(tabIds(wrapper)).toEqual(["cpu", "memory", "disk", "pods"]);
    expect(queries()).toEqual([
      'sum(k8s_node_cpu_usage{k8s_cluster_name="prod",k8s_node_name="n1"})',
      'sum(kube_node_status_allocatable{k8s_cluster="prod",node="n1",resource="cpu"})',
    ]);
    await clickTab(wrapper, "disk");
    expect(queries()).toEqual([
      'sum(k8s_node_filesystem_usage{k8s_cluster_name="prod",k8s_node_name="n1"})',
      'sum(k8s_node_filesystem_capacity{k8s_cluster_name="prod",k8s_node_name="n1"})',
    ]);
    await clickTab(wrapper, "pods");
    expect(queries()).toEqual([
      'count(kube_pod_info{k8s_cluster="prod",node="n1"})',
      'sum(kube_node_status_allocatable{k8s_cluster="prod",node="n1",resource="pods"})',
    ]);
  });

  it("sums a deployment's pod tabs over exactly its current member pods, regex-escaped", () => {
    inventory.pods[0].name = "web.abc-1";
    inventory.pods[0].key = rowKey("pod", "prod", "shop", "web.abc-1");
    mountDrawer(refOf("deployment", "web"));
    expect(queries()).toEqual([
      'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name=~"web\\\\.abc-1|web-abc-2"})',
    ]);
  });

  it("scopes a namespace by k8s_namespace_name and gives a PVC a Disk tab", () => {
    mountDrawer(refOf("namespace", "shop"));
    expect(queries()).toEqual([
      'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop"})',
    ]);
    const pvc = mountDrawer(refOf("pvc", "data-db-0"));
    expect(tabIds(pvc)).toEqual(["disk"]);
    const p =
      'k8s_cluster="prod",k8s_persistentvolumeclaim_name="data-db-0",k8s_namespace_name="shop"';
    expect(queries()).toEqual([
      `sum(k8s_volume_capacity{${p}}) - sum(k8s_volume_available{${p}})`,
      `sum(k8s_volume_capacity{${p}})`,
    ]);
  });

  it("drops a tab whose stream is absent, and the block when none is left", () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"), {
      hasStream: (s: string) => s !== "k8s_pod_network_io",
    });
    expect(tabIds(wrapper)).toEqual(["cpu", "memory", "filesystem"]);
    const none = mountDrawer(refOf("pod", "web-abc-1"), { hasStream: () => false });
    expect(none.find('[data-test="k8s2-drawer-section-metrics"]').exists()).toBe(false);
  });

  it("remounts the renderer on Refresh, on a new object and on a new tab", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    expect(renderer.mounts).toBe(1);
    await wrapper.setProps({ refreshNonce: 1 });
    expect(renderer.mounts).toBe(2);
    await clickTab(wrapper, "memory");
    expect(renderer.mounts).toBe(3);
    const next = refOf("pod", "web-abc-2");
    await wrapper.setProps({ details: next, row: rowOf(inventory, next) });
    expect(renderer.mounts).toBe(4);
  });
});

describe("K8sDetailsDrawer refresh (AC 13)", () => {
  it("sends a new chart request through the real PanelSchemaRenderer loader after Refresh", async () => {
    const real = (
      await vi.importActual<{ default: Component }>(
        "@/components/dashboards/PanelSchemaRenderer.vue",
      )
    ).default;
    // jsdom has no IntersectionObserver; the loader observes the panel on mount.
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    onTestFinished(() => {
      globalThis.IntersectionObserver = original;
    });
    const chartStore = createStore({
      state: {
        selectedOrganization: { identifier: "org1" },
        timezone: "UTC",
        theme: "light",
        printMode: false,
        zoConfig: {},
        organizationData: { organizationSettings: { scrape_interval: 15 } },
      },
    });
    const ref = refOf("pod", "web-abc-1");
    const wrapper = mount(K8sDetailsDrawer, {
      props: {
        details: ref,
        row: rowOf(inventory, ref),
        inventory,
        pending: false,
        observed: true,
        eventsScoped: true,
        events: [],
        range: RANGE,
        refreshNonce: 0,
        orgId: "org1",
        hasStream: ALL_STREAMS,
        anchor: "#k8s2-body",
      },
      global: { plugins: [i18n, chartStore, router], stubs: { PanelSchemaRenderer: real } },
    });
    await flushPromises();
    await vi.waitFor(() => expect(streamMock).toHaveBeenCalled(), { timeout: 20_000 });
    const before = streamMock.mock.calls.length;
    await wrapper.setProps({ refreshNonce: 1 });
    await flushPromises();
    await vi.waitFor(() => expect(streamMock.mock.calls.length).toBeGreaterThan(before), {
      timeout: 20_000,
    });
    const payload: any = (streamMock.mock.calls.at(-1) as any[])[0];
    expect(payload.type).toBe("promql");
    expect(payload.queryReq.query).toBe(
      'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-abc-1",k8s_pod_uid="web-abc-1-u"})',
    );
  }, 30_000);
});

describe("K8sDetailsDrawer metadata", () => {
  const observePod = () =>
    joinObjects(
      inventory,
      "pod",
      "prod",
      parseObjects([
        {
          uid: "web-abc-1-u",
          event_name: "web-abc-1",
          k8s_namespace_name: "shop",
          body_type: "MODIFIED",
          body_object_metadata: JSON.stringify({
            uid: "web-abc-1-u",
            labels: { app: "web" },
            annotations: { "team/owner": "shop" },
          }),
          body_object_spec: "{}",
          body_object_status: "{}",
        },
      ]),
    );

  it("shows the KSM uid for a pod", () => {
    expect(dd(mountDrawer(refOf("pod", "web-abc-1")), "k8s2-drawer-uid").text()).toBe(
      "web-abc-1-u",
    );
  });

  it("shows — with the not-observed tooltip for labels and annotations without an object", () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    for (const id of ["k8s2-drawer-labels", "k8s2-drawer-annotations"]) {
      const value = dd(wrapper, id);
      expect(value.text()).toBe("—");
      expect(value.find('[data-test="k8s2-drawer-not-observed-value"]').exists()).toBe(true);
    }
  });

  it("renders labels and annotations as badges from the observed object", () => {
    observePod();
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"), { observed: true });
    expect(dd(wrapper, "k8s2-drawer-labels").text()).toBe("app=web");
    expect(dd(wrapper, "k8s2-drawer-annotations").text()).toBe("team/owner=shop");
  });

  it("links Controlled By to the owner, and a namespace to its drawer", async () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    expect(dd(wrapper, "k8s2-drawer-controlled-by").text()).toBe("ReplicaSet web-abc");
    await wrapper.find('[data-test="k8s2-drawer-owner-link"]').trigger("click");
    await wrapper.find('[data-test="k8s2-drawer-namespace-link"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [refOf("replicaset", "web-abc")],
      [refOf("namespace", "shop")],
    ]);
  });

  it("shows a Job's J7 owner as Controlled By CronJob nightly-report", async () => {
    const wrapper = mountDrawer(refOf("job", "nightly-report-29854200"));
    expect(dd(wrapper, "k8s2-drawer-controlled-by").text()).toBe("CronJob nightly-report");
    await wrapper.find('[data-test="k8s2-drawer-owner-link"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([[refOf("cronjob", "nightly-report")]]);
  });
});

describe("K8sDetailsDrawer events", () => {
  const events = (wrapper: Wrapper) => wrapper.findAll('[data-test="k8s2-drawer-event"]');

  it("shows each event's message, reason, source, count and last seen", () => {
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"), {
      events: [event(1, "Warning"), event(2)],
    });
    const [warning, normal] = events(wrapper);
    expect(warning.text()).toContain("message 1");
    expect(warning.text()).toContain("Pulled");
    expect(warning.text()).toContain("kubelet n1");
    expect(warning.text()).toContain("2m ago");
    expect(warning.find(".text-status-error-text").text()).toBe("message 1");
    expect(normal.find(".text-status-error-text").exists()).toBe(false);
  });

  it("renders at most 100 events", () => {
    const many = Array.from({ length: 150 }, (_, i) => event(i));
    expect(events(mountDrawer(refOf("pod", "web-abc-1"), { events: many }))).toHaveLength(100);
  });

  it("says when no events are in range, and when events are not cluster-labelled", () => {
    expect(
      mountDrawer(refOf("pod", "web-abc-1")).find('[data-test="k8s2-drawer-events-empty"]').text(),
    ).toBe("No events found in this time range");
    expect(
      mountDrawer(refOf("pod", "web-abc-1"), { eventsScoped: false, events: null })
        .find('[data-test="k8s2-drawer-events-unscoped"]')
        .text(),
    ).toBe("Events are not cluster-labelled");
  });
});

describe("K8sDetailsDrawer loading", () => {
  it("shows a spinner while pending, then not found when the row is still missing", async () => {
    const ref = refOf("node", "missing");
    const wrapper = mountDrawer(ref, { pending: true });
    expect(wrapper.find('[data-test="k8s2-drawer-pending"]').exists()).toBe(true);
    await wrapper.setProps({ pending: false });
    expect(wrapper.find('[data-test="k8s2-drawer-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-drawer-not-found"]').text()).toBe(
      "Not found in this time range",
    );
  });

  it("shows the object once loaded, with the info banner only while not observed", async () => {
    const ref = refOf("node", "n1");
    const wrapper = mountDrawer(ref, { pending: true, row: null });
    await wrapper.setProps({ pending: false, row: rowOf(inventory, ref) });
    expect(wrapper.find('[data-test="k8s2-drawer-section-metadata"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-drawer-not-observed"]').exists()).toBe(true);
    await wrapper.setProps({ observed: true });
    expect(wrapper.find('[data-test="k8s2-drawer-not-observed"]').exists()).toBe(false);
  });
});

describe("K8sDetailsDrawer actions", () => {
  it("opens the pod's logs through resolvePodLogs, single-cluster", async () => {
    await router.push("/");
    const dispatch = vi.spyOn(store, "dispatch");
    vi.mocked(resolvePodLogs).mockResolvedValue({
      route: { path: "/logs", query: { stream: "default" } },
      warnNoClusterField: false,
    });
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(resolvePodLogs).mock.calls[0].slice(0, 2)).toEqual([
      { cluster: "prod", namespace: "shop", pod: "web-abc-1" },
      { orgId: "org1", start: RANGE.start, end: RANGE.end, multiCluster: false },
    ]);
    expect(dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
    expect(router.currentRoute.value.path).toBe("/logs");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("toasts when no log stream qualifies", async () => {
    vi.mocked(resolvePodLogs).mockResolvedValue(null);
    const wrapper = mountDrawer(refOf("pod", "web-abc-1"));
    await wrapper.find('[data-test="k8s2-drawer-view-logs"]').trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
  });

  it.each(["node", "deployment", "cronjob", "namespace"] as const)(
    "shows no action button on a %s drawer",
    (kind) => {
      const name = { node: "n1", deployment: "web", cronjob: "nightly-report", namespace: "shop" }[
        kind
      ];
      const wrapper = mountDrawer(refOf(kind, name));
      expect(wrapper.find('[data-test="k8s2-drawer-view-logs"]').exists()).toBe(false);
      expect(wrapper.findAllComponents(OButton).some((b) => b.props("variant") === "outline")).toBe(
        false,
      );
    },
  );
});
