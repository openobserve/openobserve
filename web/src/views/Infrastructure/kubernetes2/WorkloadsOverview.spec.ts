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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import type { QueryId } from "./kubernetesQueries";
import { buildInventory, type Series } from "./kubernetesModel";
import type { EventRow } from "./kubernetesEvents";
import WorkloadsOverview from "./WorkloadsOverview.vue";

const tooltipStub = defineComponent({
  name: "OTooltip",
  props: ["content"],
  setup(props) {
    return () => h("span", { "data-test": "tooltip" }, props.content);
  },
});

const END = 1_800_000_000_000_000;
const MIN = 60_000_000;

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const id = (ns: string, name: string) => ({ namespace: ns, pod: name, uid: `${name}-uid` });

const owned = (ns: string, name: string, kind: string, owner: string) =>
  ksm({ ...id(ns, name), owner_kind: kind, owner_name: owner, owner_is_controller: "true" });

const RESULTS: Partial<Record<QueryId, Series[]>> = {
  P1: [
    ksm({ ...id("shop", "web-1"), phase: "Running" }),
    ksm({ ...id("shop", "web-2"), phase: "Running" }),
    ksm({ ...id("shop", "web-3"), phase: "Running" }),
    ksm({ ...id("data", "etl-1"), phase: "Unknown" }),
    { metric: { k8s_cluster: "dev", ...id("shop", "dev-1"), phase: "Running" }, value: 1 },
  ],
  P11: [
    ksm({ ...id("shop", "web-1"), condition: "true" }),
    ksm({ ...id("shop", "web-2"), condition: "true" }),
    ksm({ ...id("shop", "web-3"), condition: "false" }),
  ],
  P4: [
    owned("shop", "web-1", "ReplicaSet", "web-abc"),
    owned("shop", "web-2", "ReplicaSet", "web-abc"),
  ],
  P5: [
    ksm({
      namespace: "shop",
      replicaset: "web-abc",
      owner_kind: "Deployment",
      owner_name: "web",
      owner_is_controller: "true",
    }),
  ],
  D1: [
    ksm({ namespace: "shop", deployment: "web" }, 2),
    ksm({ namespace: "data", deployment: "idle" }, 0),
  ],
  RS2: [ksm({ namespace: "shop", replicaset: "web-abc" }, 2)],
  CJ2: [ksm({ namespace: "data", cronjob: "nightly" }, 1)],
};

const event = (n: number, over: Partial<EventRow> = {}): EventRow => ({
  key: `e${n}`,
  type: "Normal",
  reason: "Scheduled",
  note: `note ${n}`,
  object: { kind: "Pod", name: `web-${n}`, namespace: "shop", uid: "" },
  source: "default-scheduler",
  count: 1,
  firstSeen: END - (n + 10) * MIN,
  lastSeen: END - n * MIN,
  ...over,
});

const EVENTS: EventRow[] = [
  event(1, { type: "Warning", reason: "BackOff", note: "Back-off restarting failed container" }),
  event(2, { object: { kind: "Service", name: "api", namespace: "shop", uid: "" } }),
  event(3, { object: { kind: "Node", name: "ip-1", namespace: "", uid: "" } }),
  ...Array.from({ length: 9 }, (_, i) => event(i + 4)),
];

