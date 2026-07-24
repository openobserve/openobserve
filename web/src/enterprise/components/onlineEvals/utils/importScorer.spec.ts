import { describe, it, expect } from "vitest";
import { normalizeScorerInput, prepareScorerImport, validateScorer } from "./importScorer";
import type { Provider, ScoreConfig } from "@/services/online-evals.service";

const sc = (over: Partial<ScoreConfig> = {}): ScoreConfig =>
  ({
    id: "sc-id",
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

const baseCtx = {
  itemIndex: 0,
  existingNames: new Set<string>(),
  nameCounts: new Map<string, number>(),
  scoreConfigs: [] as ScoreConfig[],
  providers: [] as Provider[],
};

describe("normalizeScorerInput", () => {
  it("returns null for non-objects", () => {
    expect(normalizeScorerInput(null)).toBeNull();
    expect(normalizeScorerInput([])).toBeNull();
    expect(normalizeScorerInput("foo")).toBeNull();
  });

  it("accepts the nested {name, description, scorer} envelope", () => {
    const out = normalizeScorerInput({
      name: "judge",
      description: "x",
      scorer: {
        type: "llm_judge",
        producesScoreConfigId: "sc-1",
        template: "t",
        params: { provider_id: "p-1", model: "gpt-4" },
      },
    });
    expect(out?.name).toBe("judge");
    expect(out?.scorer?.type).toBe("llm_judge");
    expect(out?.scorer?.producesScoreConfigId).toBe("sc-1");
    expect(out?.scorer?.params?.provider_id).toBe("p-1");
  });

  it("accepts a flattened legacy shape", () => {
    const out = normalizeScorerInput({
      name: "j",
      type: "llm_judge",
      producesScoreConfigId: "sc-2",
      template: "t",
      params: { provider_id: "p-2" },
    });
    expect(out?.scorer?.type).toBe("llm_judge");
    expect(out?.scorer?.producesScoreConfigId).toBe("sc-2");
  });

  it("accepts snake_case keys", () => {
    const out = normalizeScorerInput({
      name: "j",
      scorer: {
        scorer_type: "remote",
        produces_score_config_id: "sc-3",
        produces_score_config_name: "fallback",
        produces_score_config_version: 2,
        template: "t",
      },
    });
    expect(out?.scorer?.type).toBe("remote");
    expect(out?.scorer?.producesScoreConfigId).toBe("sc-3");
    expect(out?.scorer?.producesScoreConfigName).toBe("fallback");
    expect(out?.scorer?.producesScoreConfigVersion).toBe(2);
  });

  it("normalizes providerName from camel or snake forms inside params", () => {
    const a = normalizeScorerInput({
      name: "j",
      scorer: { type: "llm_judge", template: "t", params: { providerName: "OpenAI" } },
    });
    expect(a?.scorer?.params?.providerName).toBe("OpenAI");

    const b = normalizeScorerInput({
      name: "j",
      scorer: { type: "llm_judge", template: "t", params: { provider_name: "OpenAI" } },
    });
    expect(b?.scorer?.params?.providerName).toBe("OpenAI");
  });

  it("preserves remote params as-is (free-form)", () => {
    const out = normalizeScorerInput({
      name: "j",
      scorer: {
        type: "remote",
        producesScoreConfigId: "sc",
        template: "t",
        params: { url: "https://x", headers: { auth: "y" }, customField: 1 },
      },
    });
    expect(out?.scorer?.params?.url).toBe("https://x");
    expect(out?.scorer?.params?.headers).toEqual({ auth: "y" });
    expect(out?.scorer?.params?.customField).toBe(1);
  });
});

describe("validateScorer — basic shape", () => {
  it("requires name", () => {
    const res = validateScorer(
      { scorer: { type: "llm_judge", producesScoreConfigId: "sc-ent", template: "t", params: {} } },
      { ...baseCtx, scoreConfigs: [sc()] },
    );
    expect(res.errors.find((e) => e.field === "name")?.fixable).toBe(true);
  });

  it("requires a valid scorer.type", () => {
    const res = validateScorer(
      { name: "j", scorer: { type: "bogus" as any, template: "t", params: {} } },
      baseCtx,
    );
    expect(res.errors.find((e) => e.field === "type")?.fixable).toBe(true);
  });

  it("rejects null normalized input", () => {
    const res = validateScorer(null, baseCtx);
    expect(res.errors[0].field).toBe("shape");
  });
});

describe("validateScorer — score config resolution", () => {
  it("resolves by ID when present locally", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.payload?.scorer.producesScoreConfigId).toBe("sc-ent");
    expect(res.errors).toEqual([]);
  });

  it("falls back to name when ID does not match local", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "stale-id",
          producesScoreConfigName: "answer_relevance",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.payload?.scorer.producesScoreConfigId).toBe("sc-ent");
    expect(res.errors).toEqual([]);
  });

  it("flags fixable error when neither ID nor name resolves", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "missing",
          producesScoreConfigName: "missing",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.errors.find((e) => e.field === "scoreConfigRef")?.fixable).toBe(true);
    expect(res.payload).toBeNull();
  });

  it("flags fixable error when neither ref is provided", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: { type: "llm_judge", template: "t", params: { provider_id: "prov-id" } },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.errors.find((e) => e.field === "scoreConfigRef")).toBeDefined();
  });
});

