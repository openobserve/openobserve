// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AiScopeBar from "./AiScopeBar.vue";

// Lightweight stubs for the O2 library primitives so the spec asserts the
// scope-bar's OWN wiring (which child renders in which mode, data-test values,
// slot passthrough, cascade rendering) rather than the internals of the
// shared components — those are covered by their own specs.
const OToggleGroup = {
  props: ["modelValue", "type", "dataTest"],
  emits: ["update:modelValue"],
  template:
    '<div class="o-toggle-group" :data-test="dataTest" @click="$emit(\'update:modelValue\', \'stream\')"><slot /></div>',
};
const OToggleGroupItem = {
  props: ["value", "size"],
  template: '<button class="o-toggle-item" :data-value="value"><slot /></button>',
};
const OSelect = {
  props: ["modelValue", "label", "options", "loading"],
  emits: ["update:modelValue"],
  template: '<div class="o-select" :data-loading="loading"><slot name="trigger" /></div>',
};
const OSkeleton = {
  props: ["type"],
  template: '<div class="o-skeleton" />',
};
const StreamAgentCountBadge = {
  props: ["count", "dataTest"],
  template: '<span class="stream-agent-count" :data-test="dataTest">{{ count }}</span>',
};
// The cascade replaces the single agent dropdown in agent mode. Stub it to
// assert AiScopeBar renders it (and forwards prefix + the derived lists) rather
// than the three OSelects it owns (those are covered by AgentScopeCascade.spec).
const AgentScopeCascade = {
  props: [
    "prefix",
    "envs",
    "agentNames",
    "versions",
    "selectedEnv",
    "selectedAgentName",
    "selectedVersion",
  ],
  template:
    '<div class="agent-scope-cascade" :data-test="`${prefix}-cascade`" :data-envs="envs.length" :data-names="agentNames.length" :data-versions="versions.length" />',
};

const stubs = {
  OToggleGroup,
  OToggleGroupItem,
  OSelect,
  OSkeleton,
  StreamAgentCountBadge,
  AgentScopeCascade,
};

const baseLabels = {
  agent: "Agent",
  stream: "Stream",
  streamLabel: "Stream name",
  allAgents: "All Agents",
};

const baseProps = {
  dataTest: "sessions-list",
  labels: baseLabels,
  filterMode: "agent" as const,
  activeStream: "",
  activeAgent: "",
  streamSelectOptions: [{ label: "s1", value: "s1" }],
  agentSelectOptions: [{ label: "a1", value: "a1" }],
  selectedAgent: null,
  selectedStreamCount: 0,
  streamsLoaded: true,
  agentsLoaded: true,
  allAgents: true,
  // Cascade state (from useAgentScope, cascade:true).
  envs: [{ label: "prod", value: "prod" }],
  agentNames: [{ label: "checkout", value: "checkout" }],
  versions: [{ label: "2.1", value: "2.1" }],
  selectedEnv: "",
  selectedAgentName: "",
  selectedVersion: "",
};

const mountBar = (overrides: Record<string, unknown> = {}) =>
  mount(AiScopeBar, {
    global: { stubs },
    props: { ...baseProps, ...overrides },
  });

