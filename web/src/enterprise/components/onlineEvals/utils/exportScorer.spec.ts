import { describe, it, expect } from "vitest";
import {
  bulkExportFileName,
  exportScorerFileName,
  stripScorerForExport,
} from "./exportScorer";
import { normalizeScorerInput, prepareScorerImport } from "./importScorer";
import type { Provider, ScoreConfig, Scorer } from "@/services/online-evals.service";

const sc = (over: Partial<ScoreConfig> = {}): ScoreConfig =>
  ({
    id: "sc-raw",
    entityId: "sc-ent",
    name: "answer_relevance",
    version: 1,
    dataType: "numeric",
    ...over,
  }) as ScoreConfig;

const prov = (over: Partial<Provider> = {}): Provider =>
  ({
    id: "prov-id",
    name: "OpenAI",
    providerType: "openai",
    defaultModel: "gpt-4",
    availableModels: [],
    isDefault: false,
    ...over,
  }) as Provider;

const scorer = (over: Partial<Scorer> & Record<string, any> = {}): Scorer =>
  ({
    id: "scorer-id",
    entityId: "scorer-ent",
    name: "answer_relevance_judge",
    version: 1,
    scorerType: "llm_judge",
    producesScoreConfigId: "sc-ent",
    producesScoreConfigVersion: null,
    template: "Rate the relevance.",
    params: { provider_id: "prov-id", model: "gpt-4", include_reasoning: true },
    ...over,
  }) as Scorer;

describe("stripScorerForExport", () => {
  it("drops scorer's own server-managed fields", () => {
    const out = stripScorerForExport(scorer(), { scoreConfigs: [sc()], providers: [prov()] });
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("entityId");
    expect(out).not.toHaveProperty("version");
    expect(out).not.toHaveProperty("createdAt");
    expect(out).not.toHaveProperty("isActive");
    expect(out.name).toBe("answer_relevance_judge");
  });

  it("embeds BOTH score config ID and resolved name", () => {
    const out = stripScorerForExport(scorer(), { scoreConfigs: [sc()], providers: [prov()] });
    expect(out.scorer.producesScoreConfigId).toBe("sc-ent");
    expect(out.scorer.producesScoreConfigName).toBe("answer_relevance");
  });

  it("does not embed score config name when ID does not resolve", () => {
    const out = stripScorerForExport(
      scorer({ producesScoreConfigId: "stale-id" }),
      { scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(out.scorer.producesScoreConfigId).toBe("stale-id");
    expect(out.scorer.producesScoreConfigName).toBeUndefined();
  });

  it("embeds providerName for llm_judge when provider resolves", () => {
    const out = stripScorerForExport(scorer(), { scoreConfigs: [sc()], providers: [prov()] });
    expect(out.scorer.params.provider_id).toBe("prov-id");
    expect(out.scorer.params.providerName).toBe("OpenAI");
  });

  it("does not embed providerName for remote scorers", () => {
    const out = stripScorerForExport(
      scorer({
        scorerType: "remote",
        params: { url: "https://x", headers: { auth: "y" } },
      }),
      { scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(out.scorer.params).not.toHaveProperty("providerName");
    expect(out.scorer.params.url).toBe("https://x");
  });

  it("preserves remote params verbatim", () => {
    const out = stripScorerForExport(
      scorer({
        scorerType: "remote",
        params: { url: "https://x", headers: { Authorization: "Bearer y" }, customField: 1 },
      }),
      { scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(out.scorer.params).toEqual({
      url: "https://x",
      headers: { Authorization: "Bearer y" },
      customField: 1,
    });
  });

  it("normalizes snake_case input keys to camel envelope on output", () => {
    const out = stripScorerForExport(
      {
        id: "x",
        name: "j",
        version: 1,
        scorer_type: "llm_judge",
        produces_score_config_id: "sc-ent",
        produces_score_config_version: 3,
        template: "t",
        params: { provider_id: "prov-id" },
      } as any,
      { scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(out.scorer.type).toBe("llm_judge");
    expect(out.scorer.producesScoreConfigId).toBe("sc-ent");
    expect(out.scorer.producesScoreConfigVersion).toBe(3);
  });

  it("round-trips through normalizeScorerInput", () => {
    const exported = stripScorerForExport(scorer(), {
      scoreConfigs: [sc()],
      providers: [prov()],
    });
    const normalized = normalizeScorerInput(exported);
    expect(normalized?.name).toBe(exported.name);
    expect(normalized?.scorer?.type).toBe(exported.scorer.type);
    expect(normalized?.scorer?.producesScoreConfigId).toBe(exported.scorer.producesScoreConfigId);
    expect(normalized?.scorer?.producesScoreConfigName).toBe(exported.scorer.producesScoreConfigName);
    expect(normalized?.scorer?.params?.provider_id).toBe(exported.scorer.params.provider_id);
    expect(normalized?.scorer?.params?.providerName).toBe(exported.scorer.params.providerName);
  });

  it("exported payload passes prepareScorerImport in the same org", () => {
    const exported = stripScorerForExport(scorer(), {
      scoreConfigs: [sc()],
      providers: [prov()],
    });
    const prepared = prepareScorerImport([exported], {
      existingScorerNames: [],
      scoreConfigs: [sc()],
      providers: [prov()],
    });
    expect(prepared.hasErrors).toBe(false);
    expect(prepared.items[0].payload?.scorer.producesScoreConfigId).toBe("sc-ent");
    expect(prepared.items[0].payload?.scorer.params.provider_id).toBe("prov-id");
  });

  it("exported payload still imports in a target org with different IDs (resolves by name)", () => {
    // Source org: ids `sc-ent`, `prov-id`. Target org: ids `target-sc`, `target-prov`.
    const exported = stripScorerForExport(scorer(), {
      scoreConfigs: [sc()],
      providers: [prov()],
    });
    const prepared = prepareScorerImport([exported], {
      existingScorerNames: [],
      scoreConfigs: [sc({ id: "target-sc-raw", entityId: "target-sc" })],
      providers: [prov({ id: "target-prov" })],
    });
    expect(prepared.hasErrors).toBe(false);
    expect(prepared.items[0].payload?.scorer.producesScoreConfigId).toBe("target-sc");
    expect(prepared.items[0].payload?.scorer.params.provider_id).toBe("target-prov");
  });
});

describe("exportScorerFileName", () => {
  it("uses name as filename", () => {
    expect(exportScorerFileName({ name: "judge" } as any)).toBe("judge.json");
  });

  it("sanitizes unsafe characters", () => {
    expect(exportScorerFileName({ name: "foo/bar?" } as any)).toBe("foo_bar_.json");
  });

  it("falls back to scorer when name missing", () => {
    expect(exportScorerFileName({} as any)).toBe("scorer.json");
  });
});

describe("bulkExportFileName", () => {
  it("uses ISO date prefix", () => {
    const d = new Date("2026-06-08T12:00:00Z");
    expect(bulkExportFileName(d)).toBe("scorers-2026-06-08.json");
  });
});
