// @vitest-environment jsdom
// Pure-data accessor helpers — these are the read-side of the snake_case ↔
// camelCase compatibility shim across the eval entities. The tests pin both
// branches plus the default-value fallback so a future API rename doesn't
// silently degrade to defaults.

import { describe, it, expect } from "vitest";
import {
  availableModelsOf,
  booleanOf,
  dataTypeOf,
  defaultModelOf,
  entityId,
  providerTypeOf,
  samplingModeOf,
  scorerRefId,
  scorerRefVersion,
  scorerTypeOf,
  statusOf,
  streamTypeOf,
  valueOf,
} from "./evalEntity";

describe("valueOf", () => {
  it("prefers the camelCase key when both are present", () => {
    expect(valueOf({ fooBar: "camel", foo_bar: "snake" }, "fooBar", "foo_bar")).toBe("camel");
  });

  it("falls back to snake_case when camelCase is undefined", () => {
    expect(valueOf({ foo_bar: "snake" }, "fooBar", "foo_bar")).toBe("snake");
  });

  it("returns undefined when neither key is present", () => {
    expect(valueOf({}, "fooBar", "foo_bar")).toBeUndefined();
  });

  it("returns undefined for null / undefined rows without throwing", () => {
    expect(valueOf(null, "fooBar", "foo_bar")).toBeUndefined();
    expect(valueOf(undefined, "fooBar", "foo_bar")).toBeUndefined();
  });

  // Nullish coalescing — `0` / `""` / `false` are valid values and must NOT
  // be skipped in favour of the snake fallback.
  it("does not skip falsy-but-defined values on the camel key", () => {
    expect(valueOf({ fooBar: 0, foo_bar: 99 }, "fooBar", "foo_bar")).toBe(0);
    expect(valueOf({ fooBar: false, foo_bar: true }, "fooBar", "foo_bar")).toBe(false);
    expect(valueOf({ fooBar: "", foo_bar: "x" }, "fooBar", "foo_bar")).toBe("");
  });
});

describe("booleanOf", () => {
  it("coerces truthy values to true", () => {
    expect(booleanOf({ isDefault: 1 }, "isDefault", "is_default")).toBe(true);
    expect(booleanOf({ is_default: "yes" }, "isDefault", "is_default")).toBe(true);
  });

  it("coerces falsy / missing values to false", () => {
    expect(booleanOf({ isDefault: 0 }, "isDefault", "is_default")).toBe(false);
    expect(booleanOf({}, "isDefault", "is_default")).toBe(false);
  });
});

describe("entityId", () => {
  // The stable cross-version identifier — preferred over the per-version
  // row id everywhere joins happen. Each branch is load-bearing.
  it("uses entity_id (snake) when present", () => {
    expect(entityId({ id: "row1", entity_id: "ent1" } as any)).toBe("ent1");
  });

  it("uses entityId (camel) when present", () => {
    expect(entityId({ id: "row1", entityId: "ent1" } as any)).toBe("ent1");
  });

  it("falls back to row id when no entity_id", () => {
    expect(entityId({ id: "row1" } as any)).toBe("row1");
  });

  // Snowflake IDs are numeric in transit; the join SQL casts them to VARCHAR,
  // so the client-side string coercion has to match. Use a safe-integer value
  // here — real snowflake IDs lose precision in `number` form anyway, which
  // is why the join code keeps them as strings end-to-end.
  it("stringifies numeric ids so they compare cleanly against SQL string values", () => {
    expect(entityId({ id: 12345 } as any)).toBe("12345");
  });
});

describe("providerTypeOf / defaultModelOf / availableModelsOf", () => {
  it("returns the configured provider_type", () => {
    expect(providerTypeOf({ provider_type: "openai" } as any)).toBe("openai");
    expect(providerTypeOf({ providerType: "anthropic" } as any)).toBe("anthropic");
  });

  it("returns an empty string when provider type is missing — UI uses `||` fallback", () => {
    expect(providerTypeOf({} as any)).toBe("");
  });

  it("returns the configured default_model", () => {
    expect(defaultModelOf({ default_model: "gpt-4o" } as any)).toBe("gpt-4o");
    expect(defaultModelOf({ defaultModel: "gpt-4o" } as any)).toBe("gpt-4o");
  });

  it("returns available_models array, defaulting to empty array", () => {
    expect(availableModelsOf({ available_models: ["a", "b"] } as any)).toEqual(["a", "b"]);
    expect(availableModelsOf({ availableModels: ["c"] } as any)).toEqual(["c"]);
    expect(availableModelsOf({} as any)).toEqual([]);
  });
});

describe("scorerTypeOf", () => {
  it("returns the configured scorer_type", () => {
    expect(scorerTypeOf({ scorer_type: "remote" } as any)).toBe("remote");
    expect(scorerTypeOf({ scorerType: "llm_judge" } as any)).toBe("llm_judge");
  });

  // The Scorers UI tabs render `llm_judge` as the default — a row that has
  // never had its type stored shouldn't silently break the type pill.
  it("defaults to llm_judge when the field is missing", () => {
    expect(scorerTypeOf({} as any)).toBe("llm_judge");
  });
});

describe("dataTypeOf", () => {
  it("returns the configured data_type", () => {
    expect(dataTypeOf({ data_type: "boolean" } as any)).toBe("boolean");
    expect(dataTypeOf({ dataType: "categorical" } as any)).toBe("categorical");
  });

  it("defaults to numeric when the field is missing", () => {
    expect(dataTypeOf({} as any)).toBe("numeric");
  });
});

describe("streamTypeOf / samplingModeOf / statusOf", () => {
  it("defaults streamType to 'traces' for legacy jobs", () => {
    expect(streamTypeOf({} as any)).toBe("traces");
    expect(streamTypeOf({ stream_type: "logs" } as any)).toBe("logs");
  });

  it("defaults samplingMode to 'rate' for jobs created before the mode was stored", () => {
    expect(samplingModeOf({} as any)).toBe("rate");
    expect(samplingModeOf({ sampling_mode: "count" } as any)).toBe("count");
  });

  it("defaults status to 'draft' when missing", () => {
    expect(statusOf({} as any)).toBe("draft");
    expect(statusOf({ status: "active" } as any)).toBe("active");
  });
});

describe("scorerRefId / scorerRefVersion", () => {
  // EvalJob.scorers is a polymorphic union — older jobs store bare ID strings,
  // newer ones store `{ id, version }` objects. Both forms must extract
  // cleanly.
  it("extracts id from a bare-string reference", () => {
    expect(scorerRefId("scorer_123")).toBe("scorer_123");
  });

  it("extracts id from an object reference", () => {
    expect(scorerRefId({ id: "scorer_123", version: 2 })).toBe("scorer_123");
  });

  it("returns null version for bare-string references", () => {
    expect(scorerRefVersion("scorer_123")).toBeNull();
  });

  it("returns the object's version when present", () => {
    expect(scorerRefVersion({ id: "scorer_123", version: 2 })).toBe(2);
  });

  it("returns null when the object has no version field", () => {
    expect(scorerRefVersion({ id: "scorer_123" } as any)).toBeNull();
  });
});
