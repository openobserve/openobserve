// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom
//
// Regression tests for the Agent Behavior panel.
//
// The scoping bug: `scopedSignals` filtered by `agent_name` only, so two
// variants of the same agent (differing by env/version) collapsed into one —
// e.g. a "prod" and "staging" deployment of agent "a" both counted as agent
// "a"'s loops/failures. This pins `matchesAgentScope` narrowing by name + env +
// version, using the CANONICAL serialized keys `gen_ai_agent_env` /
// `gen_ai_agent_version` (NOT `agent_env`).
//
// The late-response bug (K4-03): a slow answer for the previous stream replaced
// the current stream's signals, so the panel is mounted with its children stubbed.

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { matchesAgentScope } from "./agentScope";

const mockGetAgentSignals = vi.fn();
vi.mock("@/services/agent_signals", () => ({
  default: { getAgentSignals: (...args: any[]) => mockGetAgentSignals(...args) },
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import AgentBehaviorPanel from "./AgentBehaviorPanel.vue";

describe("matchesAgentScope", () => {
  it("narrows by env when the selected variant has one", () => {
    const prod = { agent_name: "a", gen_ai_agent_env: "prod", gen_ai_agent_version: null };
    const staging = { agent_name: "a", gen_ai_agent_env: "staging", gen_ai_agent_version: null };

    const scope = { name: "a", env: "prod", version: null };

    expect(matchesAgentScope(prod, scope)).toBe(true);
    expect(matchesAgentScope(staging, scope)).toBe(false);
  });

  it("does not constrain on env/version when the selected scope omits them", () => {
    const prod = { agent_name: "a", gen_ai_agent_env: "prod", gen_ai_agent_version: "1.0" };
    const staging = { agent_name: "a", gen_ai_agent_env: "staging", gen_ai_agent_version: "2.0" };

    const scope = { name: "a" };

    expect(matchesAgentScope(prod, scope)).toBe(true);
    expect(matchesAgentScope(staging, scope)).toBe(true);
  });

  it("narrows by version when the selected variant has one", () => {
    const v1 = { agent_name: "a", gen_ai_agent_env: null, gen_ai_agent_version: "1.0" };
    const v2 = { agent_name: "a", gen_ai_agent_env: null, gen_ai_agent_version: "2.0" };

    const scope = { name: "a", env: null, version: "1.0" };

    expect(matchesAgentScope(v1, scope)).toBe(true);
    expect(matchesAgentScope(v2, scope)).toBe(false);
  });

  it("always rejects a different agent name regardless of env/version", () => {
    const other = { agent_name: "b", gen_ai_agent_env: "prod", gen_ai_agent_version: "1.0" };
    const scope = { name: "a", env: "prod", version: "1.0" };

    expect(matchesAgentScope(other, scope)).toBe(false);
  });
});

describe("AgentBehaviorPanel — late responses", () => {
  // The KPI strip, reduced to its values: loops, failures, agents affected.
  const OStatStrip = defineComponent({
    props: { items: { type: Array as () => Array<{ value: unknown }>, required: true } },
    setup: (p) => () =>
      h("div", { "data-test": "strip" }, p.items.map((i) => String(i.value)).join(",")),
  });
  const loop = (agent: string) => ({
    signal_type: "loop",
    agent_name: agent,
    tool_name: "web_search",
    calls: 12,
    distinct_traces: 1,
  });

  it("keeps the current stream's signals when an earlier stream answers last", async () => {
    const first = Promise.withResolvers<unknown>();
    mockGetAgentSignals
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: { signals: [] } });
    const wrapper = mount(AgentBehaviorPanel, {
      props: { sourceStream: "default", startTime: 1, endTime: 2 },
      global: {
        stubs: {
          OStatStrip,
          OTable: true,
          OTag: true,
          OButton: true,
          PanelSectionHeader: true,
          CreateAlertAction: true,
          AiAlertPackDialog: true,
          AgentSignalDetailPanel: true,
        },
      },
    });
    await flushPromises();
    await wrapper.setProps({ sourceStream: "harness_test" });
    await flushPromises();
    first.resolve({ data: { signals: [loop("research-agent")] } });
    await flushPromises();

    expect(wrapper.find('[data-test="strip"]').text()).toBe("—,—,—");
    expect(wrapper.vm.loading).toBe(false);
  });
});
