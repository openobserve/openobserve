import { describe, it, expect } from "vitest";
import {
  bulkExportFileName,
  exportScoreConfigFileName,
  stripScoreConfigForExport,
} from "./exportScoreConfig";
import { normalizeScoreConfigInput, prepareScoreConfigImport } from "./importScoreConfig";

describe("stripScoreConfigForExport", () => {
  it("drops server-managed fields", () => {
    const out = stripScoreConfigForExport({
      id: "row-id",
      entity_id: "ent-id",
      orgId: "org-x",
      version: 4,
      isActive: true,
      created_at: 1700000000,
      updated_at: 1700000001,
      name: "latency",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
    } as any);

    expect(out).toEqual({
      name: "latency",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
    });
  });

  it("normalizes snake_case to camel on output", () => {
    const out = stripScoreConfigForExport({
      id: "x",
      name: "tone",
      data_type: "categorical",
      numeric_range: null,
      categories: ["good", "bad"],
    } as any);

    expect(out.dataType).toBe("categorical");
    expect(out.categories).toEqual(["good", "bad"]);
    expect(out.numericRange).toBeUndefined();
  });

  it("preserves healthyThreshold inner key shape (snake form)", () => {
    const out = stripScoreConfigForExport({
      id: "x",
      name: "n",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
      healthyThreshold: { direction: "gte", value: 0.8 },
    } as any);

    expect(out.healthyThreshold).toEqual({ direction: "gte", value: 0.8 });
  });

  it("accepts camelCase healthyThreshold inner keys and emits snake form", () => {
    const out = stripScoreConfigForExport({
      id: "x",
      name: "n",
      dataType: "categorical",
      categories: ["a"],
      healthyThreshold: { healthyCategories: ["a"] },
    } as any);

    expect(out.healthyThreshold).toEqual({ healthy_categories: ["a"] });
  });

  it("drops empty/invalid numericRange", () => {
    const out = stripScoreConfigForExport({
      id: "x",
      name: "n",
      dataType: "boolean",
      numericRange: { min: "0", max: "1" } as any,
    } as any);
    expect(out.numericRange).toBeUndefined();
  });

  it("drops description when null", () => {
    const out = stripScoreConfigForExport({
      id: "x",
      name: "n",
      dataType: "boolean",
      description: null,
    } as any);
    expect(out).not.toHaveProperty("description");
  });

  it("round-trips through the import normalizer cleanly", () => {
    const original = {
      id: "abc",
      entity_id: "def",
      version: 7,
      orgId: "org",
      isActive: true,
      createdAt: 1,
      updatedAt: 2,
      name: "answer_relevance",
      description: "Degree to which the output answers the question.",
      dataType: "numeric" as const,
      numericRange: { min: 0, max: 1 },
      healthyThreshold: { direction: "gte" as const, value: 0.8 },
    };

    const exported = stripScoreConfigForExport(original as any);
    const reImported = normalizeScoreConfigInput(exported);
    expect(reImported).toEqual(exported);
  });

  it("emits a payload that passes prepareScoreConfigImport", () => {
    const exported = stripScoreConfigForExport({
      id: "x",
      name: "coherence",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
    } as any);

    const prepared = prepareScoreConfigImport([exported], []);
    expect(prepared.hasErrors).toBe(false);
    expect(prepared.items[0].payload).toEqual(exported);
  });
});

describe("exportScoreConfigFileName", () => {
  it("uses name as filename", () => {
    expect(exportScoreConfigFileName({ name: "latency" } as any)).toBe("latency.json");
  });

  it("sanitizes path-unsafe characters", () => {
    expect(exportScoreConfigFileName({ name: "foo/bar baz?" } as any)).toBe("foo_bar_baz_.json");
  });

  it("falls back to score-config when name missing", () => {
    expect(exportScoreConfigFileName({} as any)).toBe("score-config.json");
  });

  it("falls back when name is whitespace", () => {
    expect(exportScoreConfigFileName({ name: "   " } as any)).toBe("score-config.json");
  });
});

describe("bulkExportFileName", () => {
  it("uses ISO date prefix", () => {
    const d = new Date("2026-06-08T12:00:00Z");
    expect(bulkExportFileName(d)).toBe("score-configs-2026-06-08.json");
  });
});
