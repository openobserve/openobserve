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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import fleet, { type FleetConfigItem, type FleetFlow, type FleetFlowLink } from "@/services/fleet";
import FleetFlowOverview from "./FleetFlowOverview.vue";
import FleetFlowList, { type FlowListItem } from "./FleetFlowList.vue";
import FleetFlowLegend from "./FleetFlowLegend.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

const mockViewport = vi.hoisted(() => ({ mdUp: true }));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !mockViewport.mdUp),
      isTablet: computed(() => false),
      isDesktop: computed(() => mockViewport.mdUp),
      mdUp: computed(() => mockViewport.mdUp),
      lgUp: computed(() => mockViewport.mdUp),
    }),
  };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listConfigs: vi.fn(),
    getFlow: vi.fn(),
    listCollectors: vi.fn(),
    listRollouts: vi.fn(),
  },
}));

const VueFlowStub = defineComponent({
  name: "VueFlow",
  props: { nodes: { type: Array, default: () => [] }, edges: { type: Array, default: () => [] } },
  emits: ["node-click", "edge-click", "pane-click", "nodes-initialized"],
  template: "<div data-test='vue-flow-stub' />",
});

const config = (id: string, over: Partial<FleetConfigItem> = {}): FleetConfigItem => ({
  id,
  description: "",
  template: false,
  latest_version: 1,
  live_version: 1,
  collectors: 2,
  fleets: [],
  updated_at: 1790000000000,
  updated_by: "ana@acme.io",
  ...over,
});

const link = (over: Partial<FleetFlowLink> & Pick<FleetFlowLink, "config" | "destination">) => ({
  exporters: ["otlphttp/o2"],
  rate: { logs: null, metrics: null, traces: null },
  issues: [],
  ...over,
});

const D1 = {
  id: "d_1111aaaa2222bbbb",
  type: "otlphttp",
  target: "https://o2.acme.io",
  exporter: null,
};
const D2 = { id: "d_3333cccc4444dddd", type: "kafka", target: null, exporter: "kafka/bus" };

const baseFlow = (): FleetFlow => ({
  window: "1h",
  generated_at: 1791122400000,
  metrics_restricted: false,
  destinations: [D1, D2],
  links: [
    link({
      config: "a",
      destination: D1.id,
      rate: { logs: 10, metrics: 0, traces: null },
      issues: [{ kind: "export_errors", signal: "logs", value: 0.021 }],
    }),
    link({ config: "a", destination: D2.id, rate: { logs: 5, metrics: null, traces: null } }),
    link({ config: "b", destination: D1.id, rate: { logs: 5, metrics: null, traces: null } }),
    link({ config: "ghost", destination: D2.id, rate: { logs: 100, metrics: null, traces: null } }),
  ],
});

const baseConfigs = () => [config("a"), config("b"), config("tmpl", { template: true })];

function serve(flow: FleetFlow | (() => Promise<any>), configs = baseConfigs()) {
  vi.mocked(fleet.listConfigs).mockResolvedValue({ data: { items: configs } } as any);
  if (typeof flow === "function") vi.mocked(fleet.getFlow).mockImplementation(flow as any);
  else vi.mocked(fleet.getFlow).mockResolvedValue({ data: flow } as any);
}

let wrapper: VueWrapper;

async function mountOverview(props: Record<string, unknown> = {}) {
  wrapper = mount(FleetFlowOverview, {
    props,
    attachTo: document.body,
    global: { plugins: [store, i18n], stubs: { VueFlow: VueFlowStub } },
  });
  await flushPromises();
  return wrapper;
}

const lists = () => wrapper.findAllComponents(FleetFlowList);
const items = (which: 0 | 1) => lists()[which].props("items") as FlowListItem[];
const configItems = () => items(0);
const destinationItems = () => items(1);
const itemOf = (list: FlowListItem[], id: string) => list.find((i) => i.id === id);
const edges = () => wrapper.findComponent(VueFlowStub).props("edges") as any[];
const nodes = () => wrapper.findComponent(VueFlowStub).props("nodes") as any[];

