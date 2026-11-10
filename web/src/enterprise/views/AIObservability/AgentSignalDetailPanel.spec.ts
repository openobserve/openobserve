// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import {
  buildAgentClimbFilter,
  errorDetailExpr,
  failureErrorsSql,
  failureTracesSql,
  loopTracesSql,
} from "./agentClimbFilter";
import { explainSignalPrompt } from "./agentSignalPrompt";
import { UNSET } from "@/enterprise/composables/useAgentScope";

const mockSearch = vi.fn();
vi.mock("@/services/search", () => ({
  default: { search: (...args: unknown[]) => mockSearch(...args) },
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: vi.fn() }) }));
import AgentSignalDetailPanel from "./AgentSignalDetailPanel.vue";

const CALLER_EXPR = "COALESCE(c.gen_ai_agent_name, c.service_name)";

describe("AgentSignalDetailPanel trace links", () => {
  const OTableStub = {
    props: ["data"],
    emits: ["row-click"],
    template: `<div><div v-for="row in data" :key="row.trace_id" data-test="row" @click="$emit('row-click', row)"><slot name="cell-trace_id" :row="row" /></div></div>`,
  };

  const mountPanel = async (features: Record<string, string>) => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/traces/details", name: "traceDetails", component: { template: "<div />" } },
      ],
    });
    const wrapper = mount(AgentSignalDetailPanel, {
      props: { open: false, row: null, sourceStream: "default", startTime: 1, endTime: 2 },
      global: {
        plugins: [i18n, router, createStore({ state: { zoConfig: { features } } })],
        stubs: {
          ODrawer: { template: "<div><slot /></div>" },
          OTable: OTableStub,
          OAgentBadges: true,
        },
      },
    });
    (wrapper.vm as any).$.setupState.traceRows = [{ trace_id: "t-1" }];
    await flushPromises();
    return wrapper;
  };

  afterEach(() => vi.restoreAllMocks());

  it("shows a lock and opens nothing while the traces license is locked", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await mountPanel({ traces: "locked" });

    expect(wrapper.find('[data-test="agent-signal-detail-trace-lock"]').exists()).toBe(true);
    await wrapper.find('[data-test="row"]').trigger("click");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the trace in a new tab when the license enables traces", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await mountPanel({ traces: "enabled" });

    expect(wrapper.find('[data-test="agent-signal-detail-trace-lock"]').exists()).toBe(false);
    await wrapper.find('[data-test="row"]').trigger("click");
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("trace_id=t-1"),
      "_blank",
      expect.any(String),
    );
  });
});

describe("buildAgentClimbFilter", () => {
  it("adds env and version clauses when both are provided", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, "my-agent", {
      env: "prod",
      version: "2.1",
    });
    expect(sql).toContain("c.gen_ai_agent_env = 'prod'");
    expect(sql).toContain("c.gen_ai_agent_version = '2.1'");
  });

  it("is byte-identical to the agent-only predicate when env/version are absent (agent set)", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, "my-agent", {});
    expect(sql).toBe(`${CALLER_EXPR} = 'my-agent'`);
  });

  it("is byte-identical to the agent-only predicate when agent, env, version are all absent", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, undefined, {});
    expect(sql).toBe("1=1");
  });

  it("escapes single quotes in env/version", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, undefined, {
      env: "o'reilly",
      version: "1'0",
    });
    expect(sql).toContain("c.gen_ai_agent_env = 'o''reilly'");
    expect(sql).toContain("c.gen_ai_agent_version = '1''0'");
  });

  it("pins a variant's missing env to not set, beside its version", () => {
    const sql = buildAgentClimbFilter(CALLER_EXPR, "research-agent", {
      env: UNSET,
      version: "2.3.0",
    });
    expect(sql).toBe(
      `${CALLER_EXPR} = 'research-agent' AND c.gen_ai_agent_version = '2.3.0' AND (c.gen_ai_agent_env IS NULL OR c.gen_ai_agent_env = '')`,
    );
  });
});

describe("errorDetailExpr", () => {
  it("coalesces only the error-detail columns the stream has", () => {
    const expr = errorDetailExpr(new Set(["status_message", "exception_message", "span_id"]));
    expect(expr).toBe("COALESCE(NULLIF(c.status_message, ''), NULLIF(c.exception_message, ''))");
    expect(expr).not.toContain("error_message");
  });

  it("is null when the stream has none, so no query names a missing column", () => {
    expect(errorDetailExpr(new Set(["span_id"]))).toBeNull();
  });
});

