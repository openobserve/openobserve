// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom
//
// Scope resolution on the Agent Behavior page: the URL's agent/env/version win
// over the first-agent default, and an org with LLM spans but no agent identity
// opens in Stream mode with the no-agent-identity banner.

import { ref } from "vue";

const mockListAgents = vi.fn();
const mockGetStreams = vi.fn();
const mockRouteQuery: Record<string, string> = {};
const mockRouterReplace = vi.fn(() => Promise.resolve());

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: { listAgents: (...args: any[]) => mockListAgents(...args) },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: (...args: any[]) => mockGetStreams(...args) }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: mockRouteQuery }),
  useRouter: () => ({ replace: mockRouterReplace }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/enterprise/composables/useAiDateController", () => ({
  useAiDateController: () => ({
    dateState: ref({ valueType: "relative", relativeTimePeriod: "15m" }),
    timeRange: ref({ startTime: 1_700_000_000_000_000, endTime: 1_700_000_900_000_000 }),
    applyRelative: vi.fn(),
    onDateChange: vi.fn(),
    mountResolve: vi.fn(),
    DEFAULT_RELATIVE: "15m",
  }),
}));

vi.mock("@/enterprise/composables/useChildRefresh", () => ({
  useChildRefresh: () => ({ lastRunAt: ref(null), isLoading: ref(false), refresh: vi.fn() }),
}));

vi.mock("@/enterprise/components/AIObservability/AiPageShell.vue", () => ({
  default: { name: "AiPageShell", template: `<div><slot name="subnav" /><slot /></div>` },
}));

vi.mock("@/enterprise/components/AIObservability/AiScopeBar.vue", () => ({
  default: { name: "AiScopeBar", template: `<div />` },
}));

vi.mock("@/enterprise/components/AIObservability/AiNoAgentIdentityBanner.vue", () => ({
  default: { name: "AiNoAgentIdentityBanner", template: `<div />` },
}));

vi.mock("./AgentBehaviorPanel.vue", () => ({
  default: {
    name: "AgentBehaviorPanel",
    props: ["sourceStream", "agentFilter", "agentEnv", "agentVersion", "scopeReady"],
    template: `<div />`,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach } from "vitest";
import AgentBehaviorPage from "./AgentBehaviorPage.vue";
import { queryClient } from "@/composables/query/queryClient";

enableAutoUnmount(afterEach);

const at = (name: string, stream: string, env: string, version: string) => ({
  name,
  id: `id-${name}-${env}`,
  source_stream: stream,
  source_stream_type: "traces",
  env,
  version,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockRouteQuery)) delete mockRouteQuery[k];
  mockGetStreams.mockResolvedValue({
    list: [{ name: "llm_traces", settings: { is_llm_stream: true } }],
  });
});

describe("AgentBehaviorPage — scope", () => {
  it("opens on the agent, env and version in the URL, not the first agent", async () => {
    Object.assign(mockRouteQuery, { agent: "omp", env: "production", version: "2" });
    mockListAgents.mockResolvedValue({
      agents: [
        at("a23ca1dd38a1ff350", "s_hash", "staging", "1"),
        at("omp", "s_staging", "staging", "2"),
        at("omp", "s_prod", "production", "2"),
      ],
    });

    const wrapper = mount(AgentBehaviorPage);
    await flushPromises();

    const panel = wrapper.findComponent({ name: "AgentBehaviorPanel" });
    expect(panel.props("agentFilter")).toBe("omp");
    expect(panel.props("agentEnv")).toBe("production");
    expect(panel.props("agentVersion")).toBe("2");
    expect(panel.props("sourceStream")).toBe("s_prod");
    expect(mockListAgents).toHaveBeenCalledTimes(1);
  });

  it("withholds the stream from the panel until the scope is settled", async () => {
    mockListAgents.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(AgentBehaviorPage);
    await flushPromises();

    const panel = wrapper.findComponent({ name: "AgentBehaviorPanel" });
    expect(panel.props("scopeReady")).toBe(false);
    expect(panel.props("sourceStream")).toBe("");
  });

  it("opens in Stream mode with the no-agent-identity banner when the window has no agents", async () => {
    mockListAgents.mockResolvedValue({ agents: [] });

    const wrapper = mount(AgentBehaviorPage);
    await flushPromises();

    const panel = wrapper.findComponent({ name: "AgentBehaviorPanel" });
    expect(panel.props("sourceStream")).toBe("llm_traces");
    expect(panel.props("agentFilter")).toBe("");
    expect(wrapper.findComponent({ name: "AiNoAgentIdentityBanner" }).exists()).toBe(true);
  });
});