async function selectTelemetry(value: string) {
  wrapper
    .findComponent<any>('[data-test="fleet-flow-overview-telemetry"]')
    .vm.$emit("update:model-value", value);
  await flushPromises();
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { total: 0, items: [] } } as any);
  vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
});

afterEach(() => {
  mockViewport.mdUp = true;
  wrapper?.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("FleetFlowOverview nodes and links", () => {
  it("takes nodes from non-template configs and destinations and links from the flow", async () => {
    serve(baseFlow());
    await mountOverview();
    expect(configItems().map((i) => i.id)).toEqual(["a", "b"]);
    expect(destinationItems().map((i) => i.id)).toEqual([D1.id, D2.id]);
    expect(nodes().map((n) => n.id)).toEqual(["c:a", "c:b", `d:${D1.id}`, `d:${D2.id}`]);
    expect(edges().map((e) => e.id)).toEqual([`a->${D1.id}`, `a->${D2.id}`, `b->${D1.id}`]);
  });

  it("leaves out a destination linked only by unknown or template configs", async () => {
    const D3 = {
      id: "d_5555eeee6666ffff",
      type: "otlphttp",
      target: "https://x.io",
      exporter: null,
    };
    const flow = baseFlow();
    flow.destinations.push(D3);
    flow.links.push(
      link({ config: "ghost", destination: D3.id }),
      link({ config: "tmpl", destination: D3.id }),
    );
    serve(flow);
    await mountOverview();
    expect(destinationItems().map((i) => i.id)).toEqual([D1.id, D2.id]);
    expect(nodes().some((n) => n.id === `d:${D3.id}`)).toBe(false);
  });

  it("leaves out a configuration with no permitted collectors and no link in the flow", async () => {
    serve(baseFlow(), [config("a", { collectors: 0 }), config("hidden", { collectors: 0 })]);
    await mountOverview();
    expect(configItems().map((i) => i.id)).toEqual(["a"]);
    expect(nodes().some((n) => n.id === "c:hidden")).toBe(false);
  });

  it("does not draw a link of an unknown config", async () => {
    serve(baseFlow());
    await mountOverview();
    expect(edges().some((e) => e.source === "c:ghost")).toBe(false);
  });

  it("adds and drops configurations on the 15 s poll without a remount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(baseFlow(), [config("a"), config("b")]);
    await mountOverview();
    expect(configItems().map((i) => i.id)).toEqual(["a", "b"]);
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: { items: [config("a"), config("c")] },
    } as any);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(configItems().map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("FleetFlowOverview all signals", () => {
  const mixedFlow = (): FleetFlow => ({
    ...baseFlow(),
    links: [
      link({
        config: "a",
        destination: D1.id,
        rate: { logs: 10, metrics: 20, traces: null },
      }),
      link({ config: "a", destination: D2.id, rate: { logs: null, metrics: 7, traces: 3 } }),
      link({ config: "b", destination: D1.id }),
    ],
  });

  it("opens on all, offered before logs", async () => {
    serve(baseFlow());
    await mountOverview();
    const toggle = wrapper.findComponent<any>('[data-test="fleet-flow-overview-telemetry"]');
    expect(toggle.props("modelValue")).toBe("all");
    const labels = toggle.findAllComponents({ name: "OToggleGroupItem" }).map((i) => i.text());
    expect(labels).toEqual(["All", "Logs", "Metrics", "Traces"]);
  });

  it("collapses the signal toggle into a dropdown on a phone", async () => {
    mockViewport.mdUp = false;
    serve(baseFlow());
    await mountOverview();
    const trigger = wrapper.find('[data-test="fleet-flow-overview-telemetry-dropdown-btn"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.text()).toContain("All");
  });

  it("keeps the signal toggle inline on a wide screen", async () => {
    serve(baseFlow());
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-telemetry-dropdown-btn"]').exists()).toBe(
      false,
    );
  });

  it("sums every signal for configs, destinations, edges and details", async () => {
    serve(mixedFlow());
    await mountOverview();
    expect(itemOf(configItems(), "a")?.rate).toBe("40 items/s");
    expect(itemOf(configItems(), "a")?.value).toBe(40);
    expect(itemOf(configItems(), "b")?.rate).toBe("No throughput data");
    expect(itemOf(configItems(), "b")?.value).toBe(-1);
    expect(itemOf(destinationItems(), D1.id)?.rate).toBe("30 items/s");
    expect(itemOf(destinationItems(), D2.id)?.rate).toBe("10 items/s");
    const edgeA2 = edges().find((e) => e.id === `a->${D2.id}`);
    expect(edgeA2.data.summary).toContain("10 items/s");
    expect(edgeA2.data.targetLabel).toBe("10 items/s");
    expect(edges().find((e) => e.id === `a->${D1.id}`).data.sourceLabel).toBe("40 items/s");
    wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
      edge: { id: edgeA2.id },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-details"]').text()).toContain(
      "Throughput 10 items/s",
    );
  });

  it("says throughput is restricted, not missing, when the user may not read the metric streams", async () => {
    const flow = baseFlow();
    flow.metrics_restricted = true;
    flow.links = flow.links.map((l) => ({
      ...l,
      rate: { logs: null, metrics: null, traces: null },
    }));
    serve(flow);
    await mountOverview();
    expect(itemOf(configItems(), "a")?.rate).toBe("No access to throughput metrics");
    expect(itemOf(destinationItems(), D1.id)?.rate).toBe("No access to throughput metrics");
    const edge = edges().find((e) => e.id === `a->${D1.id}`);
    expect(edge.data.sourceLabel).toBe("No access to throughput metrics");
    expect(edge.data.summary).toContain("No access to throughput metrics");
    wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
      edge: { id: edge.id },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    const details = wrapper.find('[data-test="fleet-flow-details"]').text();
    expect(details).toContain("No access to throughput metrics");
    expect(wrapper.text()).not.toContain("No throughput data");
  });

  it("marks an edge without issues restricted, never healthy, under restricted metrics", async () => {
    const flow = baseFlow();
    flow.metrics_restricted = true;
    serve(flow);
    await mountOverview();
    const edgeA2 = edges().find((e) => e.id === `a->${D2.id}`);
    expect(edgeA2.data.severity).toBe("restricted");
    expect(edgeA2.data.summary).toContain("No access to throughput metrics");
    expect(edges().find((e) => e.id === `a->${D1.id}`).data.severity).toBe("error");
    expect(itemOf(destinationItems(), D2.id)?.dot).toBe("restricted");
    const legend = wrapper.findComponent<any>(FleetFlowLegend);
    expect(legend.props("counts")).toEqual({ error: 1, restricted: 2 });
    expect(wrapper.find('[data-test="fleet-flow-legend-restricted"]').exists()).toBe(true);
  });

  it("ranks show top by the all-signal totals", async () => {
    const flow: FleetFlow = {
      ...baseFlow(),
      destinations: [D1],
      links: [
        link({ config: "a", destination: D1.id, rate: { logs: 9, metrics: null, traces: null } }),
        link({ config: "b", destination: D1.id, rate: { logs: 1, metrics: 50, traces: null } }),
        link({ config: "c", destination: D1.id, rate: { logs: 2, metrics: null, traces: 30 } }),
        link({ config: "d", destination: D1.id, rate: { logs: 8, metrics: 3, traces: null } }),
      ],
    };
    serve(flow, [config("a"), config("b"), config("c"), config("d")]);
    await mountOverview();
    await wrapper.find('[data-test="fleet-flow-list-configs-top3"]').trigger("click");
    await flushPromises();
    expect([...(lists()[0].props("modelValue") as string[])].sort()).toEqual(["b", "c", "d"]);
  });

  it("colours an edge by any signal's issue under all", async () => {
    const flow = baseFlow();
    flow.links[1].issues = [{ kind: "backpressure", signal: "traces", value: 0.9 }];
    serve(flow);
    await mountOverview();
    expect(edges().find((e) => e.id === `a->${D1.id}`).data.severity).toBe("error");
    expect(edges().find((e) => e.id === `a->${D2.id}`).data.severity).toBe("warning");
    expect(itemOf(destinationItems(), D2.id)?.dot).toBe("warning");
    await selectTelemetry("logs");
    expect(edges().find((e) => e.id === `a->${D2.id}`).data.severity).toBe("healthy");
  });

  it("opens an issue's collectors across every fleet", async () => {
    serve(mixedFlow());
    await mountOverview();
    const edge = edges().find((e) => e.id === `a->${D2.id}`);
    wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
      edge: { id: edge.id },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    wrapper
      .findComponent({ name: "FleetFlowDetails" })
      .vm.$emit("action", { kind: "collectors", query: { q: "a" } });
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { scope: "all", q: "a" }]);
  });

  it("opens an issue's rollout in the Fleets view, and its outdated collectors on the overview", async () => {
    serve(mixedFlow());
    await mountOverview();
    const edge = edges().find((e) => e.id === `a->${D2.id}`);
    wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
      edge: { id: edge.id },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    const details = wrapper.findComponent({ name: "FleetFlowDetails" });
    details.vm.$emit("action", { kind: "rollout", rolloutId: "r1" });
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { rollout: "r1" }]);
    details.vm.$emit("action", { kind: "upgrades" });
    expect(wrapper.emitted("outdated")).toHaveLength(1);
  });
});

