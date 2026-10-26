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
import fleet, { type FleetPipeline, type FleetPipelines } from "@/services/fleet";
import FleetFlowOverview from "./FleetFlowOverview.vue";
import FleetFlowList, { type FlowListItem } from "./FleetFlowList.vue";
import FleetFlowLegend from "./FleetFlowLegend.vue";
import { apiCollector, apiRollout } from "./fleet.fixtures";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    getPipelines: vi.fn(),
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

const D1 = {
  id: "d_1111aaaa2222bbbb",
  type: "otlphttp",
  target: "https://o2.acme.io",
  exporter: null,
};
const D2 = { id: "d_3333cccc4444dddd", type: "kafka", target: null, exporter: "kafka/bus" };

const exporter = (name: string, destination: string, rate: number | null, over = {}) => ({
  name,
  destination,
  rate,
  failed: 0,
  dropped: 0,
  queue: 0.1,
  ...over,
});

const pipeline = (over: Partial<FleetPipeline> & Pick<FleetPipeline, "fleet" | "name">) =>
  ({
    id: `${over.fleet}/${over.name}`,
    signal: over.name.split("/")[0],
    receivers: [{ name: "otlp", rate: 10, refused: 0 }],
    exporters: [exporter("otlphttp/o2", D1.id, 10)],
    in_rate: 10,
    out_rate: 10,
    failed_ratio: 0,
    dropped_ratio: 0,
    queue_ratio: 0.1,
    issues: [],
    ...over,
  }) as FleetPipeline;

const basePipelines = (): FleetPipelines => ({
  window: "1h",
  generated_at: 1791122400000,
  metrics_restricted: false,
  fleets: [
    { id: "prod", name: "prod", config: "base", version: 3, collectors: 24 },
    { id: "edge", name: "edge", config: "k8s", version: null, collectors: 1 },
  ],
  destinations: [D1, D2],
  pipelines: [
    pipeline({
      fleet: "prod",
      name: "metrics",
      receivers: [{ name: "hostmetrics", rate: 500, refused: 0 }],
      exporters: [exporter("otlphttp/o2", D1.id, 500)],
      in_rate: 500,
      out_rate: 500,
    }),
    pipeline({
      fleet: "prod",
      name: "logs",
      receivers: [{ name: "filelog", rate: 100, refused: 0 }],
      exporters: [
        exporter("otlphttp/o2", D1.id, 80, { failed: 20 }),
        exporter("kafka/bus", D2.id, 100, { queue: 0.9 }),
      ],
      in_rate: 100,
      out_rate: 180,
      failed_ratio: 0.2,
      queue_ratio: 0.9,
      issues: [
        { kind: "export_errors", signal: "logs", value: 0.2 },
        { kind: "backpressure", signal: "logs", value: 0.9 },
      ],
    }),
    pipeline({ fleet: "edge", name: "traces" }),
    pipeline({ fleet: "ghost", name: "logs" }),
  ],
});

function serve(payload: FleetPipelines | (() => Promise<any>)) {
  if (typeof payload === "function")
    vi.mocked(fleet.getPipelines).mockImplementation(payload as any);
  else vi.mocked(fleet.getPipelines).mockResolvedValue({ data: payload } as any);
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
const fleetItems = () => items(0);
const destinationItems = () => items(1);
const edges = () => wrapper.findComponent(VueFlowStub).props("edges") as any[];
const fleetNodes = () =>
  nodes()
    .filter((n) => n.id.startsWith("f:"))
    .map((n) => n.id);
const nodes = () => wrapper.findComponent(VueFlowStub).props("nodes") as any[];
const edge = (id: string) => edges().find((e) => e.id === id);
const legend = () => wrapper.findComponent(FleetFlowLegend);
const popover = () => wrapper.find('[data-test="fleet-flow-overview-popover"]');
const details = () => wrapper.findComponent({ name: "FleetFlowDetails" });

async function clickNode(id: string) {
  wrapper.findComponent(VueFlowStub).vm.$emit("node-click", {
    node: { id },
    event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
  });
  await flushPromises();
}

async function clickEdge(id: string) {
  wrapper.findComponent(VueFlowStub).vm.$emit("edge-click", {
    edge: { id },
    event: new MouseEvent("click", { clientX: 10, clientY: 10 }),
  });
  await flushPromises();
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { total: 0, items: [] } } as any);
  vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
});

afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("FleetFlowOverview map", () => {
  it("draws the four columns fleet, receiver, exporter, destination", async () => {
    serve(basePipelines());
    await mountOverview();
    const columns = ["f:", "r:", "e:", "d:"].map((prefix) =>
      nodes()
        .filter((n) => n.id.startsWith(prefix))
        .map((n) => n.id),
    );
    expect(columns).toEqual([
      ["f:prod", "f:edge"],
      ["r:prod|filelog", "r:prod|hostmetrics", "r:edge|otlp"],
      ["e:prod|otlphttp/o2", "e:prod|kafka/bus", "e:edge|otlphttp/o2"],
      [`d:${D1.id}`, `d:${D2.id}`],
    ]);
    const x = (id: string) => nodes().find((n) => n.id === id).position.x;
    expect(x("f:prod")).toBeLessThan(x("r:prod|filelog"));
    expect(x("r:prod|filelog")).toBeLessThan(x("e:prod|kafka/bus"));
    expect(x("e:prod|kafka/bus")).toBeLessThan(x(`d:${D1.id}`));
  });

  it("colours edges by signal and sizes them by rate, never by severity", async () => {
    serve(basePipelines());
    await mountOverview();
    const metrics = edge(`ed:prod|otlphttp/o2|${D1.id}|metrics`).data;
    const logs = edge(`ed:prod|otlphttp/o2|${D1.id}|logs`).data;
    expect(metrics.signal).toBe("metrics");
    expect(logs.signal).toBe("logs");
    expect(metrics.width).toBeGreaterThan(logs.width);
    expect(Object.keys(logs)).not.toContain("severity");
  });

  it("branches the failing exporter off with a dashed send-failed line and rings it", async () => {
    serve(basePipelines());
    await mountOverview();
    const branch = edge("br:e:prod|otlphttp/o2");
    expect(branch.source).toBe("e:prod|otlphttp/o2");
    expect(branch.data).toMatchObject({ branch: true, label: "Send failed 3.3%" });
    expect(edges().filter((e) => e.data.branch)).toHaveLength(1);
    const ring = (id: string) => nodes().find((n) => n.id === id).data.ring;
    expect(ring("e:prod|otlphttp/o2")).toBe("error");
    expect(ring("e:prod|kafka/bus")).toBe("warning");
    expect(ring("e:edge|otlphttp/o2")).toBeUndefined();
  });

  it("opens the failing exporter's details from the branch", async () => {
    serve(basePipelines());
    await mountOverview();
    await clickEdge("br:e:prod|otlphttp/o2");
    expect(details().props("title")).toBe("otlphttp/o2");
    expect(
      details()
        .props("issues")
        .map((i: any) => i.id),
    ).toContain("prod/logs-export_errors");
  });

  it("opens a pipeline from its edge and a fleet from its node", async () => {
    serve(basePipelines());
    await mountOverview();
    await clickEdge("fr:prod|hostmetrics|metrics");
    expect(details().props("title")).toBe("prod · metrics");
    await clickNode("f:edge");
    expect(details().props("title")).toBe("edge");
    expect(nodes().find((n) => n.id === "f:edge").data.selected).toBe(true);
  });

  it("drops the exporters of an unchecked destination from the map", async () => {
    serve(basePipelines());
    await mountOverview();
    lists()[1].vm.$emit("update:modelValue", [D1.id]);
    await flushPromises();
    expect(nodes().some((n) => n.id === `d:${D2.id}`)).toBe(false);
    expect(nodes().some((n) => n.id === "e:prod|kafka/bus")).toBe(false);
  });
});

describe("FleetFlowOverview lists and legend", () => {
  it("lists readable fleets on the left and the destinations in use on the right", async () => {
    serve(basePipelines());
    await mountOverview();
    expect(fleetItems().map((i) => i.id)).toEqual(["prod", "edge"]);
    expect(destinationItems().map((i) => [i.id, i.label])).toEqual([
      [D1.id, "o2.acme.io"],
      [D2.id, "kafka/bus · prod"],
    ]);
  });

  it("filters the map by the checked fleets", async () => {
    serve(basePipelines());
    await mountOverview();
    lists()[0].vm.$emit("update:modelValue", ["edge"]);
    await flushPromises();
    expect(fleetNodes()).toEqual(["f:edge"]);
  });

  it("counts pipelines per level and hides the levels switched off in the legend", async () => {
    serve(basePipelines());
    await mountOverview();
    expect(legend().props("counts")).toEqual({ error: 1, healthy: 2 });
    legend().vm.$emit("update:modelValue", ["healthy"]);
    await flushPromises();
    expect(fleetNodes()).toEqual(["f:prod"]);
    expect(wrapper.find('[data-test="fleet-flow-overview-issues-only"]').exists()).toBe(false);
    legend().vm.$emit("update:modelValue", ["healthy", "error"]);
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-overview-empty"]').text()).toContain(
      "hidden by the legend",
    );
  });

  it("counts a fleet's halted rollout as an error and its offline collectors as a warning", async () => {
    serve(basePipelines());
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout({ fleet: { id: "edge", name: "edge" }, status: "halted" })] },
    } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: {
        total: 1,
        items: [apiCollector({ fleet: { id: "prod", name: "prod" }, status: "offline" })],
      },
    } as any);
    await mountOverview();
    expect(legend().props("counts")).toEqual({ error: 2, warning: 1 });
    expect(nodes().find((n) => n.id === "f:edge").data.issueSeverity).toBe("error");
  });

  it("counts receiver refusals as a warning and restricted metrics as restricted", async () => {
    const payload = basePipelines();
    payload.pipelines[2].issues = [{ kind: "receiver_refused", signal: "traces", value: 0.05 }];
    payload.metrics_restricted = true;
    serve(payload);
    await mountOverview();
    expect(legend().props("counts")).toEqual({ error: 1, warning: 1, restricted: 1 });
  });
});

