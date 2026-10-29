import { afterEach, describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import { buildAgentClimbFilter } from "./agentClimbFilter";
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
});
