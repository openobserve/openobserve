// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

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

import AgentNodeBehaviorTab from "./AgentNodeBehaviorTab.vue";
import type { FailureRow, LoopRow } from "./agentScope";

const cost = (agent: string, c: number, tokens: number, errors = 0) => ({
  signal_type: "cost",
  agent_name: agent,
  cost: c,
  tokens,
  errors,
});

describe("AgentNodeBehaviorTab — cost headline", () => {
  it("sums cost, tokens and errors over all of the agent's cost rows", async () => {
    mockGetAgentSignals.mockResolvedValue({
      data: {
        signals: [
          cost("support-bot", 1.25, 1000, 1),
          cost("support-bot", 2.5, 1500, 2),
          cost("other-bot", 100, 99_000, 9),
        ],
      },
    });
    const wrapper = mount(AgentNodeBehaviorTab, {
      props: { agentName: "support-bot", sourceStream: "default", startTime: 1, endTime: 2 },
      global: { stubs: { OTable: true, OTag: true, AgentSignalDetailPanel: true } },
    });
    await flushPromises();

    const summary = (wrapper.vm as any).costSummary;
    expect(summary.cost).toBe("$3.75");
    expect(summary.tokens).toBe("2.5K");
    expect(summary.errors).toBe(3);
  });

  it("follows the page's Agent-mode env when the node is that agent", async () => {
    mockGetAgentSignals.mockReset().mockResolvedValue({
      data: {
        signals: [
          { ...cost("support-bot", 0.01, 1000), gen_ai_agent_env: "production" },
          { ...cost("support-bot", 0.03, 5000, 1), gen_ai_agent_env: null },
        ],
      },
    });
    const mountFor = (agentScope: object) =>
      mount(AgentNodeBehaviorTab, {
        props: { agentName: "support-bot", sourceStream: "default", agentScope },
        global: { stubs: { OTable: true, OTag: true, AgentSignalDetailPanel: true } },
      });
    const prod = mountFor({ name: "support-bot", env: "production", version: null });
    const other = mountFor({ name: "research-agent", env: "production", version: null });
    await flushPromises();

    expect((prod.vm as any).costSummary).toMatchObject({ cost: "$0.01", errors: 0 });
    // Another agent's selection leaves this node unscoped.
    expect((other.vm as any).costSummary).toMatchObject({ cost: "$0.04", errors: 1 });
  });
});

describe("AgentNodeBehaviorTab — loop and failure rows", () => {
  it("lists one row per tool and failure class over the range, not per rollup record", async () => {
    const loop = (calls: number, traces: number, env: string | null) => ({
      signal_type: "loop",
      agent_name: "support-bot",
      gen_ai_agent_env: env,
      tool_name: "refund_order",
      calls,
      distinct_traces: traces,
    });
    const failure = (count: number, env: string | null) => ({
      signal_type: "failure",
      agent_name: "support-bot",
      gen_ai_agent_env: env,
      fail_class: "timeout",
      count,
    });
    mockGetAgentSignals.mockReset().mockResolvedValue({
      data: {
        signals: [
          loop(4, 2, null),
          loop(1, 1, null),
          loop(5, 1, "production"),
          failure(2, null),
          failure(3, "production"),
          { ...failure(7, null), agent_name: "other-bot" },
        ],
      },
    });
    const wrapper = mount(AgentNodeBehaviorTab, {
      props: { agentName: "support-bot", sourceStream: "default", startTime: 1, endTime: 2 },
      global: { stubs: { OTable: true, OTag: true, AgentSignalDetailPanel: true } },
    });
    await flushPromises();

    // Script-setup state; the component exposes nothing.
    const vm = wrapper.vm as unknown as { loopRows: LoopRow[]; failureRows: FailureRow[] };
    expect(vm.loopRows.map((r) => [r.tool, r.calls, r.traces, r.ratio])).toEqual([
      ["refund_order", 10, 4, 2.5],
    ]);
    expect(vm.failureRows.map((r) => [r.failClass, r.count])).toEqual([["timeout", 5]]);
  });
});

describe("AgentNodeBehaviorTab — late responses", () => {
  it("keeps the current stream's signals when an earlier call answers last", async () => {
    const first = Promise.withResolvers<unknown>();
    mockGetAgentSignals
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: { signals: [cost("support-bot", 2, 100)] } });
    const wrapper = mount(AgentNodeBehaviorTab, {
      props: { agentName: "support-bot", sourceStream: "slow", startTime: 1, endTime: 2 },
      global: { stubs: { OTable: true, OTag: true, AgentSignalDetailPanel: true } },
    });
    await wrapper.setProps({ sourceStream: "fast" });
    await flushPromises();
    first.resolve({ data: { signals: [cost("support-bot", 9, 900)] } });
    await flushPromises();

    expect(wrapper.find('[data-test="agent-node-behavior-cost"]').text()).toContain("$2.00");
  });
});