describe("failure drill-down SQL", () => {
  const joins = 'LEFT JOIN "s" AS p1 ON c.reference_parent_span_id = p1.span_id';
  const detail = "COALESCE(NULLIF(c.status_message, ''))";

  it("counts distinct error spans per message, not joined rows", () => {
    const sql = failureErrorsSql("s", joins, "1=1", detail);
    expect(sql).toContain("COUNT(DISTINCT c.span_id) AS occurrences");
    expect(sql).not.toContain("COUNT(*)");
  });

  it("counts distinct error spans per trace, not joined rows", () => {
    const sql = failureTracesSql("s", joins, "1=1");
    expect(sql).toContain("COUNT(DISTINCT c.span_id) AS spans");
    expect(sql).not.toContain("COUNT(*)");
  });

  it("counts a loop's distinct tool spans per trace, so a re-exported trace is not multiplied", () => {
    const sql = loopTracesSql("s", joins, "1=1", "o'k");
    expect(sql).toContain("COUNT(DISTINCT c.span_id) AS repeats");
    expect(sql).toContain("c.gen_ai_tool_name = 'o''k'");
    expect(sql).not.toContain("COUNT(*)");
  });
});

describe("explainSignalPrompt failure evidence", () => {
  const evidence = {
    stream: "s",
    errors: [{ message: "boom", occurrences: 3 }],
    traces: [{ trace_id: "t1", measure: "2 error spans" }],
  };

  it("says a failure signal's evidence covers all of the agent's failure classes", () => {
    const prompt = explainSignalPrompt(
      { signalType: "failure", agent: "a", failClass: "unclassified", count: 9 },
      evidence,
    );
    const errorsLine = prompt.split("\n").find((l) => l.includes('"boom"'))!;
    const tracesLine = prompt.split("\n").find((l) => l.includes("t1"))!;
    expect(errorsLine).toMatch(/all of this agent's failure classes/);
    expect(tracesLine).toMatch(/all of this agent's failure classes/);
  });

  it("does not add the all-classes qualifier to other signals", () => {
    const prompt = explainSignalPrompt({ signalType: "cost", agent: "a" }, evidence);
    expect(prompt).not.toMatch(/all of this agent's failure classes/);
  });

  it("names a variant's missing env in the prompt", () => {
    const prompt = explainSignalPrompt(
      { signalType: "loop", agent: "a", tool: "web_search" },
      { ...evidence, env: UNSET, version: "2.3.0" },
    );
    expect(prompt).toContain("Agent no env, version 2.3.0.");
    expect(prompt).not.toContain(UNSET);
  });

  it("counts one trace in the singular", () => {
    const prompt = explainSignalPrompt(
      { signalType: "loop", agent: "a", tool: "t", calls: 12, traces: 1, ratio: 12 },
      evidence,
    );
    expect(prompt).toContain("(12 calls over 1 trace)");
  });
});

describe("AgentSignalDetailPanel — late responses", () => {
  const ODrawer = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  const OButton = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h("button", slots.default?.()),
  });
  const loopRow = (agent: string, tool: string) => ({
    signalType: "loop" as const,
    agent,
    agentRaw: agent,
    tool,
  });
  const hits = (traceId: string) => ({ data: { hits: [{ trace_id: traceId, repeats: 12 }] } });

  it("explains the row it shows when the previous row's traces answer last", async () => {
    const previous = Promise.withResolvers<unknown>();
    const current = Promise.withResolvers<unknown>();
    mockSearch.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const wrapper = mount(AgentSignalDetailPanel, {
      props: { open: false, row: null, sourceStream: "default", explainable: true },
      global: {
        plugins: [
          i18n,
          createRouter({ history: createMemoryHistory(), routes: [] }),
          createStore({ state: { selectedOrganization: { identifier: "test-org" } } }),
        ],
        stubs: {
          ODrawer,
          OButton,
          OIcon: true,
          OTable: true,
          OAgentBadges: true,
          OTruncatedText: true,
        },
      },
    });
    await wrapper.setProps({ open: true, row: loopRow("research-agent", "web_search") });
    await wrapper.setProps({ row: loopRow("support-bot", "lookup_order") });
    const explainButton = () => wrapper.find('[data-test="agent-signal-detail-explain"]');

    previous.resolve(hits("research-trace"));
    await flushPromises();
    // The current row is still loading: Explain waits for its evidence.
    expect(explainButton().attributes("disabled")).toBeDefined();

    current.resolve(hits("support-trace"));
    await flushPromises();
    expect(explainButton().attributes("disabled")).toBeUndefined();
    await explainButton().trigger("click");

    const sent = JSON.stringify(wrapper.emitted("sendToAiChat"));
    expect(sent).toContain("support-trace");
    expect(sent).not.toContain("research-trace");
    // The drawer closes so the chat panel beneath it shows the answer.
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