describe("FleetFlowOverview layout", () => {
  it("keeps both node columns inside a phone-width canvas, and the desktop columns as before", async () => {
    serve(baseFlow());
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(350);
    await mountOverview();
    for (const n of nodes()) {
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.x + 144).toBeLessThanOrEqual(350);
    }
    wrapper.unmount();
    width.mockReturnValue(1200);
    await mountOverview();
    const xs = [...new Set(nodes().map((n) => n.position.x))].sort((a, b) => a - b);
    expect(xs).toEqual([1200 * 0.15 - 72, 1200 * 0.85 - 72]);
  });
});

describe("FleetFlowOverview rates", () => {
  it("labels a config's edges and list row with its halted rollout, not its throughput", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: {
        items: [
          {
            id: "r1",
            kind: "config",
            config: "b",
            from_version: null,
            to_version: 1,
            fleet: { id: "default", name: "default" },
            strategy: "immediate",
            status: "halted",
            total: 2,
            attempted: 2,
            accepted: 0,
            failed: 2,
            assigned: 2,
            started_at: Date.now() - 3600_000,
            scheduled_for: null,
            started_by: "ana@acme.io",
            auto_rollback: false,
            phases: [],
            gates: [],
            failure: null,
            events: [],
          },
        ],
      },
    } as any);
    serve(baseFlow());
    await mountOverview();
    const edge = edges().find((e) => e.id === `b->${D1.id}`);
    expect(edge.data.severity).toBe("error");
    expect(edge.data.sourceLabel).toBe("v1 rollout halted");
    expect(edges().find((e) => e.id === `a->${D1.id}`).data.sourceLabel).toBe("15 items/s");
    expect(itemOf(configItems(), "b")?.rate).toBe("v1 rollout halted");
    expect(itemOf(configItems(), "b")?.dot).toBe("error");
    const rate = wrapper.find('[data-test="fleet-flow-list-configs-item-b-rate"]');
    expect(rate.classes()).toEqual(expect.arrayContaining(["min-w-0", "max-w-1/2", "truncate"]));
    expect(rate.attributes("title")).toBe("v1 rollout halted");
    expect(itemOf(configItems(), "a")?.rate).toBe("15 items/s");
  });

  it("sums a config's links for the node rate and a destination's links for its rate", async () => {
    serve(baseFlow());
    await mountOverview();
    await selectTelemetry("logs");
    expect(itemOf(configItems(), "a")?.rate).toBe("15 records/s");
    expect(itemOf(destinationItems(), D1.id)?.rate).toBe("15 records/s");
  });

  it("shows a tiny positive rate as <0.1, never as 0", async () => {
    serve({
      ...baseFlow(),
      links: [
        link({
          config: "a",
          destination: D1.id,
          rate: { logs: 0.03, metrics: null, traces: null },
        }),
      ],
    });
    await mountOverview();
    await selectTelemetry("logs");
    expect(itemOf(configItems(), "a")?.rate).toBe("<0.1 records/s");
  });

  it("shows no throughput data for all-null links and 0 for a measured zero", async () => {
    const flow = baseFlow();
    flow.links[0].rate.logs = 0;
    flow.links[1].rate.logs = null;
    flow.links[2].rate.logs = null;
    serve(flow);
    await mountOverview();
    await selectTelemetry("logs");
    expect(itemOf(configItems(), "a")?.rate).toBe("0 records/s");
    expect(itemOf(configItems(), "b")?.rate).toBe("No throughput data");
    expect(itemOf(destinationItems(), D2.id)?.rate).toBe("No throughput data");
    expect(itemOf(destinationItems(), D1.id)?.rate).toBe("0 records/s");
  });

  it("follows the signal toggle for rates and edge colour", async () => {
    serve(baseFlow());
    await mountOverview();
    const edgeA1 = () => edges().find((e) => e.id === `a->${D1.id}`);
    expect(edgeA1().data.severity).toBe("error");
    await selectTelemetry("metrics");
    expect(edgeA1().data.severity).toBe("healthy");
    expect(itemOf(configItems(), "a")?.rate).toBe("0 points/s");
    expect(itemOf(destinationItems(), D2.id)?.rate).toBe("No throughput data");
    await selectTelemetry("traces");
    expect(itemOf(configItems(), "a")?.rate).toBe("No throughput data");
  });

  it("ranks show top 3 by value with no-data last", async () => {
    const flow: FleetFlow = {
      ...baseFlow(),
      destinations: [D1],
      links: [
        link({
          config: "a",
          destination: D1.id,
          rate: { logs: null, metrics: null, traces: null },
        }),
        link({ config: "b", destination: D1.id, rate: { logs: 0, metrics: null, traces: null } }),
        link({ config: "c", destination: D1.id, rate: { logs: 5, metrics: null, traces: null } }),
        link({ config: "d", destination: D1.id, rate: { logs: 3, metrics: null, traces: null } }),
      ],
    };
    serve(flow, [config("a"), config("b"), config("c"), config("d")]);
    await mountOverview();
    await wrapper.find('[data-test="fleet-flow-list-configs-top3"]').trigger("click");
    await flushPromises();
    expect([...(lists()[0].props("modelValue") as string[])].sort()).toEqual(["b", "c", "d"]);
  });
});

