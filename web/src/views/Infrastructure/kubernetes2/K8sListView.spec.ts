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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import OTable from "@/lib/core/Table/OTable.vue";
import K8sListView from "./K8sListView.vue";
import { buildInventory, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { parseEvents } from "./kubernetesEvents";
import { parseUrlState } from "./kubernetesUrlState";

const END = 1_700_000_000_000_000;
const STORAGE = "o2-tables-column-state-v1";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const pods = () => {
  const p = (pod: string, namespace = "shop") => ({ namespace, pod, uid: pod });
  return buildInventory(
    results({
      P1: [
        ksm({ ...p("web"), phase: "Running" }),
        ksm({ ...p("api"), phase: "Running" }),
        ksm({ ...p("db", "data"), phase: "Pending" }),
      ],
      P6: [ksm({ ...p("web"), node: "n1" }), ksm({ ...p("api"), node: "n2" })],
      P4: [ksm({ ...p("web"), owner_kind: "ReplicaSet", owner_name: "web-rs" })],
      K1: [
        {
          metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: "web" },
          value: 0.5,
        },
        {
          metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: "api" },
          value: 0.1,
        },
      ],
    }),
  ).pods;
};

describe("K8sListView", () => {
  let wrapper: VueWrapper<any>;

  const mountList = async (props: Record<string, any> = {}, query: Record<string, string> = {}) => {
    wrapper = mount(K8sListView, {
      props: {
        view: "pods",
        rows: pods(),
        state: parseUrlState({ view: props.view ?? "pods", ...query }),
        endUs: END,
        cluster: "prod",
        eventLinks: true,
        namespaceOptions: ["data", "shop"],
        loading: false,
        forbidden: false,
        anchorMissing: null,
        capped: false,
        lastUpdatedAt: null,
        ...props,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  const table = () => wrapper.findComponent(OTable);
  const order = () => (table().vm as any).getRows().map((r: any) => r.name);
  const visible = () => (table().vm as any).table.getVisibleLeafColumns().map((c: any) => c.id);

  beforeEach(() => localStorage.clear());
  afterEach(() => wrapper?.unmount());

  it("renders dense 2rem virtual rows with no pager, in controlled client sorting from the URL", async () => {
    await mountList({}, { sort: "cpu", desc: "true" });
    const props = table().props();
    expect(props).toMatchObject({
      dense: true,
      rowHeight: 32,
      virtualScroll: true,
      overscan: 10,
      pagination: "none",
      sorting: "client",
      sortBy: "cpu",
      sortOrder: "desc",
      stickyHeader: true,
      frame: false,
      showGlobalFilter: false,
      persistColumns: true,
      tableId: "k8s2-pods",
    });
    expect(wrapper.find('[data-test="o2-table-pagination"]').exists()).toBe(false);
    expect(order()).toEqual(["web", "api", "db"]);
  });

  it("re-sorts on a later URL change without a click, keeping nulls last both ways", async () => {
    await mountList({}, { sort: "cpu" });
    expect(order()).toEqual(["api", "web", "db"]);
    await wrapper.setProps({ state: parseUrlState({ view: "pods", sort: "cpu", desc: "true" }) });
    await flushPromises();
    expect(order()).toEqual(["web", "api", "db"]);
  });

  it("falls back to the default sort for an unknown sort id", async () => {
    await mountList({}, { sort: "bogus", desc: "true" });
    expect(table().props()).toMatchObject({ sortBy: "name", sortOrder: "asc" });
    expect(order()).toEqual(["api", "db", "web"]);
  });

  it("defaults to name ascending", async () => {
    await mountList();
    expect(order()).toEqual(["api", "db", "web"]);
  });

  it("writes a header click back as sort/desc, and the default as no sort", async () => {
    await mountList();
    table().vm.$emit("sort-change", { column: "restarts", order: "desc" });
    table().vm.$emit("sort-change", { column: "name", order: "asc" });
    table().vm.$emit("sort-change", { column: "", order: "asc" });
    expect(wrapper.emitted("update")).toEqual([
      [{ sort: "restarts", desc: true }],
      [{ sort: null, desc: false }],
      [{ sort: null, desc: false }],
    ]);
  });

  it("emits a sort change from a real header click", async () => {
    await mountList();
    const header = wrapper.findAll('[data-test="o2-table-th-sort-trigger"]').at(0)!;
    await header.trigger("click");
    expect(wrapper.emitted("update")?.[0]?.[0]).toHaveProperty("sort");
  });

  it("shows the title, the item count and the search placeholder", async () => {
    await mountList();
    expect(wrapper.find('[data-test="k8s2-list-title"]').text()).toBe("Pods");
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toBe("3 items");
    expect(wrapper.find('[data-test="k8s2-list-search"] input').attributes("placeholder")).toBe(
      "Search Pods…",
    );
  });

  it("reads Filtered: x / y when search or a namespace narrows, and clears both", async () => {
    await mountList({}, { namespace: "shop" });
    expect(wrapper.find('[data-test="k8s2-list-count"]').text()).toBe("Filtered: 2 / 3");
    await wrapper.find('[data-test="k8s2-list-filtered-clear"]').trigger("click");
    expect(wrapper.emitted("update")).toContainEqual([{ search: "", namespaces: [] }]);
  });

  it.each(["nodes", "namespaces"])("hides the namespace select on %s", async (view) => {
    await mountList({ view, rows: [] });
    expect(wrapper.find('[data-test="k8s2-namespace-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-namespace-filter-btn"]').exists()).toBe(false);
  });

  it("lists the namespace options, and on phones opens the same select in a drawer anchored to the header row", async () => {
    await mountList({}, { namespace: "gone" });
    expect(wrapper.find('[data-test="k8s2-namespace-select"]').classes()).toContain(
      "max-md:hidden",
    );
    const button = wrapper.find('[data-test="k8s2-namespace-filter-btn"]');
    expect(button.classes()).toContain("md:hidden");
    await button.trigger("click");
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("anchorEdge")).toBe("bottom");
    expect(drawer.props("anchor")).toBe(wrapper.find('[data-test="k8s2-list-header"]').element);
  });

  it("searches the node and IP text, not just the name", async () => {
    await mountList({}, { search: "n2" });
    expect(order()).toEqual(["api"]);
  });

  it("forces the sorted column visible over a persisted hidden choice, without rewriting storage", async () => {
    const stored = JSON.stringify({ "k8s2-pods": { visibility: { memLim: false } } });
    localStorage.setItem(STORAGE, stored);
    await mountList({}, { sort: "memLim", desc: "true" });
    expect(visible()).toContain("memLim");
    expect(localStorage.getItem(STORAGE)).toBe(stored);
    await wrapper.setProps({ state: parseUrlState({ view: "pods", sort: "cpu" }) });
    await flushPromises();
    expect(visible()).not.toContain("memLim");
  });

  it("hides IP and the % columns by default and persists a toggle under k8s2-<view>", async () => {
    await mountList();
    expect(visible()).not.toContain("ip");
    expect(visible()).not.toContain("memLim");
    const toggle = wrapper.findComponent({ name: "OTableColumnToggle" });
    expect(toggle.exists()).toBe(true);
    toggle.vm.$emit("update:column-visibility", { ip: true });
    await flushPromises();
    expect(JSON.parse(localStorage.getItem(STORAGE) ?? "{}")["k8s2-pods"].visibility).toEqual({
      ip: true,
    });
  });

  it("persists a column toggle under the new view's table id after a view switch", async () => {
    await mountList();
    await wrapper.setProps({ view: "nodes", rows: [], state: parseUrlState({ view: "nodes" }) });
    await flushPromises();
    wrapper.findComponent({ name: "OTableColumnToggle" }).vm.$emit("update:column-visibility", {
      taints: false,
    });
    await flushPromises();
    const stored = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    expect(stored["k8s2-nodes"]?.visibility).toEqual({ taints: false });
    expect(stored["k8s2-pods"]).toBeUndefined();
  });

  it("shows the forbidden state instead of the empty state on a 403", async () => {
    await mountList({ rows: [], forbidden: true });
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-empty"]').exists()).toBe(false);
  });

  it("names the absent anchor stream in the empty state", async () => {
    await mountList({ rows: [], anchorMissing: "kube_pod_status_phase" });
    const empty = wrapper.find('[data-test="k8s2-empty-anchor"]');
    expect(empty.text()).toContain("No Pods data");
    expect(empty.text()).toContain("kube_pod_status_phase");
  });

  it("shows No <Kind> found, filtered with clear when a filter is active", async () => {
    await mountList({ rows: [] });
    expect(wrapper.find('[data-test="k8s2-empty"]').text()).toContain("No Pods found");
    wrapper.unmount();
    await mountList({}, { search: "zzz" });
    expect(wrapper.findComponent({ name: "OEmptyState" }).props("filtered")).toBe(true);
    wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action", "clear-filters");
    expect(wrapper.emitted("update")).toContainEqual([{ search: "", namespaces: [] }]);
  });

  it("opens a row's drawer on click, and a link opens its own target without the row's", async () => {
    await mountList();
    const web = pods().find((p) => p.name === "web")!;
    table().vm.$emit("row-click", web, new MouseEvent("click"));
    expect(wrapper.emitted("open")?.[0]).toEqual([
      { kind: "pod", cluster: "prod", namespace: "shop", name: "web" },
    ]);
    const node = wrapper.find(`[data-test="k8s2-link-node-${web.key}"]`);
    await node.trigger("click");
    expect(wrapper.emitted("open")?.[1]).toEqual([
      { kind: "node", cluster: "prod", namespace: "", name: "n1" },
    ]);
    expect(wrapper.emitted("open")).toHaveLength(2);
    await wrapper.find(`[data-test="k8s2-namespace-${web.key}"]`).trigger("click");
    expect(wrapper.emitted("update")).toContainEqual([{ namespaces: ["shop"] }]);
    expect(wrapper.emitted("open")).toHaveLength(2);
  });

  describe("events", () => {
    const events = () =>
      parseEvents([
        {
          event_name: "a",
          k8s_namespace_name: "data",
          body_object_type: "Warning",
          body_object_note: "Back-off restarting",
          body_object_reason: "BackOff",
          body_object_regarding: JSON.stringify({ kind: "Pod", name: "x", namespace: "data" }),
          _timestamp: END - 1_000_000,
        },
        {
          event_name: "b",
          k8s_namespace_name: "default",
          body_object_type: "Normal",
          body_object_note: "Ok",
          body_object_regarding: JSON.stringify({ kind: "Service", name: "s", namespace: "data" }),
          _timestamp: END - 5_000_000,
        },
      ]);

    it("defaults to Last Seen newest first, opens the involved object's drawer, and ignores kinds without one", async () => {
      await mountList({ view: "events", rows: events() });
      expect(table().props()).toMatchObject({ sortBy: "lastSeen", sortOrder: "desc" });
      table().vm.$emit("row-click", events()[1], new MouseEvent("click"));
      expect(wrapper.emitted("open")).toBeUndefined();
      table().vm.$emit("row-click", events()[0], new MouseEvent("click"));
      expect(wrapper.emitted("open")?.[0]).toEqual([
        { kind: "pod", cluster: "prod", namespace: "data", name: "x" },
      ]);
    });

    it("searches message, reason and the involved object's name", async () => {
      await mountList({ view: "events", rows: events() }, { search: "backoff" });
      expect((table().vm as any).getRows()).toHaveLength(1);
    });

    it("reads 1000 items (limit) with a tooltip when E hit its cap", async () => {
      await mountList({ view: "events", rows: events(), capped: true });
      expect(wrapper.find('[data-test="k8s2-list-capped"]').text()).toContain("items (limit)");
    });

    it("shows a Warning message in error text", async () => {
      await mountList({ view: "events", rows: events() });
      const cell = wrapper.find(`[data-test="k8s2-cell-message-${events()[0].key}"]`);
      expect(cell.classes()).toContain("text-status-error-text");
    });
  });
});
