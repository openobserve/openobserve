// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import type { DataHealthCheck } from "@/services/gen-ai-data-health.service";

const getDataHealth = vi.fn();
vi.mock("@/services/gen-ai-data-health.service", () => ({
  getDataHealth: (...args: unknown[]) => getDataHealth(...args),
}));

// Model Pricing and GenAI Agent Mapping are enterprise/cloud settings; OSS locks them.
let mockIsEnterprise = "true";
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return mockIsEnterprise;
    },
    isCloud: "false",
  },
}));

import CodingAgentDataHealth from "./CodingAgentDataHealth.vue";

const NOW = Date.UTC(2026, 10, 3, 10, 0, 0);
const START_US = (NOW - 5 * 60_000) * 1000;

const routes = ["traceDetails", "genAiAgentMapping", "modelPricingGaps"].map((name) => ({
  path: `/${name}`,
  name,
  component: { template: "<div />" },
}));

const passing = (id: DataHealthCheck["id"], total = 3): DataHealthCheck => ({
  id,
  status: "pass",
  affected: 0,
  total,
});
const allPassing = (total = 3) => ({
  data: {
    checked_at: NOW * 1000,
    checks: [
      passing("unpriced_models", total),
      passing("missing_agent_identity", total),
      passing("zero_duration_spans", total),
      passing("missing_session_id", total),
    ],
  },
});

let wrapper: VueWrapper;
let router: Router;
const mountHealth = (props: Record<string, unknown> = {}) => {
  router = createRouter({ history: createMemoryHistory(), routes });
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "team1" },
      zoConfig: { model_pricing_enabled: true },
    },
  });
  wrapper = mount(CodingAgentDataHealth, {
    props: { org: "team1", stream: "ai_traces", startUs: START_US, ...props },
    global: { plugins: [i18n, store, router] },
  });
  return wrapper;
};
const q = (id: string) => wrapper.find(`[data-test="${id}"]`);
const state = () => q("ai-coding-agent-health").attributes("data-state");

beforeEach(() => {
  mockIsEnterprise = "true";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  wrapper?.unmount();
  getDataHealth.mockReset();
  vi.useRealTimers();
});