describe("FleetFlowOverview destinations", () => {
  it("labels a config-scoped destination with its exporter and config", async () => {
    serve(baseFlow());
    await mountOverview();
    expect(itemOf(destinationItems(), D2.id)?.label).toBe("kafka/bus · a");
    expect(itemOf(destinationItems(), D1.id)?.label).toBe("o2.acme.io");
  });

  it("shows the destination label, never its id, in the edge summary, details and evidence", async () => {
    serve(baseFlow());
    await mountOverview();
    const edge = edges().find((e) => e.id === `a->${D1.id}`);
    expect(edge.data.summary).toContain("a → o2.acme.io");
    expect(edge.data.summary).not.toContain("d_");
    wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
      edge: { id: edge.id },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    const details = wrapper.find('[data-test="fleet-flow-details"]');
    expect(details.text()).toContain("a → o2.acme.io");
    expect(details.text()).toContain("Reported by the exporter to o2.acme.io");
    expect(wrapper.text()).not.toContain("d_");
  });

  it("gives nodes and edges aria labels that name destinations, never their ids", async () => {
    serve(baseFlow());
    await mountOverview();
    const labels = [...nodes(), ...edges()].map((e) => e.ariaLabel);
    expect(labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
    expect(labels.some((l) => l.includes("d_"))).toBe(false);
    expect(nodes().find((n) => n.id === "c:a").ariaLabel).toBe("a");
    expect(nodes().find((n) => n.id === `d:${D2.id}`).ariaLabel).toBe("kafka/bus · a");
    expect(edges().find((e) => e.id === `a->${D1.id}`).ariaLabel).toBe("a → o2.acme.io");
  });

  it("checks a destination that appears on a refetch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = baseFlow();
    first.destinations = [D1];
    first.links = first.links.filter((l) => l.destination === D1.id);
    serve(first);
    await mountOverview();
    expect(lists()[1].props("modelValue")).toEqual([D1.id]);
    vi.mocked(fleet.getFlow).mockResolvedValue({ data: baseFlow() } as any);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(lists()[1].props("modelValue")).toEqual([D1.id, D2.id]);
  });
});

