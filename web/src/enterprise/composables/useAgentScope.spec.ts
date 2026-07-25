// @vitest-environment jsdom
// Tests for useAgentScope — the single composable owning agent loading,
// selection, options, and resolution across all 4 AI pages. This task
// reproduces TODAY'S single grouped-dropdown behavior EXACTLY for BOTH page
// shapes (no Env→Agent→Version cascade — that is Plan 2).
//
// Shape 1 (Sessions / LLM): allAgents:true → ALL_AGENTS_VALUE sentinel default,
//   module-scoped agents/agentsLoaded injected refs, selectedAgent null on All.
// Shape 2 (Graph / Behavior): allAgents:false → first-agent default on load,
//   local agents/agentsLoaded refs, no All-Agents option.
//
// The one allowed change: effectiveStream normalized to `?? ""` (Behavior used
// `?? activeStream.value`). An equivalence test proves that normalization is
// invisible in practice for Behavior (first agent → non-empty source_stream).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import type { Ref } from "vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { ALL_AGENTS_VALUE } from "@/enterprise/components/onlineEvals/utils/agentFilterSql";
import { agentOptionKey } from "@/plugins/traces/llmAgentFilter";

const listAgents = vi.fn();

vi.mock("@/services/gen-ai-agent-mapping.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, listAgents: (...a: any[]) => listAgents(...a) },
  };
});

import { useAgentScope, UNSET } from "./useAgentScope";

const t = (k: string) => k;

const agentA: GenAiAgentListItem = {
  name: "alpha",
  id: "a1",
  source_stream: "stream_a",
  source_stream_type: "traces",
  env: "prod",
  version: "1",
};
const agentB: GenAiAgentListItem = {
  name: "beta",
  id: "b1",
  source_stream: "stream_b",
  source_stream_type: "traces",
  env: "dev",
  version: "2",
};

beforeEach(() => {
  listAgents.mockReset();
});

describe("useAgentScope — Shape 1 (allAgents:true, Sessions/LLM)", () => {
  function makeScope(filterMode: Ref<"stream" | "agent">, activeStream: Ref<string>) {
    const agents = ref<GenAiAgentListItem[]>([]);
    const agentsLoaded = ref(false);
    const scope = useAgentScope({
      filterMode,
      activeStream,
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      allAgents: true,
      agents,
      agentsLoaded,
      t,
    });
    return { scope, agents, agentsLoaded };
  }

  it("defaults selection to ALL_AGENTS_VALUE and selectedAgent is null", () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    expect(scope.activeAgent.value).toBe(ALL_AGENTS_VALUE);
    expect(scope.selectedAgent.value).toBeNull();
  });

  it("options include an All-Agents entry", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    const values = scope.agentSelectOptions.value.map((o: any) => o.value);
    expect(values).toContain(ALL_AGENTS_VALUE);
  });

  it("picking an agent key resolves the matching agent", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    scope.activeAgent.value = agentOptionKey(agentB);
    expect(scope.selectedAgent.value).toEqual(agentB);
  });

  it("loadAgents writes into the injected (module-scoped) refs", async () => {
    const { scope, agents, agentsLoaded } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA] });
    await scope.loadAgents();
    // same ref instance the page owns
    expect(agents.value).toEqual([agentA]);
    expect(agentsLoaded.value).toBe(true);
  });

  it("loadAgents calls listAgents(org, start, end) from getWindow", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [] });
    await scope.loadAgents();
    expect(listAgents).toHaveBeenCalledWith("org1", 100, 200);
  });

  it("does NOT auto-select the first agent (keeps All-Agents sentinel)", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    expect(scope.activeAgent.value).toBe(ALL_AGENTS_VALUE);
    expect(scope.selectedAgent.value).toBeNull();
  });

  it("effectiveStream in agent mode = selectedAgent.source_stream, else activeStream", async () => {
    const activeStream = ref("live_stream");
    const filterMode = ref<"stream" | "agent">("agent");
    const { scope } = makeScope(filterMode, activeStream);
    listAgents.mockResolvedValue({ agents: [agentA] });
    await scope.loadAgents();
    // All-Agents (null) → source_stream ?? "" → ""
    expect(scope.effectiveStream.value).toBe("");
    scope.activeAgent.value = agentOptionKey(agentA);
    expect(scope.effectiveStream.value).toBe("stream_a");
    filterMode.value = "stream";
    expect(scope.effectiveStream.value).toBe("live_stream");
  });

  it("effectiveAgent is selectedAgent in agent mode, null in stream mode", async () => {
    const filterMode = ref<"stream" | "agent">("agent");
    const { scope } = makeScope(filterMode, ref(""));
    listAgents.mockResolvedValue({ agents: [agentA] });
    await scope.loadAgents();
    scope.activeAgent.value = agentOptionKey(agentA);
    expect(scope.effectiveAgent.value).toEqual(agentA);
    filterMode.value = "stream";
    expect(scope.effectiveAgent.value).toBeNull();
  });

  it("agentEmpty = agent-mode && loaded && no agents", async () => {
    const filterMode = ref<"stream" | "agent">("agent");
    const { scope } = makeScope(filterMode, ref(""));
    listAgents.mockResolvedValue({ agents: [] });
    await scope.loadAgents();
    expect(scope.agentEmpty.value).toBe(true);
    filterMode.value = "stream";
    expect(scope.agentEmpty.value).toBe(false);
  });

  it("uses an injected activeAgent ref as-is (page owns localStorage init)", async () => {
    // Sessions injects its own localStorage-initialized selection ref. The
    // composable must adopt that exact ref instead of seeding a local one.
    const agents = ref<GenAiAgentListItem[]>([agentA, agentB]);
    const agentsLoaded = ref(true);
    const injectedActiveAgent = ref<string>(agentOptionKey(agentB));
    const scope = useAgentScope({
      filterMode: ref("agent"),
      activeStream: ref(""),
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      allAgents: true,
      agents,
      agentsLoaded,
      activeAgent: injectedActiveAgent,
      t,
    });
    // Same instance — not re-seeded to the sentinel.
    expect(scope.activeAgent).toBe(injectedActiveAgent);
    expect(scope.activeAgent.value).toBe(agentOptionKey(agentB));
    // Resolution reads through the injected ref.
    expect(scope.selectedAgent.value).toEqual(agentB);
    // Mutating the page's ref flows into the composable's derived state.
    injectedActiveAgent.value = ALL_AGENTS_VALUE;
    expect(scope.selectedAgent.value).toBeNull();
  });

  it("on listAgents rejection: empties agents, resets selection to All-Agents, marks loaded", async () => {
    const { scope, agents } = makeScope(ref("agent"), ref(""));
    listAgents.mockRejectedValue(new Error("boom"));
    await scope.loadAgents();
    expect(agents.value).toEqual([]);
    expect(scope.activeAgent.value).toBe(ALL_AGENTS_VALUE);
    expect(scope.agentsLoaded.value).toBe(true);
  });
});