describe("CodingAgentDataHealth", () => {
  it("checks the stream from the window start to now with the session, fresh and with samples", async () => {
    getDataHealth.mockResolvedValue(allPassing());
    mountHealth({ agent: "support-bot" });
    await flushPromises();
    expect(getDataHealth).toHaveBeenCalledWith("team1", {
      stream_name: "ai_traces",
      start_time: START_US,
      end_time: NOW * 1000,
      agent: "support-bot",
      refresh: true,
      include_samples: true,
    });
    expect(q("ai-coding-agent-health-scope").text()).toBe(
      "Spans from agent support-bot in ai_traces since the check started",
    );
  });

  it("checks the whole stream when the first span names no agent", async () => {
    getDataHealth.mockResolvedValue(allPassing());
    mountHealth();
    await flushPromises();
    expect(getDataHealth.mock.calls[0][1].agent).toBeUndefined();
    expect(q("ai-coding-agent-health-scope").text()).toBe(
      "Spans in ai_traces since the check started",
    );
  });

  it("shows all four checks passing, with no fix links", async () => {
    getDataHealth.mockResolvedValue(allPassing());
    mountHealth();
    await flushPromises();
    expect(state()).toBe("ready");
    const cards = wrapper.findAll('[data-test^="llm-data-health-card-"]');
    expect(cards).toHaveLength(4);
    expect(cards.every((c) => c.attributes("data-status") === "pass")).toBe(true);
    expect(wrapper.find('[data-test^="llm-data-health-fix-"]').exists()).toBe(false);
    expect(q("llm-data-health-detail-missing_session_id").text()).toBe(
      "Every LLM span has gen_ai.conversation.id.",
    );
  });

  it("shows a failing check with its count and a fix link to the setting", async () => {
    getDataHealth.mockResolvedValue({
      data: {
        checked_at: NOW * 1000,
        checks: [
          passing("unpriced_models", 4),
          { id: "missing_agent_identity", status: "warning", affected: 3, total: 4 },
          passing("zero_duration_spans", 4),
          { id: "missing_session_id", status: "error", affected: 4, total: 4, samples: ["abc"] },
        ],
      },
    });
    mountHealth();
    await flushPromises();
    expect(q("llm-data-health-card-missing_agent_identity").attributes("data-status")).toBe(
      "warning",
    );
    expect(q("llm-data-health-detail-missing_agent_identity").text()).toBe(
      "3 of 4 LLM spans (75%) have no gen_ai.agent.name, so agent views miss them.",
    );
    expect(q("llm-data-health-fix-zero_duration_spans").exists()).toBe(false);

    await q("llm-data-health-fix-missing_agent_identity").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("genAiAgentMapping");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "team1" });
  });

  it("links a failing pricing check to the pricing gaps for this stream and window", async () => {
    getDataHealth.mockResolvedValue({
      data: {
        checked_at: NOW * 1000,
        checks: [
          { id: "unpriced_models", status: "warning", affected: 2, total: 2, model_count: 1 },
          passing("missing_agent_identity", 2),
        ],
      },
    });
    mountHealth();
    await flushPromises();
    await q("llm-data-health-fix-unpriced_models").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("modelPricingGaps");
    expect(router.currentRoute.value.query).toMatchObject({
      stream: "ai_traces",
      start_time: String(START_US),
      end_time: String(NOW * 1000),
    });
  });

  it("offers no fix for a setting OSS locks, and keeps the docs fix", async () => {
    mockIsEnterprise = "false";
    getDataHealth.mockResolvedValue({
      data: {
        checked_at: NOW * 1000,
        checks: [
          { id: "unpriced_models", status: "error", affected: 1, total: 2, model_count: 1 },
          { id: "missing_agent_identity", status: "warning", affected: 1, total: 2 },
          passing("zero_duration_spans", 2),
          { id: "missing_session_id", status: "warning", affected: 1, total: 2 },
        ],
      },
    });
    mountHealth();
    await flushPromises();
    expect(q("llm-data-health-card-unpriced_models").attributes("data-status")).toBe("error");
    expect(q("llm-data-health-fix-unpriced_models").exists()).toBe(false);
    expect(q("llm-data-health-fix-missing_agent_identity").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Copy link for an admin");
    expect(q("llm-data-health-fix-missing_session_id").exists()).toBe(true);
  });

  it("opens a sample trace in the checked window", async () => {
    getDataHealth.mockResolvedValue({
      data: {
        checked_at: NOW * 1000,
        checks: [
          { id: "zero_duration_spans", status: "warning", affected: 1, total: 2, samples: ["t-1"] },
        ],
      },
    });
    mountHealth();
    await flushPromises();
    await q("llm-data-health-sample-zero_duration_spans").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("traceDetails");
    expect(router.currentRoute.value.query).toMatchObject({
      stream: "ai_traces",
      trace_id: "t-1",
      from: String(START_US),
      to: String(NOW * 1000),
    });
  });

  it("says the LLM client is not instrumented when no check counted a span", async () => {
    getDataHealth.mockResolvedValue(allPassing(0));
    mountHealth();
    await flushPromises();
    expect(state()).toBe("no-genai");
    expect(q("ai-coding-agent-health-no-genai").text()).toContain(
      "the LLM client is not instrumented",
    );
    expect(wrapper.find('[data-test^="llm-data-health-card-"]').exists()).toBe(false);
  });

  it("checks again with refresh up to the new now, after the agent changes the code", async () => {
    getDataHealth.mockResolvedValue(allPassing());
    mountHealth();
    await flushPromises();
    vi.setSystemTime(NOW + 90_000);
    await q("ai-coding-agent-health-recheck-btn").trigger("click");
    await flushPromises();
    expect(getDataHealth).toHaveBeenCalledTimes(2);
    expect(getDataHealth.mock.calls[1][1]).toMatchObject({
      start_time: START_US,
      end_time: (NOW + 90_000) * 1000,
      refresh: true,
      include_samples: true,
    });
  });

  it("notes an older server without the checks and offers no re-check", async () => {
    getDataHealth.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    mountHealth();
    await flushPromises();
    expect(state()).toBe("unsupported");
    expect(q("ai-coding-agent-health-unsupported").text()).toContain(
      "does not check AI data health",
    );
    expect(q("ai-coding-agent-health-recheck-btn").exists()).toBe(false);
  });

  it("notes a failed check and lets the user try again", async () => {
    getDataHealth.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });
    mountHealth();
    await flushPromises();
    expect(state()).toBe("error");
    expect(q("ai-coding-agent-health-error").text()).toContain("could not run");

    getDataHealth.mockResolvedValueOnce(allPassing());
    await q("ai-coding-agent-health-recheck-btn").trigger("click");
    await flushPromises();
    expect(state()).toBe("ready");
  });
});