describe("FleetFlowOverview window and states", () => {
  it("refetches with the selected window", async () => {
    serve(baseFlow());
    await mountOverview();
    wrapper
      .findComponent<any>('[data-test="fleet-flow-overview-window"]')
      .vm.$emit("update:model-value", "5m");
    await flushPromises();
    expect(fleet.getFlow).toHaveBeenLastCalledWith("default", "5m");
  });

  it("shows the loading overlay on the first load", async () => {
    serve(() => new Promise(() => {}));
    await mountOverview();
    expect(wrapper.findComponent({ name: "OInnerLoading" }).props("showing")).toBe(true);
  });

  it("shows the load-failed banner on a flow error, and Retry refetches", async () => {
    serve(() => Promise.reject({ response: { status: 500 } }));
    await mountOverview();
    const banner = wrapper.find('[data-test="fleet-flow-overview-error"]');
    expect(banner.text()).toContain("Could not load the telemetry flow");
    const calls = vi.mocked(fleet.getFlow).mock.calls.length;
    await wrapper.find('[data-test="fleet-flow-overview-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(fleet.getFlow).mock.calls.length).toBe(calls + 1);
  });

  it("shows the no-configs empty state when the org has none", async () => {
    serve({ ...baseFlow(), destinations: [], links: [] }, [config("tmpl", { template: true })]);
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-no-configs"]').exists()).toBe(true);
  });

  it("shows the load-failed banner, not no-configs, when the configurations fail", async () => {
    serve(baseFlow());
    vi.mocked(fleet.listConfigs).mockRejectedValue({ response: { status: 500 } });
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-flow-overview-no-configs"]').exists()).toBe(false);
    const calls = vi.mocked(fleet.listConfigs).mock.calls.length;
    await wrapper.find('[data-test="fleet-flow-overview-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(fleet.listConfigs).mock.calls.length).toBe(calls + 1);
  });

  it("shows the load-failed banner when the collectors fail, and Retry refetches them", async () => {
    serve(baseFlow());
    vi.mocked(fleet.listCollectors).mockRejectedValue({ response: { status: 500 } });
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-error"]').exists()).toBe(true);
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await wrapper.find('[data-test="fleet-flow-overview-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls + 1);
  });

  it("shows the load-failed banner when the rollouts fail, and Retry refetches them", async () => {
    serve(baseFlow());
    vi.mocked(fleet.listRollouts).mockRejectedValue({ response: { status: 500 } });
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-error"]').exists()).toBe(true);
    const calls = vi.mocked(fleet.listRollouts).mock.calls.length;
    await wrapper.find('[data-test="fleet-flow-overview-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(fleet.listRollouts).mock.calls.length).toBe(calls + 1);
  });

  it("shows the load-failed banner, not no-configs, when the flow fails with no configurations", async () => {
    serve(() => Promise.reject({ response: { status: 500 } }), []);
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-flow-overview-no-configs"]').exists()).toBe(false);
  });

  it("shows no access when the flow turns 403 on a later poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(baseFlow());
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-forbidden"]').exists()).toBe(false);
    vi.mocked(fleet.getFlow).mockRejectedValue({ response: { status: 403 } });
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-overview-forbidden"]').exists()).toBe(true);
  });
});

describe("FleetFlowOverview selection", () => {
  const popover = () => wrapper.find('[data-test="fleet-flow-overview-popover"]');

  async function selectConfigNode(id: string) {
    wrapper.findComponent(VueFlowStub).vm.$emit("node-click", {
      node: { id: `c:${id}` },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
  }

  it("drops the details popover when the flow turns 403 on a later poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(baseFlow());
    await mountOverview();
    await selectConfigNode("a");
    expect(popover().exists()).toBe(true);
    vi.mocked(fleet.getFlow).mockRejectedValue({ response: { status: 403 } });
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-overview-forbidden"]').exists()).toBe(true);
    expect(popover().exists()).toBe(false);
  });

  it("drops the details popover when the poll removes the selected configuration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(baseFlow(), [config("a"), config("b")]);
    await mountOverview();
    await selectConfigNode("a");
    expect(popover().exists()).toBe(true);
    vi.mocked(fleet.listConfigs).mockResolvedValue({ data: { items: [config("b")] } } as any);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(nodes().some((n) => n.id === "c:a")).toBe(false);
    expect(popover().exists()).toBe(false);
  });

  it("opens a configuration in the editor without losing the org", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "fleet", component: { template: "<div />" } },
        { path: "/editor/:id", name: "fleetConfigEditor", component: { template: "<div />" } },
      ],
    });
    await router.push({ name: "fleet", query: { org_identifier: "acme", tab: "overview" } });
    serve(baseFlow());
    wrapper = mount(FleetFlowOverview, {
      attachTo: document.body,
      global: { plugins: [store, i18n, router], stubs: { VueFlow: VueFlowStub } },
    });
    await flushPromises();
    await selectConfigNode("a");
    wrapper.findComponent({ name: "FleetFlowDetails" }).vm.$emit("open-config");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("fleetConfigEditor");
    expect(router.currentRoute.value.params.id).toBe("a");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "acme" });
  });
});

