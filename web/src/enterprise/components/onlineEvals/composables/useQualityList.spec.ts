// @vitest-environment jsdom
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { QualityConfigSummary, ScoreConfig } from "@/services/online-evals.service";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

const agent = (id: string | null, name: string): GenAiAgentListItem => ({
  id,
  name,
  source_stream: "default",
  source_stream_type: "traces",
  env: "prod",
  version: "1",
});

const { list, failedRuns } = vi.hoisted(() => ({ list: vi.fn(), failedRuns: vi.fn() }));

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, quality: { list, scores: vi.fn(), failedRuns } },
  };
});

import { joinQualityRows, qualityTiles, useQualityList } from "./useQualityList";

const summary = (overrides: Partial<QualityConfigSummary>): QualityConfigSummary => ({
  configId: "id",
  name: "name",
  dataType: "numeric",
  status: "healthy",
  total: 10,
  unhealthy: 0,
  average: 0.5,
  lastScoredAt: 100,
  scopeCounts: { span: 0, trace: 10, session: 0 },
  topValue: null,
  ...overrides,
});

const LIST: QualityConfigSummary[] = [
  summary({ configId: "hal", name: "hallucination", status: "attention", unhealthy: 7, total: 38 }),
  summary({
    configId: "tox",
    name: "toxicity",
    dataType: "categorical",
    status: "attention",
    unhealthy: 67,
    total: 114,
    lastScoredAt: 1791199632199574,
    topValue: { key: "medium", count: 67 },
  }),
  summary({ configId: "con", name: "conciseness", status: "unset", unhealthy: null }),
  summary({
    configId: "gro",
    name: "groundedness_v2",
    status: "no_data",
    total: 0,
    lastScoredAt: null,
    average: null,
  }),
];

const CONFIGS: ScoreConfig[] = [
  {
    id: "row-1",
    entityId: "hal",
    name: "hallucination",
    version: 2,
    dataType: "numeric",
    description: "Likelihood that the response invents facts.",
    numericRange: { min: 0, max: 1 },
    healthyThreshold: { direction: "lte", value: 0.2 },
  },
  {
    id: "row-2",
    entityId: "tox",
    name: "toxicity",
    version: 1,
    dataType: "categorical",
    description: "Toxicity level of the response.",
    healthyThreshold: { healthy_categories: ["low"] },
  },
];

describe("joinQualityRows", () => {
  it("adds description, version, range and the threshold rule by entity id", () => {
    const rows = joinQualityRows(LIST, CONFIGS);
    expect(rows[0]).toMatchObject({
      configId: "hal",
      description: "Likelihood that the response invents facts.",
      version: 2,
      thresholdLabel: "≤ 0.2",
      range: { min: 0, max: 1 },
    });
    expect(rows[1].thresholdLabel).toBe("low");
    // A config missing from the list keeps empty defaults and the 0 to 1 range.
    expect(rows[2]).toMatchObject({ description: "", version: null, thresholdLabel: "" });
    expect(rows[2].range).toEqual({ min: 0, max: 1 });
  });
});

describe("qualityTiles", () => {
  it("counts configs needing attention and configs without a result, by reason", () => {
    expect(qualityTiles(joinQualityRows(LIST, CONFIGS))).toEqual({
      total: 4,
      attention: 2,
      withoutResult: 2,
      noScores: 1,
      noThreshold: 1,
    });
  });

  it("counts nothing on an empty list", () => {
    expect(qualityTiles([])).toEqual({
      total: 0,
      attention: 0,
      withoutResult: 0,
      noScores: 0,
      noThreshold: 0,
    });
  });
});

describe("useQualityList", () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue(LIST);
    failedRuns.mockReset().mockResolvedValue(3);
  });

  function mountList(agentParams = {}, evaluatorAgents: GenAiAgentListItem[] | null = null) {
    let api!: ReturnType<typeof useQualityList>;
    const Host = defineComponent({
      setup() {
        api = useQualityList({
          scoreConfigs: ref(CONFIGS),
          dateWindow: ref({ startUs: 1_000_000_000, endUs: 2_000_000_000 }),
          agentParams: ref(agentParams),
          evaluatorAgents: ref(evaluatorAgents),
          enabled: ref(true),
        });
        return () => null;
      },
    });
    mount(Host, { global: { plugins: [store, withQueryClient()] } });
    return () => api;
  }

  it("reads the list and the failed-run count with the window and the agent filter", async () => {
    const api = mountList({ agent_id: "a1", agent_env: "prod" }, [agent("a1", "alpha")]);
    await flushPromises();
    expect(list).toHaveBeenCalledWith("default", {
      start_time: 1_000_000_000,
      end_time: 2_000_000_000,
      agent_id: "a1",
      agent_env: "prod",
    });
    expect(failedRuns).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ agentWhere: "(attributes_target_agent_id = 'a1')" }),
    );
    expect(api().rows.value.map((row) => row.configId)).toEqual(["hal", "tox", "con", "gro"]);
    expect(api().failedRuns.value).toBe(3);
  });

  it("counts failed runs for every agent an Env or Version selects", async () => {
    mountList({ agent_env: "prod" }, [agent("a1", "alpha"), agent(null, "beta")]);
    await flushPromises();
    expect(failedRuns).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        agentWhere:
          "(attributes_target_agent_id = 'a1') OR (attributes_target_agent_name = 'beta')",
      }),
    );
  });

  it("shows no failed-run count when no agent matches the selection", async () => {
    const api = mountList({ agent_env: "nowhere" }, []);
    await flushPromises();
    expect(failedRuns).not.toHaveBeenCalled();
    expect(api().failedRuns.value).toBeNull();
  });

  it("filters by one tile at a time: needing attention, or without a result", async () => {
    const api = mountList();
    await flushPromises();
    expect(failedRuns).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ agentWhere: null }),
    );
    const visible = () => api().visibleRows.value.map((row) => row.configId);
    api().tileFilter.value = "attention";
    expect(visible()).toEqual(["hal", "tox"]);
    api().tileFilter.value = "withoutResult";
    expect(visible()).toEqual(["con", "gro"]);
    api().tileFilter.value = null;
    expect(visible()).toHaveLength(4);
  });

  it("reports a 403 from the list request", async () => {
    list.mockReset().mockRejectedValue({ response: { status: 403 } });
    const api = mountList();
    await flushPromises();
    expect(api().listStatus.value).toBe(403);
  });
});
