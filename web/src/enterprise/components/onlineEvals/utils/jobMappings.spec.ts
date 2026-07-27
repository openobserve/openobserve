// @vitest-environment jsdom
// Tests for the per-job input-mapping helpers. These functions glue the
// scorer template variables to the trace fields the job will pass at run
// time. The shape conversions matter — older jobs ship a flat mapping that
// must be expanded across all selected scorers.

import { describe, it, expect } from "vitest";
import type { Scorer } from "@/services/online-evals.service";
import {
  buildJobInputMappingPayload,
  defaultJobMappingValue,
  jobMappingVariablesForScorer,
  normalizeJobInputMappings,
  scorerTemplateVariables,
  syncJobInputMappings,
} from "./jobMappings";

// ---------------------------------------------------------------------------
// Tiny scorer factory — only the fields the helpers actually touch.

function scorer(overrides: Partial<Scorer>): Scorer {
  return {
    id: "s1",
    entity_id: "s1",
    name: "test",
    template: "",
    variables: [],
    ...overrides,
  } as any as Scorer;
}

describe("scorerTemplateVariables", () => {
  // Variables come from two places: the explicit `variables` array and any
  // `{{ … }}` placeholders the user typed into the template. The helper has
  // to union them so the input-mapping UI shows every binding the scorer
  // needs.
  it("merges declared variables with placeholders found in the template", () => {
    const s = scorer({
      variables: ["input"],
      template: "Score {{ input }} vs {{ output }}",
    });
    expect(scorerTemplateVariables(s)).toEqual(["input", "output"]);
  });

  it("deduplicates when the same variable appears in both sources", () => {
    const s = scorer({
      variables: ["input", "output"],
      template: "{{ input }} -> {{ output }}",
    });
    expect(scorerTemplateVariables(s)).toEqual(["input", "output"]);
  });

  it("returns an empty list when neither source has any variables", () => {
    const s = scorer({ variables: [], template: "no placeholders" });
    expect(scorerTemplateVariables(s)).toEqual([]);
  });
});

describe("defaultJobMappingValue", () => {
  // These are the canonical OTel-prefixed field names emitted by the
  // ingester. Tests pin them so a future ingester rename forces this map
  // to update.
  it("maps well-known scorer variables to OTel trace fields", () => {
    expect(defaultJobMappingValue("input")).toBe("{{gen_ai_input_messages}}");
    expect(defaultJobMappingValue("output")).toBe("{{gen_ai_output_messages}}");
    expect(defaultJobMappingValue("context")).toBe("{{gen_ai_system_instructions}}");
    expect(defaultJobMappingValue("metadata")).toBe("{{attributes}}");
    expect(defaultJobMappingValue("trace.id")).toBe("{{trace_id}}");
    expect(defaultJobMappingValue("span.id")).toBe("{{span_id}}");
    expect(defaultJobMappingValue("trace_id")).toBe("{{trace_id}}");
    expect(defaultJobMappingValue("span_id")).toBe("{{span_id}}");
    expect(defaultJobMappingValue("session_id")).toBe("{{session_id}}");
  });

  // For unknown variables we generate a placeholder by stripping dots — this
  // matches the convention in the ingester (`gen.ai.foo` → `gen_ai_foo`).
  it("falls back to dot-stripped placeholder for unknown variables", () => {
    expect(defaultJobMappingValue("custom.field")).toBe("{{custom_field}}");
    expect(defaultJobMappingValue("plain")).toBe("{{plain}}");
  });
});

describe("jobMappingVariablesForScorer", () => {
  // Combines the scorer-derived variables with any custom keys the user
  // already added in the existing mapping — important when editing a job
  // where the saved mapping has extras the template no longer requires.
  it("unions scorer variables with keys from the existing mapping", () => {
    const s = scorer({ variables: ["input"] });
    const result = jobMappingVariablesForScorer(s, {
      input: "{{x}}",
      legacy_field: "{{y}}",
    });
    expect(result.sort()).toEqual(["input", "legacy_field"]);
  });

  it("tolerates a missing existing mapping (undefined)", () => {
    const s = scorer({ variables: ["input", "output"] });
    expect(jobMappingVariablesForScorer(s, undefined)).toEqual(["input", "output"]);
  });
});

