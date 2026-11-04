// Copyright 2026 OpenObserve Inc.
//
// Which integration guide the LLM Insights empty state suggests, from the docs
// page the user came from, and the most-read guides it links as chips.

import { describe, it, expect } from "vitest";
import {
  POPULAR_AI_INTEGRATION_ROUTES,
  aiIntegrationByRoute,
  referredAiIntegration,
} from "./llmInsightsEmptyState";

describe("referredAiIntegration", () => {
  it("maps an integration's docs page (and pages under it) to that integration", () => {
    expect(
      referredAiIntegration(["https://openobserve.ai/docs/integration/ai/claude-code-tracing/"])
        ?.routeName,
    ).toBe("ai-claude-code");
    expect(
      referredAiIntegration([
        "https://openobserve.ai/docs/integration/ai/providers/deepseek/#setup",
      ])?.routeName,
    ).toBe("ai-deepseek");
    expect(
      referredAiIntegration(["https://openobserve.ai/docs/integration/ai/tools/mcp-use"])
        ?.routeName,
    ).toBe("ai-mcp-use");
  });

  it("takes the first referrer that names an integration", () => {
    expect(
      referredAiIntegration([
        undefined,
        "https://openobserve.ai/docs/integration/ai/providers/google-gemini/",
      ])?.routeName,
    ).toBe("ai-google-gemini");
  });

  it("ignores other hosts, non-integration docs pages and garbage", () => {
    expect(
      referredAiIntegration([
        "https://example.com/docs/integration/ai/providers/deepseek/",
        "https://openobserve.ai/docs/getting-started/",
        "not a url",
        "",
        null,
      ]),
    ).toBeUndefined();
  });

  it("does not match a docs path that only shares a prefix with a guide", () => {
    expect(
      referredAiIntegration(["https://openobserve.ai/docs/integration/ai/providers/deepseek-r2/"])
        ?.routeName,
    ).not.toBe("ai-deepseek");
  });
});

describe("POPULAR_AI_INTEGRATION_ROUTES", () => {
  it("names only integrations that exist in the catalog", () => {
    for (const route of POPULAR_AI_INTEGRATION_ROUTES) {
      expect(aiIntegrationByRoute(route)?.routeName).toBe(route);
    }
  });
});