describe("FleetFlowOverview actions", () => {
  it("opens a pipeline issue's collectors in its fleet, and a rollout in the Fleets view", async () => {
    serve(basePipelines());
    await mountOverview();
    await clickNode("f:prod");
    details().vm.$emit("action", { kind: "collectors", query: { fleet: "prod" } });
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { fleet: "prod" }]);
    details().vm.$emit("action", { kind: "rollout", rolloutId: "r1" });
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { rollout: "r1" }]);
    details().vm.$emit("action", { kind: "upgrades" });
    expect(wrapper.emitted("outdated")).toHaveLength(1);
  });

  it("opens the fleet's configuration in the editor without losing the org", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "fleet", component: { template: "<div />" } },
        { path: "/editor/:id", name: "fleetConfigEditor", component: { template: "<div />" } },
      ],
    });
    await router.push({ name: "fleet", query: { org_identifier: "acme", tab: "overview" } });
    serve(basePipelines());
    wrapper = mount(FleetFlowOverview, {
      attachTo: document.body,
      global: { plugins: [store, i18n, router], stubs: { VueFlow: VueFlowStub } },
    });
    await flushPromises();
    await clickNode("f:prod");
    details().vm.$emit("open-config");
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe("base");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "acme" });
  });

  it("opens the fleet from its node and from a pipeline, never from a destination", async () => {
    serve(basePipelines());
    await mountOverview();
    await clickNode("f:prod");
    expect(details().props("fleetId")).toBe("prod");
    details().vm.$emit("open-fleet");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual(["fleets", { fleet: "prod" }]);
    await clickNode(`d:${D1.id}`);
    expect(details().props("fleetId")).toBeNull();
  });

  it("offers no configuration for a destination", async () => {
    serve(basePipelines());
    await mountOverview();
    await clickNode(`d:${D1.id}`);
    expect(details().props("hideConfig")).toBe(true);
  });
});

describe("FleetFlowOverview window and states", () => {
  it("refetches with the selected window", async () => {
    serve(basePipelines());
    await mountOverview();
    wrapper
      .findComponent<any>('[data-test="fleet-flow-overview-window"]')
      .vm.$emit("update:model-value", "5m");
    await flushPromises();
    expect(fleet.getPipelines).toHaveBeenLastCalledWith("default", "5m");
  });

  it("shows the loading overlay on the first load", async () => {
    serve(() => new Promise(() => {}));
    await mountOverview();
    expect(wrapper.findComponent({ name: "OInnerLoading" }).props("showing")).toBe(true);
  });

  it("shows the load-failed banner on an error, and Retry refetches", async () => {
    serve(() => Promise.reject({ response: { status: 500 } }));
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-error"]').text()).toContain(
      "Could not load the pipelines",
    );
    expect(wrapper.find('[data-test="fleet-flow-overview-no-fleets"]').exists()).toBe(false);
    const calls = vi.mocked(fleet.getPipelines).mock.calls.length;
    await wrapper.find('[data-test="fleet-flow-overview-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(fleet.getPipelines).mock.calls.length).toBe(calls + 1);
  });

  it("shows the no-fleets empty state when no fleet is readable", async () => {
    serve({ ...basePipelines(), fleets: [], pipelines: [], destinations: [] });
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-no-fleets"]').exists()).toBe(true);
  });

  it("explains under the map that fan-out copies data", async () => {
    serve(basePipelines());
    await mountOverview();
    expect(wrapper.find('[data-test="fleet-flow-overview-note"]').text()).toContain("Fan-out");
  });

  it("shows no access and drops the details when the payload turns 403 on a later poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(basePipelines());
    await mountOverview();
    await clickNode("f:prod");
    expect(popover().exists()).toBe(true);
    vi.mocked(fleet.getPipelines).mockRejectedValue({ response: { status: 403 } });
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-flow-overview-forbidden"]').exists()).toBe(true);
    expect(popover().exists()).toBe(false);
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
    serve(basePipelines());
    await mountBound(false);
    expect(button().attributes("aria-label")).toBe("Expand map");
    expect(mapPane().classes()).not.toContain("max-lg:h-dvh");
    await button().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:expanded")).toEqual([[true]]);
    expect(button().attributes("aria-label")).toBe("Collapse map");
    expect(mapPane().classes()).toContain("max-lg:h-dvh");
    await button().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:expanded")?.at(-1)).toEqual([false]);
    expect(button().attributes("aria-label")).toBe("Expand map");
  });

  it("collapses on Escape, and Escape does nothing more once collapsed", async () => {
    serve(basePipelines());
    await mountBound(true);
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toEqual([[false]]);
    await pressEscape();
    expect(wrapper.emitted("update:expanded")).toHaveLength(1);
  });

  it("leaves the map expanded when Escape is closing an open drawer", async () => {
    serve(basePipelines());
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
    serve(basePipelines());
    await mountBound(true);
    wrapper.findComponent(VueFlowStub).vm.$emit("node-click", {
      node: { id: "f:prod" },
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