describe("buildJobInputMappingPayload", () => {
  // Save-time cleanup: trim whitespace, drop empty fields, drop scorers
  // with no resulting mapping, and return null if nothing's left at all.
  it("trims keys and values and drops empty entries", () => {
    const out = buildJobInputMappingPayload(["s1"], {
      s1: { "  input  ": "  {{x}}  ", output: "", "": "ignored" },
    });
    expect(out).toEqual({ s1: { input: "{{x}}" } });
  });

  it("only includes scorers that the caller asked for", () => {
    const out = buildJobInputMappingPayload(["s1"], {
      s1: { input: "{{x}}" },
      s2: { input: "{{ignored}}" },
    });
    expect(out).toEqual({ s1: { input: "{{x}}" } });
  });

  it("drops scorers whose mapping is fully empty after cleaning", () => {
    const out = buildJobInputMappingPayload(["s1", "s2"], {
      s1: { input: "{{x}}" },
      s2: { input: "" },
    });
    expect(out).toEqual({ s1: { input: "{{x}}" } });
  });

  // When the entire payload would be empty, returning null signals to the
  // form that the backend's `input_mapping` field should be omitted entirely.
  it("returns null when no scorer ends up with any mapping", () => {
    expect(buildJobInputMappingPayload(["s1"], { s1: {} })).toBeNull();
    expect(buildJobInputMappingPayload([], {})).toBeNull();
  });

  it("omits the complete system-provided view for trace jobs", () => {
    expect(
      buildJobInputMappingPayload(
        ["s1"],
        {
          s1: {
            input: "{{custom_input}}",
            output: "{{custom_output}}",
            statistics: "{{custom_stats}}",
            spans: "{{custom_spans}}",
            steps: "{{custom_steps}}",
            custom: "{{custom_field}}",
          },
        },
        "trace",
      ),
    ).toEqual({ s1: { custom: "{{custom_field}}" } });
  });

  it("only omits statistics and steps for session jobs", () => {
    expect(
      buildJobInputMappingPayload(
        ["s1"],
        {
          s1: {
            input: "{{custom_input}}",
            statistics: "{{custom_stats}}",
            spans: "{{custom_spans}}",
            steps: "{{custom_steps}}",
          },
        },
        "session",
      ),
    ).toEqual({
      s1: { input: "{{custom_input}}", spans: "{{custom_spans}}" },
    });
  });

  it("keeps statistics and steps freely mappable for span jobs", () => {
    expect(
      buildJobInputMappingPayload(
        ["s1"],
        { s1: { statistics: "{{span_stats}}", steps: "{{span_steps}}" } },
        "span",
      ),
    ).toEqual({
      s1: { statistics: "{{span_stats}}", steps: "{{span_steps}}" },
    });
  });
});

describe("normalizeJobInputMappings", () => {
  // Old jobs persist `input_mapping` as a single flat object that applies to
  // every scorer; new jobs persist per-scorer mappings. Round-tripping
  // through the form has to detect and re-expand the flat shape.
  it("preserves a per-scorer shape as-is", () => {
    const raw = {
      s1: { input: "{{a}}" },
      s2: { input: "{{b}}" },
    };
    expect(normalizeJobInputMappings(raw, ["s1", "s2"])).toEqual(raw);
  });

  it("expands a flat shape across all selected scorers", () => {
    const flat = { input: "{{a}}", output: "{{b}}" };
    expect(normalizeJobInputMappings(flat, ["s1", "s2"])).toEqual({
      s1: { input: "{{a}}", output: "{{b}}" },
      s2: { input: "{{a}}", output: "{{b}}" },
    });
  });

  it("parses a JSON string before normalising", () => {
    const json = JSON.stringify({ s1: { input: "{{a}}" } });
    expect(normalizeJobInputMappings(json, ["s1"])).toEqual({
      s1: { input: "{{a}}" },
    });
  });

  it("returns an empty object for null / non-object / array input", () => {
    expect(normalizeJobInputMappings(null, ["s1"])).toEqual({});
    expect(normalizeJobInputMappings("not json", ["s1"])).toEqual({});
    expect(normalizeJobInputMappings([1, 2, 3], ["s1"])).toEqual({});
  });

  // Deep-cloning matters: the form mutates each scorer's mapping
  // independently, so they can't share a reference.
  it("clones the per-scorer mapping so each scorer can be edited independently", () => {
    const flat = { input: "{{a}}" };
    const result = normalizeJobInputMappings(flat, ["s1", "s2"]);
    expect(result.s1).not.toBe(result.s2);
    result.s1.input = "{{mutated}}";
    expect(result.s2.input).toBe("{{a}}");
  });
});

describe("syncJobInputMappings", () => {
  // Called every time the selected scorers change. Two responsibilities:
  // (1) drop mappings for scorers that are no longer selected, (2) seed
  // default mapping values for any new scorer variables.
  it("removes mappings for scorers that have been unselected", () => {
    const { nextMappings } = syncJobInputMappings(
      ["s1"],
      [scorer({ id: "s1", entity_id: "s1", variables: ["input"] })],
      { s1: { input: "{{a}}" }, s2: { input: "{{b}}" } },
      {},
    );
    expect(Object.keys(nextMappings)).toEqual(["s1"]);
  });

  it("seeds defaults for missing variables on a newly added scorer", () => {
    const { nextMappings } = syncJobInputMappings(
      ["s1"],
      [scorer({ id: "s1", entity_id: "s1", variables: ["input", "output"] })],
      {},
      {},
    );
    expect(nextMappings.s1).toEqual({
      input: "{{gen_ai_input_messages}}",
      output: "{{gen_ai_output_messages}}",
    });
  });

  it("preserves existing values for variables the user has already filled in", () => {
    const { nextMappings } = syncJobInputMappings(
      ["s1"],
      [scorer({ id: "s1", entity_id: "s1", variables: ["input", "output"] })],
      { s1: { input: "{{user_typed_this}}" } },
      {},
    );
    expect(nextMappings.s1.input).toBe("{{user_typed_this}}");
    expect(nextMappings.s1.output).toBe("{{gen_ai_output_messages}}");
  });

  it("carries scorer versions through to the next state", () => {
    const { nextVersions } = syncJobInputMappings(
      ["s1"],
      [scorer({ id: "s1", entity_id: "s1" })],
      {},
      { s1: 3 },
    );
    expect(nextVersions.s1).toBe(3);
  });

  it("uses null version for selected scorers that have no version pinned", () => {
    const { nextVersions } = syncJobInputMappings(
      ["s1"],
      [scorer({ id: "s1", entity_id: "s1" })],
      {},
      {},
    );
    expect(nextVersions.s1).toBeNull();
  });
});
