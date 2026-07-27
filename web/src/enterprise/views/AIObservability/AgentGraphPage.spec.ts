// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom
//
// Regression tests for the Agent Graph page's stream-gating logic.
//
// The bug: in "agent" mode the page fell back to the `default` trace stream
// whenever no agent was selected (e.g. no agents in the time window, or before
// loadAgents() resolved). ServiceGraph loads on mount, so it queried `default`
// and rendered that whole stream's service topology instead of an agent graph —
// the wrong graph that "only a refresh fixed". These tests pin the corrected
// behavior: ServiceGraph mounts ONLY once a real agent stream is resolved, and a
// "no agents" empty state renders otherwise — never the default-stream graph.

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be hoisted above imports.
// ---------------------------------------------------------------------------
import { reactive } from "vue";

const mockListAgents = vi.fn();

// Module-scoped traces store singleton (mirrors useTraces()).
const mockSearchObj = reactive({
  data: {
    datetime: {
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: 0,
      endTime: 0,
    },
    stream: { selectedStream: { value: "" } },
  },
  meta: {
    serviceGraphVisualizationType: "tree",
    serviceGraphLayoutType: "horizontal",
  },
});

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    listAgents: (...args: any[]) => mockListAgents(...args),
  },
}));

vi.mock("@/composables/useTraces", () => ({
  default: vi.fn(() => ({ searchObj: mockSearchObj })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { selectedOrganization: { identifier: "test-org" } },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

// Only relative-time resolution is exercised; return a fixed window.
vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn(() => ({ startTime: 100, endTime: 200 })),
}));

// ServiceGraph is loaded via defineAsyncComponent(() => import(...)). Under
// jsdom that async wrapper doesn't resolve into the DOM when gated behind a
// v-if that flips true only after mount (which is exactly our case). Replace
// defineAsyncComponent with a synchronous stub so we can assert (a) whether the
// graph mounted at all and (b) which stream/viz/layout it was handed.
vi.mock("vue", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    defineAsyncComponent: () =>
      actual.defineComponent({
        name: "ServiceGraphStub",
        props: ["streamFilter", "vizType", "layoutType", "hideStreamSelector", "agentHighlight"],
        template: `<div data-test="service-graph-stub" :data-stream="streamFilter" :data-viz="vizType" :data-layout="layoutType" />`,
      }),
  };
});

// Design-system stubs — reduced to just the contract these tests read.
vi.mock("@/lib/core/PageLayout/OPageLayout.vue", () => ({
  default: {
    name: "OPageLayout",
    template: `<div class="o-page-layout"><slot name="actions" /><slot name="subnav" /><slot /></div>`,
  },
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: { name: "DateTime", template: `<div class="date-time" />` },
}));

vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    emits: ["update:model-value"],
    // Expose each option's value so tests can inspect what a select offers.
    template: `<div class="o-select" :data-label="label" :data-value="modelValue">
      <span
        v-for="o in (options || [])"
        :key="o.value ?? o"
        class="o-select-option"
        :data-option="o.value ?? o"
      >{{ o.label ?? o }}</span>
    </div>`,
  },
}));

vi.mock("@/lib/core/ToggleGroup/OToggleGroup.vue", () => ({
  default: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:model-value"],
    template: `<div class="o-toggle-group" :data-value="modelValue"><slot /></div>`,
  },
}));

vi.mock("@/lib/core/ToggleGroup/OToggleGroupItem.vue", () => ({
  default: {
    name: "OToggleGroupItem",
    template: `<button class="o-toggle-item"><slot /></button>`,
  },
}));

vi.mock("@/lib/core/Icon/OIcon.vue", () => ({
  default: { name: "OIcon", template: `<i class="o-icon" />` },
}));

vi.mock("@/lib/core/RefreshButton/ORefreshButton.vue", () => ({
  default: { name: "ORefreshButton", template: `<button class="o-refresh" />` },
}));

vi.mock("@/lib/feedback/Spinner/OSpinner.vue", () => ({
  default: { name: "OSpinner", template: `<div class="o-spinner" />` },
}));

vi.mock("@/lib/core/EmptyState/OEmptyState.vue", () => ({
  default: {
    name: "OEmptyState",
    props: ["title", "description", "illustration", "size"],
    template: `<div class="o-empty-state" :data-title="title" />`,
  },
}));