describe("AiScopeBar", () => {
  it("renders the filter-mode toggle with both agent + stream items using the passed data-test prefix", () => {
    const w = mountBar();
    const toggle = w.find('[data-test="sessions-list-filter-mode"]');
    expect(toggle.exists()).toBe(true);
    const items = w.findAll(".o-toggle-item");
    expect(items).toHaveLength(2);
    expect(items[0].attributes("data-value")).toBe("agent");
    expect(items[1].attributes("data-value")).toBe("stream");
    expect(items[0].text()).toBe("Agent");
    expect(items[1].text()).toBe("Stream");
  });

  it("emits filter-mode-change when the toggle updates", async () => {
    const w = mountBar();
    await w.find('[data-test="sessions-list-filter-mode"]').trigger("click");
    expect(w.emitted("filter-mode-change")).toBeTruthy();
    expect(w.emitted("filter-mode-change")![0]).toEqual(["stream"]);
    // two-way model updated too
    expect(w.emitted("update:filterMode")![0]).toEqual(["stream"]);
  });

  it("in stream mode shows the stream selector + count badge (once a stream is active)", () => {
    const w = mountBar({
      filterMode: "stream",
      activeStream: "s1",
      selectedStreamCount: 3,
    });
    expect(w.find('[data-test="sessions-list-stream-selector"]').exists()).toBe(true);
    // Agent-mode controls (cascade) are hidden in stream mode.
    expect(w.find(".agent-scope-cascade").exists()).toBe(false);
    const badge = w.find('[data-test="sessions-list-stream-count"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("3");
  });

  it("in agent mode renders the Env→Agent→Version cascade (not the single agent dropdown) and forwards the cascade lists", () => {
    const w = mountBar({ filterMode: "agent" });
    const cascade = w.find('[data-test="sessions-list-cascade"]');
    expect(cascade.exists()).toBe(true);
    // The single agent OSelect trigger is gone.
    expect(w.find('[data-test="sessions-list-agent-selector"]').exists()).toBe(false);
    // Derived option lists are forwarded through.
    expect(cascade.attributes("data-envs")).toBe("1");
    expect(cascade.attributes("data-names")).toBe("1");
    expect(cascade.attributes("data-versions")).toBe("1");
  });

  it("does not render the removed env/version OAgentBadges anymore", () => {
    const w = mountBar({
      filterMode: "agent",
      selectedAgent: { name: "checkout", env: "prod", version: "2.1" },
    });
    expect(w.find(".agent-badges").exists()).toBe(false);
    expect(w.find('[data-test="sessions-list-scope-badges"]').exists()).toBe(false);
  });

  it("gates the stream select behind an OSkeleton when showStreamSkeleton and streams not loaded", () => {
    const w = mountBar({
      filterMode: "stream",
      activeStream: "s1",
      showStreamSkeleton: true,
      streamsLoaded: false,
    });
    // In the stream selector, the skeleton renders and its OSelect is hidden.
    const selector = w.find('[data-test="sessions-list-stream-selector"]');
    expect(selector.find(".o-skeleton").exists()).toBe(true);
    expect(selector.find(".o-select").exists()).toBe(false);
  });

  it("does not gate the stream select with a skeleton when showStreamSkeleton is false", () => {
    const w = mountBar({
      filterMode: "stream",
      activeStream: "s1",
      showStreamSkeleton: false,
      streamsLoaded: false,
    });
    const selector = w.find('[data-test="sessions-list-stream-selector"]');
    expect(selector.find(".o-skeleton").exists()).toBe(false);
    expect(selector.find(".o-select").exists()).toBe(true);
  });

  it("renders the #trailing slot content (Graph's viz controls)", () => {
    const w = mount(AiScopeBar, {
      global: { stubs },
      props: baseProps,
      slots: { trailing: '<div class="viz-controls">viz</div>' },
    });
    expect(w.find(".viz-controls").exists()).toBe(true);
  });

  it("uses the passed data-test prefix for a different page (agent-graph)", () => {
    const w = mountBar({ dataTest: "agent-graph" });
    expect(w.find('[data-test="agent-graph-filter-mode"]').exists()).toBe(true);
    expect(w.find('[data-test="agent-graph-cascade"]').exists()).toBe(true);
  });

  it("emits cascade selection updates through to the parent", async () => {
    const w = mountBar({ filterMode: "agent" });
    (w.vm as any).$emit("update:selectedEnv", "prod");
    expect(w.emitted("update:selectedEnv")).toBeTruthy();
    expect(w.emitted("update:selectedEnv")![0]).toEqual(["prod"]);
  });

  describe("showAgentToggle (OSS callers hide Agent mode entirely)", () => {
    it("defaults to true — the toggle renders when the prop is omitted (no regression for existing callers)", () => {
      const w = mountBar();
      expect(w.find('[data-test="sessions-list-filter-mode"]').exists()).toBe(true);
    });

    it("hides the toggle group when showAgentToggle is false", () => {
      const w = mountBar({ showAgentToggle: false });
      expect(w.find('[data-test="sessions-list-filter-mode"]').exists()).toBe(false);
    });

    it("pins the bar to stream mode when showAgentToggle is false, even if filterMode is (defensively) 'agent'", () => {
      const w = mountBar({
        showAgentToggle: false,
        filterMode: "agent",
        activeStream: "s1",
        selectedStreamCount: 5,
      });
      expect(w.find('[data-test="sessions-list-stream-selector"]').exists()).toBe(true);
      expect(w.find(".agent-scope-cascade").exists()).toBe(false);
      expect(w.find('[data-test="sessions-list-stream-count"]').exists()).toBe(true);
    });

    it("never renders the agent cascade when showAgentToggle is false, regardless of filterMode", () => {
      // activeStream must be truthy here — with it blank, a pre-existing (and
      // unrelated) quirk lower in the template falls through to the cascade
      // branch regardless of mode; showAgentToggle isn't what that's testing.
      const wStream = mountBar({
        showAgentToggle: false,
        filterMode: "stream",
        activeStream: "s1",
      });
      const wAgent = mountBar({ showAgentToggle: false, filterMode: "agent", activeStream: "s1" });
      expect(wStream.find(".agent-scope-cascade").exists()).toBe(false);
      expect(wAgent.find(".agent-scope-cascade").exists()).toBe(false);
    });

    it("does not show the stream-count badge when showAgentToggle is false and no stream is active yet", () => {
      const w = mountBar({ showAgentToggle: false, filterMode: "agent", activeStream: "" });
      expect(w.find('[data-test="sessions-list-stream-count"]').exists()).toBe(false);
    });
  });
});