describe("WorkloadsOverview", () => {
  let wrapper: VueWrapper<any>;

  const mountView = async (props: Record<string, any> = {}) => {
    wrapper = mount(WorkloadsOverview, {
      props: {
        inventory: buildInventory(new Map(Object.entries(RESULTS) as [QueryId, Series[]][])),
        cluster: "prod",
        namespaces: [],
        namespaceOptions: ["data", "shop"],
        events: EVENTS,
        eventLinksEnabled: true,
        endUs: END,
        loading: false,
        lastUpdatedAt: null,
        ...props,
      },
      global: { plugins: [i18n], stubs: { OTooltip: tooltipStub } },
    });
    await flushPromises();
    return wrapper;
  };

  const find = (testId: string) => wrapper.find(`[data-test="${testId}"]`);

  const bars = (kind: string) =>
    wrapper
      .findAllComponents({ name: "OProgressBar" })
      .filter((c) => String(c.attributes("data-test")).startsWith(`k8s2-workloads-bar-${kind}-`));

  const statusRows = (kind: string) =>
    wrapper
      .findAll(`[data-test^="k8s2-workloads-status-${kind}-"]`)
      .map((row) => row.find('[data-test="k8s2-workloads-status-label"]').text());

  afterEach(() => wrapper?.unmount());

  describe("status cards (AC 36, 41)", () => {
    it("renders the cards in Lens order with linked '<Kind> (n)' titles", async () => {
      await mountView();
      const titles = wrapper.findAll('[data-test^="k8s2-workloads-title-"]').map((b) => b.text());
      expect(titles).toEqual([
        "Pods (4)",
        "Deployments (2)",
        "DaemonSets (0)",
        "StatefulSets (0)",
        "ReplicaSets (1)",
        "Jobs (0)",
        "CronJobs (1)",
      ]);
      await find("k8s2-workloads-title-deployment").trigger("click");
      expect(wrapper.emitted("view")?.[0]).toEqual(["deployments"]);
    });

    it("builds each card from one OProgressBar row per non-zero status at n / total", async () => {
      await mountView();
      expect(statusRows("pod")).toEqual(["Running: 2", "Pending: 1", "Unknown: 1"]);
      expect(bars("pod").map((b) => [b.props("value"), b.props("variant")])).toEqual([
        [0.5, "success"],
        [0.25, "warning"],
        [0.25, "default"],
      ]);
      expect(statusRows("cronjob")).toEqual(["Suspended: 1"]);
      expect(bars("cronjob")[0].props("variant")).toBe("warning");
    });

    it("shows None for a kind with no objects, and mounts no chart component", async () => {
      await mountView();
      expect(find("k8s2-workloads-card-statefulset").text()).toContain("None");
      expect(bars("statefulset")).toHaveLength(0);
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(false);
      expect(wrapper.findComponent({ name: "PanelSchemaRenderer" }).exists()).toBe(false);
    });

    it("carries the OpenObserve rule tooltip on zero-pod and Unknown rows only", async () => {
      await mountView();
      const tip = (testId: string) => find(testId).find('[data-test="tooltip"]');
      expect(tip("k8s2-workloads-status-pod-unknown").text()).toContain("OpenObserve rule");
      expect(tip("k8s2-workloads-status-pod-running").exists()).toBe(false);
      // `idle` is scaled to zero with no pods, so the Deployment running row used the zero-pod rule.
      expect(statusRows("deployment")).toEqual(["Running: 2"]);
      expect(tip("k8s2-workloads-status-deployment-running").exists()).toBe(true);
      expect(tip("k8s2-workloads-status-replicaset-running").exists()).toBe(false);
    });

    it("the namespace selection changes the counts", async () => {
      await mountView({ namespaces: ["shop"] });
      expect(find("k8s2-workloads-title-pod").text()).toBe("Pods (3)");
      expect(statusRows("pod")).toEqual(["Running: 2", "Pending: 1"]);
      expect(find("k8s2-workloads-title-deployment").text()).toBe("Deployments (1)");
      expect(find("k8s2-workloads-card-cronjob").text()).toContain("None");
    });

    it("writes the namespace selection back as an update", async () => {
      await mountView();
      wrapper.findComponent({ name: "K8sListHeader" }).vm.$emit("update:namespaces", ["data"]);
      expect(wrapper.emitted("update")?.[0]).toEqual([{ namespaces: ["data"] }]);
    });

    it("emits refresh from the header's refresh button", async () => {
      await mountView();
      await find("k8s2-workloads-refresh").trigger("click");
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });
  });

  describe("recent events (AC 40)", () => {
    const rows = () => wrapper.findAll('[data-test^="k8s2-workloads-event-type-"]');

    it("is titled Recent events, shows the 10 most recent rows and no 'of N' count", async () => {
      await mountView();
      const card = find("k8s2-workloads-events-card");
      expect(card.find('[data-test="k8s2-workloads-events-title"]').text()).toBe("Recent events");
      expect(rows()).toHaveLength(10);
      expect(card.text()).not.toMatch(/\bof\b/);
    });

    it("links View all to the Events view", async () => {
      await mountView();
      await find("k8s2-workloads-events-view-all").trigger("click");
      expect(wrapper.emitted("view")?.[0]).toEqual(["events"]);
    });

    it("renders the §4.12 columns, with the Warning message in error text", async () => {
      await mountView();
      const headers = find("k8s2-workloads-events-table")
        .findAll("th")
        .map((th) => th.text());
      expect(headers).toEqual([
        "Type",
        "Message",
        "Namespace",
        "Involved object",
        "Source",
        "Count",
        "Age",
        "Last seen",
      ]);
      expect(find("k8s2-workloads-event-message-e1").classes()).toContain("text-status-error-text");
      expect(find("k8s2-workloads-event-age-e1").text()).toBe("11m");
      expect(find("k8s2-workloads-event-last-seen-e1").text()).toBe("1m");
    });

    it("opens the involved object's drawer when the kind has one", async () => {
      await mountView();
      await find("k8s2-workloads-event-object-e1").trigger("click");
      expect(wrapper.emitted("open")?.[0]).toEqual([
        { kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" },
      ]);
    });

    it("shows a kind without a drawer as plain text", async () => {
      await mountView();
      const cell = find("k8s2-workloads-event-object-e2");
      expect(cell.text()).toBe("Service: api");
      await cell.trigger("click");
      expect(wrapper.emitted("open")).toBeUndefined();
    });

    it("shows plain text with the cluster-unknown tooltip when links are disabled", async () => {
      await mountView({ eventLinksEnabled: false });
      const cell = find("k8s2-workloads-event-object-e1");
      expect(cell.find('[data-test="tooltip"]').text()).toBe("Cluster unknown for this event");
      await cell.trigger("click");
      expect(wrapper.emitted("open")).toBeUndefined();
    });

    it("filters by the involved object's namespace from its link", async () => {
      await mountView();
      await find("k8s2-workloads-event-namespace-e1").trigger("click");
      expect(wrapper.emitted("update")?.[0]).toEqual([{ namespaces: ["shop"] }]);
    });
  });
});
