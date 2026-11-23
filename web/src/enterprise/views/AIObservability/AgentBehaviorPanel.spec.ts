// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
// Agent scope keys are the canonical `gen_ai_agent_env` / `gen_ai_agent_version`, not `agent_env`.

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import {
  buildFailureRows,
  buildLoopRows,
  countAgents,
  matchesAgentScope,
  type DrillScope,
  type LoopRow,
  selectedAgentScope,
} from "./agentScope";
import { UNSET } from "@/enterprise/composables/useAgentScope";

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

const loopSignal = (
  agent: string | null,
  tool: string,
  env: string | null,
  version: string | null,
  calls: number,
  traces: number,
  _timestamp = 1,
) => ({
  _timestamp,
  org_id: "default",
  source_stream: "default",
  signal_type: "loop",
  agent_name: agent,
  gen_ai_agent_env: env,
  gen_ai_agent_version: version,
  tool_name: tool,
  count: calls,
  calls,
  distinct_traces: traces,
});
const reportSignals = [
  loopSignal("research-agent", "web_search", null, "2.3.0", 12, 1),
  loopSignal("research-agent", "web_search", "production", "2.3.0", 3, 2, 1),
  loopSignal("research-agent", "web_search", "production", "2.3.0", 2, 1, 2),
  loopSignal("support-bot", "refund_order", null, null, 4, 2, 1),
  loopSignal("support-bot", "refund_order", null, null, 1, 1, 2),
  loopSignal("omp", "bash", null, null, 3, 1, 1),
  loopSignal("omp", "bash", null, null, 1, 1, 2),
];

describe("buildLoopRows", () => {
  it("merges hourly windows and variants into one row per agent and tool", () => {
    const rows = buildLoopRows(reportSignals, "(unknown agent)");
    expect(rows.map((r) => `${r.agent}/${r.tool}`)).toEqual([
      "research-agent/web_search",
      "omp/bash",
      "support-bot/refund_order",
    ]);
    const [research, omp, support] = rows;
    // Calls/trace comes from the sums, not an average of per-window ratios.
    expect([research.calls, research.traces, research.ratio]).toEqual([17, 4, 4.25]);
    expect([omp.calls, omp.traces, omp.ratio]).toEqual([4, 2, 2]);
    expect([support.calls, support.traces, support.ratio]).toEqual([5, 3, 1.67]);
  });

  it("keeps each env/version variant, summed over its windows and ranked", () => {
    const [research, omp] = buildLoopRows(reportSignals, "(unknown agent)");
    expect(research.variants.map((v) => [v.env, v.version, v.calls, v.traces, v.ratio])).toEqual([
      [null, "2.3.0", 12, 1, 12],
      ["production", "2.3.0", 5, 3, 1.67],
    ]);
    expect(omp.variants).toHaveLength(1);
  });

  it("scopes a variant to exactly its env and version, a missing env included", () => {
    const [research] = buildLoopRows(reportSignals, "(unknown agent)");
    expect(research.variants.map((v) => v.scope)).toEqual([
      { env: UNSET, version: "2.3.0" },
      { env: "production", version: "2.3.0" },
    ]);
  });

  it("leaves a dimension no variant has unconstrained", () => {
    const [row] = buildLoopRows(
      [loopSignal("a", "t", null, "1.0", 4, 1), loopSignal("a", "t", null, "2.0", 2, 1)],
      "(unknown agent)",
    );
    expect(row.variants.map((v) => v.scope)).toEqual([
      { env: null, version: "1.0" },
      { env: null, version: "2.0" },
    ]);
  });

  it("gives merged and variant rows distinct ids", () => {
    const [research] = buildLoopRows(reportSignals, "(unknown agent)");
    const ids = [research.id, ...research.variants.map((v) => v.id)];
    expect(new Set(ids).size).toBe(3);
  });

  it("labels a signal without an agent but keeps its raw value null", () => {
    const [row] = buildLoopRows([loopSignal(null, "t", null, null, 2, 1)], "(unknown agent)");
    expect([row.agent, row.agentRaw]).toEqual(["(unknown agent)", null]);
  });
});

