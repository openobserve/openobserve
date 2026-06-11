import { describe, it, expect } from "vitest";
import {
  normalizeScoreConfigInput,
  prepareScoreConfigImport,
  validateScoreConfig,
} from "./importScoreConfig";

describe("normalizeScoreConfigInput", () => {
  it("returns null for non-objects", () => {
    expect(normalizeScoreConfigInput(null)).toBeNull();
    expect(normalizeScoreConfigInput(undefined)).toBeNull();
    expect(normalizeScoreConfigInput("foo")).toBeNull();
    expect(normalizeScoreConfigInput([1, 2])).toBeNull();
  });

  it("accepts camelCase keys", () => {
    const out = normalizeScoreConfigInput({
      name: "latency",
      dataType: "numeric",
      numericRange: { min: 0, max: 10 },
    });
    expect(out).toEqual({
      name: "latency",
      dataType: "numeric",
      numericRange: { min: 0, max: 10 },
    });
  });

  it("accepts snake_case keys and normalizes to camel", () => {
    const out = normalizeScoreConfigInput({
      name: "latency",
      data_type: "numeric",
      numeric_range: { min: 0, max: 10 },
    });
    expect(out).toEqual({
      name: "latency",
      dataType: "numeric",
      numericRange: { min: 0, max: 10 },
    });
  });

  it("strips unknown fields like id, version, createdAt", () => {
    const out = normalizeScoreConfigInput({
      id: "abc",
      entity_id: "abc",
      version: 3,
      isActive: true,
      created_at: 1700000000,
      name: "x",
      dataType: "boolean",
    });
    expect(out).toEqual({ name: "x", dataType: "boolean" });
  });

  it("normalizes healthyThreshold inner keys (camel) to snake form the server expects", () => {
    const out = normalizeScoreConfigInput({
      name: "n",
      dataType: "categorical",
      categories: ["a", "b"],
      healthyThreshold: { healthyCategories: ["a"] },
    });
    expect(out?.healthyThreshold).toEqual({ healthy_categories: ["a"] });
  });

  it("preserves healthyThreshold snake keys as-is", () => {
    const out = normalizeScoreConfigInput({
      name: "n",
      dataType: "boolean",
      healthy_threshold: { healthy_value: true },
    });
    expect(out?.healthyThreshold).toEqual({ healthy_value: true });
  });

  it("preserves numeric healthyThreshold direction/value pair", () => {
    const out = normalizeScoreConfigInput({
      name: "n",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
      healthyThreshold: { direction: "gte", value: 0.8 },
    });
    expect(out?.healthyThreshold).toEqual({ direction: "gte", value: 0.8 });
  });
});