describe("validateScorer — provider resolution (llm_judge)", () => {
  it("resolves by ID when present locally", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.payload?.scorer.params.provider_id).toBe("prov-id");
  });

  it("falls back to providerName", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { provider_id: "stale", providerName: "OpenAI" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.payload?.scorer.params.provider_id).toBe("prov-id");
    expect(res.payload?.scorer.params).not.toHaveProperty("providerName");
  });

  it("flags fixable error when llm_judge has no provider", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: {},
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.errors.find((e) => e.field === "providerRef")?.fixable).toBe(true);
  });

  it("does not require provider for remote scorers", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "remote",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { url: "https://x" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()] },
    );
    expect(res.errors).toEqual([]);
    expect(res.payload?.scorer.type).toBe("remote");
  });
});

describe("validateScorer — template requirement (llm_judge)", () => {
  it("requires non-empty template for llm_judge", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "",
          params: { provider_id: "prov-id" },
        },
      },
      { ...baseCtx, scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(res.errors.find((e) => e.field === "template")).toBeDefined();
  });

  it("does not require template for remote", () => {
    const res = validateScorer(
      {
        name: "j",
        scorer: { type: "remote", producesScoreConfigId: "sc-ent", template: "", params: {} },
      },
      { ...baseCtx, scoreConfigs: [sc()] },
    );
    expect(res.errors).toEqual([]);
  });
});

describe("validateScorer — name conflicts", () => {
  it("flags org-wide conflict", () => {
    const res = validateScorer(
      {
        name: "exists",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      {
        ...baseCtx,
        existingNames: new Set(["exists"]),
        scoreConfigs: [sc()],
        providers: [prov()],
      },
    );
    expect(res.errors.find((e) => e.field === "nameConflict")?.fixable).toBe(true);
  });

  it("flags in-batch duplicate", () => {
    const res = validateScorer(
      {
        name: "dup",
        scorer: {
          type: "llm_judge",
          producesScoreConfigId: "sc-ent",
          template: "t",
          params: { provider_id: "prov-id" },
        },
      },
      {
        ...baseCtx,
        nameCounts: new Map([["dup", 2]]),
        scoreConfigs: [sc()],
        providers: [prov()],
      },
    );
    expect(res.errors.find((e) => e.field === "duplicate")).toBeDefined();
  });
});

describe("prepareScorerImport", () => {
  it("builds payloads for clean batches", () => {
    const result = prepareScorerImport(
      [
        {
          name: "a",
          scorer: {
            type: "llm_judge",
            producesScoreConfigId: "sc-ent",
            template: "t",
            params: { provider_id: "prov-id" },
          },
        },
      ],
      {
        existingScorerNames: [],
        scoreConfigs: [sc()],
        providers: [prov()],
      },
    );

    expect(result.hasErrors).toBe(false);
    expect(result.items[0].payload).toEqual({
      name: "a",
      scorer: {
        type: "llm_judge",
        producesScoreConfigId: "sc-ent",
        template: "t",
        params: { provider_id: "prov-id" },
      },
    });
  });

  it("aggregates errors across multiple items", () => {
    const result = prepareScorerImport([{ scorer: { type: "llm_judge" } }, { name: "x" }], {
      existingScorerNames: [],
      scoreConfigs: [sc()],
      providers: [prov()],
    });
    expect(result.hasErrors).toBe(true);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("detects in-batch duplicates", () => {
    const result = prepareScorerImport(
      [
        {
          name: "same",
          scorer: {
            type: "remote",
            producesScoreConfigId: "sc-ent",
            template: "t",
            params: {},
          },
        },
        {
          name: "same",
          scorer: {
            type: "remote",
            producesScoreConfigId: "sc-ent",
            template: "t",
            params: {},
          },
        },
      ],
      { existingScorerNames: [], scoreConfigs: [sc()], providers: [prov()] },
    );
    expect(result.errors.filter((e) => e.field === "duplicate")).toHaveLength(2);
  });

  it("strips providerName from final payload", () => {
    const result = prepareScorerImport(
      [
        {
          name: "j",
          scorer: {
            type: "llm_judge",
            producesScoreConfigId: "sc-ent",
            template: "t",
            params: { providerName: "OpenAI", model: "gpt-4" },
          },
        },
      ],
      { existingScorerNames: [], scoreConfigs: [sc()], providers: [prov()] },
    );
    const params = result.items[0].payload?.scorer.params;
    expect(params).not.toHaveProperty("providerName");
    expect(params?.provider_id).toBe("prov-id");
    expect(params?.model).toBe("gpt-4");
  });
});