const failureSignal = (
  agent: string | null,
  failClass: string | null,
  env: string | null,
  count: number,
  _timestamp = 1,
) => ({
  _timestamp,
  org_id: "default",
  source_stream: "default",
  signal_type: "failure",
  agent_name: agent,
  gen_ai_agent_env: env,
  fail_class: failClass,
  count,
});

describe("buildFailureRows", () => {
  it("merges windows and variants into one row per agent and class", () => {
    const rows = buildFailureRows(
      [
        failureSignal("omp", "timeout", null, 2, 1),
        failureSignal("omp", "timeout", "production", 3, 1),
        failureSignal("omp", "timeout", "production", 4, 2),
        failureSignal("omp", "rate_limit", null, 8),
        failureSignal("bot", "timeout", null, 1),
        failureSignal(null, null, null, 1),
        loopSignal("omp", "bash", null, null, 9, 1),
      ],
      "(unknown agent)",
    );
    expect(rows.map((r) => [r.agent, r.agentRaw, r.failClass, r.count])).toEqual([
      ["omp", "omp", "timeout", 9],
      ["omp", "omp", "rate_limit", 8],
      ["bot", "bot", "timeout", 1],
      ["(unknown agent)", null, "unclassified", 1],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  });

  it("keeps each env variant, summed over its windows, with the missing env pinned", () => {
    const [timeout, single] = buildFailureRows(
      [
        failureSignal("omp", "timeout", null, 2, 1),
        failureSignal("omp", "timeout", "production", 3, 1),
        failureSignal("omp", "timeout", "production", 4, 2),
        failureSignal("bot", "timeout", null, 1, 1),
        failureSignal("bot", "timeout", null, 1, 2),
      ],
      "(unknown agent)",
    );
    expect(timeout.variants.map((v) => [v.env, v.count, v.scope])).toEqual([
      ["production", 7, { env: "production", version: null }],
      [null, 2, { env: UNSET, version: null }],
    ]);
    // One variant (merged over two windows): nothing to expand.
    expect([single.count, single.variants.length]).toEqual([2, 1]);
  });
});

describe("selectedAgentScope", () => {
  const agent = (env: string | null, version: string | null, source_stream = "default") => ({
    name: "research-agent",
    source_stream,
    source_stream_type: "traces",
    env,
    version,
  });

  it("pins a missing env to not set when a sibling variant has one, so production is excluded", () => {
    const noEnv = agent(null, "2.3.0");
    const scope = selectedAgentScope(noEnv, [noEnv, agent("production", "2.3.0")])!;
    expect(scope).toEqual({ name: "research-agent", env: UNSET, version: "2.3.0" });
    const signal = (env: string | null) => ({
      agent_name: "research-agent",
      gen_ai_agent_env: env,
      gen_ai_agent_version: "2.3.0",
    });
    expect(matchesAgentScope(signal(null), scope)).toBe(true);
    expect(matchesAgentScope(signal(""), scope)).toBe(true);
    expect(matchesAgentScope(signal("production"), scope)).toBe(false);
  });

  it("leaves a dimension open when no variant in the stream has it", () => {
    const a = agent(null, "1.0");
    expect(selectedAgentScope(a, [a, agent("production", "1.0", "other")])).toEqual({
      name: "research-agent",
      env: null,
      version: "1.0",
    });
    expect(selectedAgentScope(null, [a])).toBeNull();
  });
});

describe("countAgents", () => {
  it("counts distinct named agents, not rows", () => {
    expect(
      countAgents([
        { agentRaw: "omp" },
        { agentRaw: "omp" },
        { agentRaw: "research-agent" },
        { agentRaw: null },
      ]),
    ).toBe(2);
  });
});

describe("AgentBehaviorPanel", () => {
  // The KPI strip, reduced to its values: loops, failures, agents affected.
  const OStatStrip = defineComponent({
    props: { items: { type: Array as () => Array<{ value: unknown }>, required: true } },
    setup: (p) => () =>
      h("div", { "data-test": "strip" }, p.items.map((i) => String(i.value)).join(",")),
  });
  const stubs = {
    OStatStrip,
    OTable: true,
    OTag: true,
    OButton: true,
    PanelSectionHeader: true,
    CreateAlertAction: true,
    AiAlertPackDialog: true,
    AgentSignalDetailPanel: true,
  };
  const loop = (agent: string) => ({
    signal_type: "loop",
    agent_name: agent,
    tool_name: "web_search",
    calls: 12,
    distinct_traces: 1,
  });

  const mountWith = async (signals: unknown[]) => {
    mockGetAgentSignals.mockResolvedValueOnce({ data: { signals } });
    const wrapper = mount(AgentBehaviorPanel, {
      props: { sourceStream: "default", startTime: 1, endTime: 2 },
      global: { stubs },
    });
    await flushPromises();
    return wrapper;
  };

  it("counts looping agents, not rollup rows, beside agents affected", async () => {
    const wrapper = await mountWith([
      ...reportSignals,
      {
        signal_type: "failure",
        agent_name: "research-agent",
        fail_class: "unclassified",
        count: 9,
      },
    ]);
    expect(wrapper.find('[data-test="strip"]').text()).toBe("3,9,3");
  });

  // At 1024 px the counts took 150 px each and crushed Agent and Tool to "q…".
  it("keeps Agent and Tool at a usable floor and the loop counts compact", async () => {
    const wrapper = await mountWith(reportSignals);
    const loops = wrapper
      .findAllComponents({ name: "OTable" })
      .find((t) => t.attributes("data-test") === "agent-behavior-loops-table")!;
    const columns = loops.props("columns") as Array<{
      id: string;
      size?: number;
      minSize?: number;
      meta?: Record<string, unknown>;
    }>;
    const byId = Object.fromEntries(columns.map((c) => [c.id, c]));

    for (const id of ["agent", "tool"]) {
      expect(byId[id].minSize).toBe(136);
      expect(byId[id].meta).toMatchObject({ flex: true, autoWidth: true });
    }
    for (const id of ["ratio", "calls", "traces"]) expect(byId[id].size).toBeLessThanOrEqual(108);
  });

  it("highlights and scopes the drawer to exactly the clicked row", async () => {
    const wrapper = await mountWith(reportSignals);
    // The panel's own bindings: the table and drawer are stubbed.
    const state = wrapper.vm.$.setupState as unknown as {
      loopRows: LoopRow[];
      openDetail: (type: "loop", row: object) => void;
      loopRowClass: (row: object) => string;
      detailScope: DrillScope;
    };
    const [research] = state.loopRows;
    const [noEnv, production] = research.variants;
    const active = () => [research, noEnv, production].map((r) => state.loopRowClass(r) !== "");

    state.openDetail("loop", research);
    expect(active()).toEqual([true, false, false]);
    expect(state.detailScope).toEqual({ env: null, version: null });

    state.openDetail("loop", noEnv);
    expect(active()).toEqual([false, true, false]);
    expect(state.detailScope).toEqual({ env: UNSET, version: "2.3.0" });

    state.openDetail("loop", production);
    expect(active()).toEqual([false, false, true]);
    expect(state.detailScope).toEqual({ env: "production", version: "2.3.0" });
  });

  it("keeps the current stream's signals when an earlier stream answers last", async () => {
    const first = Promise.withResolvers<unknown>();
    mockGetAgentSignals
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: { signals: [] } });
    const wrapper = mount(AgentBehaviorPanel, {
      props: { sourceStream: "default", startTime: 1, endTime: 2 },
      global: { stubs },
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