describe("validateScoreConfig", () => {
  const baseCtx = {
    itemIndex: 0,
    existingNames: new Set<string>(),
    nameCounts: new Map<string, number>(),
  };

  it("rejects null normalized input", () => {
    const errs = validateScoreConfig(null, baseCtx);
    expect(errs).toHaveLength(1);
    expect(errs[0].field).toBe("shape");
  });

  it("requires name", () => {
    const errs = validateScoreConfig(
      { dataType: "boolean" },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "name")).toBeDefined();
    expect(errs.find((e) => e.field === "name")?.fixable).toBe(true);
  });

  it("rejects whitespace-only name", () => {
    const errs = validateScoreConfig(
      { name: "   ", dataType: "boolean" },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "name")).toBeDefined();
  });

  it("requires a valid dataType", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "bogus" as any },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "dataType")?.fixable).toBe(true);
  });

  it("requires numericRange for numeric dataType", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "numeric" },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "numericRange")).toBeDefined();
  });

  it("requires min < max for numericRange", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "numeric", numericRange: { min: 5, max: 5 } },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "numericRange")?.message).toMatch(/less than/);
  });

  it("accepts a fully valid numeric config", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "numeric", numericRange: { min: 0, max: 1 } },
      baseCtx,
    );
    expect(errs).toEqual([]);
  });

  it("requires non-empty categories for categorical", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "categorical", categories: [] },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "categories")).toBeDefined();
  });

  it("rejects duplicate categories", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "categorical", categories: ["a", "a"] },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "categories")?.message).toMatch(/unique/);
  });

  it("rejects non-string categories", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "categorical", categories: ["a", 1 as any] },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "categories")).toBeDefined();
  });

  it("accepts a fully valid categorical config", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "categorical", categories: ["good", "bad"] },
      baseCtx,
    );
    expect(errs).toEqual([]);
  });

  it("accepts a boolean config without extra shape", () => {
    const errs = validateScoreConfig(
      { name: "n", dataType: "boolean" },
      baseCtx,
    );
    expect(errs).toEqual([]);
  });

  it("validates numeric healthyThreshold direction", () => {
    const errs = validateScoreConfig(
      {
        name: "n",
        dataType: "numeric",
        numericRange: { min: 0, max: 1 },
        healthyThreshold: { direction: "eq", value: 0.5 },
      },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "healthyThreshold")?.message).toMatch(/gte.*lte/);
  });

  it("validates numeric healthyThreshold value is a number", () => {
    const errs = validateScoreConfig(
      {
        name: "n",
        dataType: "numeric",
        numericRange: { min: 0, max: 1 },
        healthyThreshold: { direction: "gte", value: "0.5" as any },
      },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "healthyThreshold")).toBeDefined();
  });

  it("validates categorical healthyThreshold list shape", () => {
    const errs = validateScoreConfig(
      {
        name: "n",
        dataType: "categorical",
        categories: ["a"],
        healthyThreshold: { healthy_categories: [] },
      },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "healthyThreshold")).toBeDefined();
  });

  it("validates boolean healthyThreshold healthy_value type", () => {
    const errs = validateScoreConfig(
      {
        name: "n",
        dataType: "boolean",
        healthyThreshold: { healthy_value: "yes" as any },
      },
      baseCtx,
    );
    expect(errs.find((e) => e.field === "healthyThreshold")).toBeDefined();
  });

  it("flags name conflict against existing names with fixable=true", () => {
    const errs = validateScoreConfig(
      { name: "exists", dataType: "boolean" },
      { ...baseCtx, existingNames: new Set(["exists"]) },
    );
    expect(errs.find((e) => e.field === "nameConflict")?.fixable).toBe(true);
  });

  it("flags in-batch duplicate names", () => {
    const errs = validateScoreConfig(
      { name: "dup", dataType: "boolean" },
      { ...baseCtx, nameCounts: new Map([["dup", 2]]) },
    );
    expect(errs.find((e) => e.field === "duplicate")).toBeDefined();
  });
});

describe("prepareScoreConfigImport", () => {
  it("returns hasErrors=false and built payloads for a clean batch", () => {
    const result = prepareScoreConfigImport(
      [
        { name: "a", dataType: "boolean" },
        { name: "b", data_type: "numeric", numeric_range: { min: 0, max: 1 } },
      ],
      [],
    );
    expect(result.hasErrors).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].payload).toEqual({ name: "a", dataType: "boolean" });
    expect(result.items[1].payload).toEqual({
      name: "b",
      dataType: "numeric",
      numericRange: { min: 0, max: 1 },
    });
  });

  it("aggregates errors across items into a flat list", () => {
    const result = prepareScoreConfigImport(
      [{ dataType: "boolean" }, { name: "x" }],
      [],
    );
    expect(result.hasErrors).toBe(true);
    expect(result.errors.some((e) => e.itemIndex === 0 && e.field === "name")).toBe(true);
    expect(result.errors.some((e) => e.itemIndex === 1 && e.field === "dataType")).toBe(true);
  });

  it("detects duplicates within the imported batch", () => {
    const result = prepareScoreConfigImport(
      [
        { name: "same", dataType: "boolean" },
        { name: "same", dataType: "boolean" },
      ],
      [],
    );
    expect(result.errors.filter((e) => e.field === "duplicate")).toHaveLength(2);
  });

  it("detects conflicts against existing score configs", () => {
    const result = prepareScoreConfigImport(
      [{ name: "exists", dataType: "boolean" }],
      [{ name: "exists" }],
    );
    expect(result.errors.find((e) => e.field === "nameConflict")).toBeDefined();
    expect(result.items[0].payload).toBeNull();
  });

  it("does not build a payload for an item that has errors", () => {
    const result = prepareScoreConfigImport(
      [{ name: "ok", dataType: "boolean" }, { dataType: "boolean" }],
      [],
    );
    expect(result.items[0].payload).toEqual({ name: "ok", dataType: "boolean" });
    expect(result.items[1].payload).toBeNull();
  });
});