vi.mock("@/components/shared/SkeletonBox.vue", () => ({
  default: { name: "SkeletonBox", template: `<div class="skeleton-box" />` },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AgentGraphPage from "./AgentGraphPage.vue";

const AGENT = {
  name: "sre_agent",
  id: null,
  source_stream: "sre_agent_traces_production",
  source_stream_type: "traces",
};

async function mountPage() {
  const wrapper = mount(AgentGraphPage);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("AgentGraphPage — agent-mode stream gating", () => {
  it("mounts ServiceGraph with the SELECTED agent's source_stream (not 'default')", async () => {
    mockListAgents.mockResolvedValue({ agents: [AGENT] });

    const wrapper = await mountPage();

    const sg = wrapper.find('[data-test="service-graph-stub"]');
    expect(sg.exists()).toBe(true);
    expect(sg.attributes("data-stream")).toBe("sre_agent_traces_production");
    // Must never fall back to the default stream.
    expect(sg.attributes("data-stream")).not.toBe("default");
  });

  it("shows the 'no agents' empty state — NOT the default service graph — when no agents are discovered", async () => {
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = await mountPage();

    // The regression: ServiceGraph must NOT render (it would have queried the
    // fallback `default` stream and drawn the wrong graph).
    expect(wrapper.find('[data-test="service-graph-stub"]').exists()).toBe(false);
    // The empty state is shown instead.
    expect(wrapper.find('[data-test="agent-graph-no-agents"]').exists()).toBe(true);
  });

  it("does not render ServiceGraph while agents are still loading", async () => {
    // Never-resolving listAgents keeps agentsLoaded=false.
    mockListAgents.mockReturnValue(new Promise(() => {}));

    const wrapper = mount(AgentGraphPage);
    await flushPromises();

    expect(wrapper.find('[data-test="service-graph-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-graph-no-agents"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-graph-loading"]').exists()).toBe(true);
  });

  it("passes the page's own vizType/layoutType (independent of the traces store) to ServiceGraph", async () => {
    localStorage.setItem("agentGraph_visualizationType", "graph");
    localStorage.setItem("agentGraph_layoutType", "force");
    // Traces store is on tree/horizontal — must NOT leak through.
    mockSearchObj.meta.serviceGraphVisualizationType = "tree";
    mockSearchObj.meta.serviceGraphLayoutType = "horizontal";
    mockListAgents.mockResolvedValue({ agents: [AGENT] });

    const wrapper = await mountPage();

    const sg = wrapper.find('[data-test="service-graph-stub"]');
    expect(sg.attributes("data-viz")).toBe("graph");
    expect(sg.attributes("data-layout")).toBe("force");
  });

  it("Stream picker offers ONLY the distinct source_streams of discovered agents (not agentless streams)", async () => {
    // Two agents across two streams; one stream (streamB) appears twice.
    mockListAgents.mockResolvedValue({
      agents: [
        { name: "a1", id: null, source_stream: "streamA", source_stream_type: "traces" },
        { name: "a2", id: null, source_stream: "streamB", source_stream_type: "traces" },
        { name: "a3", id: null, source_stream: "streamB", source_stream_type: "traces" },
      ],
    });

    const wrapper = await mountPage();
    // Switch to Stream mode so the stream selector renders.
    (wrapper.vm as any).filterMode = "stream";
    await flushPromises();

    const streamSelect = wrapper
      .findAll(".o-select")
      .find((s) => s.attributes("data-label") === "aiObservability.agentGraph.stream");
    expect(streamSelect).toBeTruthy();

    const opts = streamSelect!.findAll(".o-select-option");
    const values = opts.map((o) => o.attributes("data-option")).sort();
    // Exactly the agent-bearing streams, de-duplicated. No `default`, no
    // agentless stream like `introspection`.
    expect(values).toEqual(["streamA", "streamB"]);

    // Each label is annotated with the agent count for that stream.
    const labelByValue = Object.fromEntries(
      opts.map((o) => [o.attributes("data-option"), o.text()]),
    );
    expect(labelByValue["streamA"]).toContain("(1 aiObservability.agentGraph.agentCountSingular)");
    expect(labelByValue["streamB"]).toContain("(2 aiObservability.agentGraph.agentCountPlural)");
  });
});
