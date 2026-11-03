// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { INSTRUMENT_SKILL_URL, buildCodingAgentPrompt } from "./codingAgentPrompt";

describe("buildCodingAgentPrompt", () => {
  it("names the skill URL, the org and the stream", () => {
    expect(buildCodingAgentPrompt("team1", "ai_traces")).toBe(
      `Instrument this app for OpenObserve with the openobserve-instrument skill (${INSTRUMENT_SKILL_URL}).\n` +
        "Use the .env in the project root, org team1, stream ai_traces.\n" +
        "Run one sample request, then check the data.",
    );
  });

  it("substitutes each org and stream independently", () => {
    const prompt = buildCodingAgentPrompt("default", "default");
    expect(prompt).toContain("org default, stream default.");
    expect(buildCodingAgentPrompt("aiobs_ux_test", "llm")).toContain(
      "org aiobs_ux_test, stream llm.",
    );
  });
});