describe("useAgentScope — Shape 2 (allAgents:false, Graph/Behavior)", () => {
  function makeScope(filterMode: Ref<"stream" | "agent">, activeStream: Ref<string>) {
    const scope = useAgentScope({
      filterMode,
      activeStream,
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      allAgents: false,
      t,
    });
    return { scope };
  }

  it("creates local agents/agentsLoaded refs when none injected", () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    expect(scope.agents.value).toEqual([]);
    expect(scope.agentsLoaded.value).toBe(false);
  });

  it("auto-selects the first agent after loadAgents", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    expect(scope.activeAgent.value).toBe(agentOptionKey(agentA));
    expect(scope.selectedAgent.value).toEqual(agentA);
  });

  it("options do NOT include an All-Agents entry", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA] });
    await scope.loadAgents();
    const values = scope.agentSelectOptions.value.map((o: any) => o.value);
    expect(values).not.toContain(ALL_AGENTS_VALUE);
  });

  it("Behavior-equivalence: effectiveStream resolves to the first agent's source_stream (?? \"\" invisible)", async () => {
    const activeStream = ref("live_stream");
    const filterMode = ref<"stream" | "agent">("agent");
    const { scope } = makeScope(filterMode, activeStream);
    listAgents.mockResolvedValue({ agents: [agentA] });
    await scope.loadAgents();
    // With a first-agent default, source_stream is non-empty so the `?? ""`
    // (normalized from Behavior's `?? activeStream.value`) never triggers.
    expect(scope.selectedAgent.value).toEqual(agentA);
    expect(scope.effectiveStream.value).toBe("stream_a");
    expect(scope.effectiveStream.value).not.toBe("");
  });

  it("does not re-default the first agent if a selection already exists", async () => {
    const { scope } = makeScope(ref("agent"), ref(""));
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    scope.activeAgent.value = agentOptionKey(agentB);
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    expect(scope.activeAgent.value).toBe(agentOptionKey(agentB));
  });
});

