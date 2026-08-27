// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { experimentFormDefaults } from "./ExperimentForm.schema";

// The Playground's "+ Experiment" exit hands its variant config over in the
// query. These cover the seam: a prefill must apply, and its ABSENCE must leave
// today's plain "New experiment" behaviour untouched.
describe("experimentFormDefaults — Playground prefill", () => {
  it("keeps every existing default when no prefill is given", () => {
    const defaults = experimentFormDefaults();
    expect(defaults.providerId).toBe("");
    expect(defaults.model).toBe("");
    expect(defaults.systemPrompt).toBe("");
    expect(defaults.userPrompt).toBe("{{ input }}");
    expect(defaults.temperature).toBe(0);
  });

  it("still honours the dataset-only call the create route already makes", () => {
    expect(experimentFormDefaults("ds-1").datasetId).toBe("ds-1");
  });

  it("carries a variant's task config through", () => {
    const defaults = experimentFormDefaults("ds-1", {
      providerId: "p1",
      model: "gpt-4o-mini",
      temperature: "0.7",
      systemPrompt: "You are terse.",
      userPrompt: "Summarise {{input}}",
    });

    expect(defaults.providerId).toBe("p1");
    expect(defaults.model).toBe("gpt-4o-mini");
    expect(defaults.temperature).toBe(0.7);
    expect(defaults.systemPrompt).toBe("You are terse.");
    expect(defaults.userPrompt).toBe("Summarise {{input}}");
  });

  it("respects an intentionally empty user prompt from a variant", () => {
    expect(experimentFormDefaults("", { userPrompt: "" }).userPrompt).toBe("");
  });

  it("falls back to the placeholder only when the key is absent", () => {
    expect(experimentFormDefaults("", { model: "gpt-4o" }).userPrompt).toBe("{{ input }}");
  });

  it("coerces a non-numeric temperature to zero rather than NaN", () => {
    expect(experimentFormDefaults("", { temperature: "hot" }).temperature).toBe(0);
  });
});