describe("FleetFlowOverview expand", () => {
  const button = () => wrapper.find('[data-test="fleet-flow-overview-expand"]');
  const mapPane = () => wrapper.find('[data-test="fleet-flow-overview-map"]');
  const pressEscape = async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
  };

  async function mountBound(expanded: boolean) {
    await mountOverview({
      expanded,
      "onUpdate:expanded": (v: boolean) => wrapper.setProps({ expanded: v }),
    });
  }

  it("flips the button label and grows the phone map pane", async () => {
    serve(baseFlow());
    await mountBound(false);
    expect(button().attributes("aria-label")).toBe("Expand map");
    expect(mapPane().classes()).toContain("max-lg:h-112");
    await button().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:expanded")).toEqual([[true]]);
    expect(button().attributes("aria-label")).toBe("Collapse map");
    expect(mapPane().classes()).toContain("max-lg:h-dvh");
    expect(mapPane().classes()).not.toContain("max-lg:h-112");
    await button().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:expanded")?.at(-1)).toEqual([false]);
    expect(button().attributes("aria-label")).toBe("Expand map");
  });

  it("collapses on Escape, and Escape does nothing more once collapsed", async () => {
    serve(baseFlow());
    await mountBound(true);
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toEqual([[false]]);
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toHaveLength(1);
  });

  it("leaves the map expanded when Escape is closing an open drawer", async () => {
    serve(baseFlow());
    await mountBound(true);
    // Test-utils stubs are global per mount, so the drawer must repeat them or the map loses its stub.
    const drawer = mount(ODrawer, {
      props: { open: true },
      attachTo: document.body,
      global: { stubs: { VueFlow: VueFlowStub } },
    });
    await flushPromises();
    expect(document.querySelector("[data-dismissable-layer]")).not.toBeNull();
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toBeUndefined();
    drawer.unmount();
    await flushPromises();
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toEqual([[false]]);
  });

  it("closes the details card on the first Escape and collapses on the second", async () => {
    serve(baseFlow());
    await mountBound(true);
    wrapper.findComponent(VueFlowStub).vm.$emit("node-click", {
      node: { id: "c:a" },
      event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
    });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-overview-popover"]').exists()).toBe(true);
    await pressEscape();
    expect(wrapper.find('[data-test="fleet-flow-overview-popover"]').exists()).toBe(false);
    expect(wrapper.emitted("update:expanded")).toBeUndefined();
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toEqual([[false]]);
  });
});