describe("useAgentScope — Env→Agent→Version cascade (Plan 2)", () => {
  // 3 in production (a@v1, a@v2, b@v1), 1 in staging (a@v1), 1 with null env/version.
  const CASCADE_AGENTS: GenAiAgentListItem[] = [
    { name: "a", id: "a", source_stream: "s", source_stream_type: "traces", env: "production", version: "v1" },
    { name: "a", id: "a", source_stream: "s", source_stream_type: "traces", env: "production", version: "v2" },
    { name: "b", id: "b", source_stream: "s", source_stream_type: "traces", env: "production", version: "v1" },
    { name: "a", id: "a", source_stream: "s", source_stream_type: "traces", env: "staging", version: "v1" },
    { name: "x", id: "x", source_stream: "s", source_stream_type: "traces", env: null, version: null },
  ];
  const SINGLE_ENV_AGENTS: GenAiAgentListItem[] = [
    { name: "a", id: "a", source_stream: "s", source_stream_type: "traces", env: "production", version: "v1" },
    { name: "b", id: "b", source_stream: "s", source_stream_type: "traces", env: "production", version: "v2" },
  ];

  function makeCascade(list: GenAiAgentListItem[]) {
    return useAgentScope({
      filterMode: ref<"stream" | "agent">("agent"),
      activeStream: ref(""),
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      cascade: true,
      agents: ref<GenAiAgentListItem[]>(list),
      agentsLoaded: ref(true),
      t,
    });
  }

  it("exposes a stable UNSET sentinel", () => {
    expect(UNSET).toBe("__unset__");
    expect(UNSET).not.toBe("");
  });

  it("derives Env→Agent→Version cascade with auto-select + unset", () => {
    const scope = makeCascade(CASCADE_AGENTS);
    // envs: production, staging, UNSET
    expect(scope.envs.value.map((e: any) => e.value)).toEqual([
      "production",
      "staging",
      UNSET,
    ]);
    scope.selectedEnv.value = "production";
    // agentNames within production: a, b
    expect(scope.agentNames.value.map((a: any) => a.value)).toEqual(["a", "b"]);
    scope.selectedAgentName.value = "a";
    // versions within production+a: v1, v2
    expect(scope.versions.value.map((v: any) => v.value)).toEqual(["v1", "v2"]);
    scope.selectedVersion.value = "v2";
    expect(scope.selectedAgent.value).toMatchObject({
      name: "a",
      env: "production",
      version: "v2",
    });
  });

  it("auto-selects a dimension with a single value", () => {
    const scope = makeCascade(SINGLE_ENV_AGENTS);
    // Only one env → auto-selected.
    expect(scope.selectedEnv.value).toBe("production");
  });

  it("resets lower levels when a higher level changes", () => {
    const scope = makeCascade(CASCADE_AGENTS);
    scope.selectedEnv.value = "production";
    scope.selectedAgentName.value = "a";
    scope.selectedVersion.value = "v2";
    scope.selectedEnv.value = "staging"; // change env
    // staging has no v2 for agent a → version must not stay v2.
    expect(scope.selectedVersion.value).not.toBe("v2");
  });

  it("represents null env/version as the UNSET option", () => {
    const scope = makeCascade([
      { name: "x", id: "x", source_stream: "s", source_stream_type: "traces", env: null, version: null },
    ]);
    expect(scope.envs.value.some((e: any) => e.value === UNSET)).toBe(true);
    // Single env (UNSET) auto-selects; then agent x auto-selects; version UNSET auto-selects.
    scope.selectedEnv.value = UNSET;
    scope.selectedAgentName.value = "x";
    expect(scope.versions.value.some((v: any) => v.value === UNSET)).toBe(true);
    scope.selectedVersion.value = UNSET;
    expect(scope.selectedAgent.value).toMatchObject({
      name: "x",
      env: null,
      version: null,
    });
  });

  it("versionAgnostic auto-picks the first version so selectedAgent resolves from env + name alone (Agent Graph)", () => {
    // Graph hides the Version dropdown; with several versions, a version-aware
    // cascade would leave selectedVersion "" → no agent. versionAgnostic must
    // auto-select the first version so an agent still resolves.
    const scope = useAgentScope({
      filterMode: ref<"stream" | "agent">("agent"),
      activeStream: ref(""),
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      cascade: true,
      versionAgnostic: true,
      agents: ref<GenAiAgentListItem[]>(CASCADE_AGENTS),
      agentsLoaded: ref(true),
      t,
    });
    scope.selectedEnv.value = "production";
    scope.selectedAgentName.value = "a";
    // production+a has v1, v2 — versionAgnostic pins the first (v1) rather than
    // leaving it empty, so an agent resolves.
    expect(scope.selectedVersion.value).toBe("v1");
    expect(scope.selectedAgent.value).toMatchObject({
      name: "a",
      env: "production",
      version: "v1",
    });
  });

  it("cascade is off by default — envs/agentNames/versions are empty, selectedAgent uses activeAgent", async () => {
    const scope = useAgentScope({
      filterMode: ref<"stream" | "agent">("agent"),
      activeStream: ref(""),
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      allAgents: false,
      t,
    });
    expect(scope.envs.value).toEqual([]);
    expect(scope.agentNames.value).toEqual([]);
    expect(scope.versions.value).toEqual([]);
    listAgents.mockResolvedValue({ agents: [agentA, agentB] });
    await scope.loadAgents();
    // Single-dropdown path still resolves the first agent unchanged.
    expect(scope.selectedAgent.value).toEqual(agentA);
  });
});

describe("useAgentScope — stream options", () => {
  it("streamSelectOptions + selectedStreamCount reflect availableStreams and agent counts", async () => {
    const activeStream = ref("stream_a");
    const availableStreams = ref<string[]>(["stream_a", "stream_b"]);
    const scope = useAgentScope({
      filterMode: ref("stream"),
      activeStream,
      availableStreams,
      orgId: () => "org1",
      getWindow: () => ({ start: 100, end: 200 }),
      allAgents: true,
      t,
    });
    listAgents.mockResolvedValue({ agents: [agentA, agentA] });
    await scope.loadAgents();
    const streamA = scope.streamSelectOptions.value.find((o: any) => o.value === "stream_a");
    expect(streamA?.agentCount).toBe(2);
    expect(scope.selectedStreamCount.value).toBe(2);
  });
});
