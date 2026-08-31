// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  canCloneInForm,
  experimentFormDefaults,
  experimentFormFromExperiment,
} from "./ExperimentForm.schema";
import type { LlmExperiment } from "@/services/llm-experiments.service";

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

describe("experimentFormFromExperiment — clone prefill", () => {
  const base = {
    id: "exp-1",
    name: "prompt v3",
    description: null,
    datasetId: "ds-1",
    datasetVersion: 9,
    scorers: [{ id: "sc-1", version: 2 }],
    trialCount: 4,
  } as unknown as LlmExperiment;

  it("unpacks an inline prompt back into its fields", () => {
    const values = experimentFormFromExperiment(
      {
        ...base,
        task: {
          type: "inline_prompt",
          messages: [
            { role: "system", content: "Be terse." },
            { role: "user", content: "Answer {{ input }}" },
          ],
          providerId: "pr-1",
          model: "gpt-4o",
          params: { temperature: 0.3 },
        },
      } as LlmExperiment,
      "prompt v3 (Copy)",
    );

    expect(values).toMatchObject({
      name: "prompt v3 (Copy)",
      taskType: "inline_prompt",
      providerId: "pr-1",
      model: "gpt-4o",
      systemPrompt: "Be terse.",
      userPrompt: "Answer {{ input }}",
      temperature: 0.3,
      scorerIds: ["sc-1"],
      trialCount: 4,
    });
  });

  // The wire carries milliseconds; the form asks for seconds.
  it("unpacks a remote task, converting its timeout back to seconds", () => {
    const values = experimentFormFromExperiment(
      {
        ...base,
        task: {
          type: "remote",
          taskRef: "summarizer@3",
          overrides: { timeoutMs: 90_000, maxConcurrency: 8 },
        },
      } as LlmExperiment,
      "copy",
    );

    expect(values).toMatchObject({
      taskType: "remote",
      taskRef: "summarizer@3",
      taskTimeoutSeconds: "90",
      taskMaxConcurrency: "8",
    });
  });

  it("leaves a description-less source with an empty description, not null", () => {
    const values = experimentFormFromExperiment(
      { ...base, task: { type: "remote", taskRef: "x@1" } } as LlmExperiment,
      "copy",
    );
    expect(values.description).toBe("");
  });
});

// An `sdk` task is reported by customer code and has no controls in the form, so
// pushing one through it would silently rewrite the task as an inline prompt.
describe("canCloneInForm", () => {
  it.each([
    ["inline_prompt", true],
    ["remote", true],
    ["sdk", false],
  ])("%s -> %s", (type, expected) => {
    expect(canCloneInForm({ type } as any)).toBe(expected);
  });
});
