// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { navSection } from "./navSection";

// Every route name the AI shell renders, taken from enterprise/composables/router.ts.
// A drill-down route must light the SAME rail item as its list, or opening a
// detail page reads as having left the section.
describe("navSection", () => {
  it.each([
    ["aiLLMInsights", "llmInsights"],
    ["aiSessions", "sessions"],
    ["aiSessionDetails", "sessions"],
    ["aiAgentGraph", "agentGraph"],
    ["aiAgentBehavior", "agentBehavior"],
    ["aiDiscovery", "discovery"],
    ["aiQueues", "queues"],
    ["aiQueueDetail", "queues"],
    ["aiQueueWorkbench", "queues"],
    ["aiDatasets", "datasets"],
    ["aiDatasetDetail", "datasets"],
    ["aiPlayground", "playground"],
    ["aiExperiments", "experiments"],
    ["aiExperimentCreate", "experiments"],
    ["aiExperimentCompare", "experiments"],
    ["aiExperimentDetail", "experiments"],
    ["aiRemoteTasks", "remoteTasks"],
    ["aiRemoteTaskCreate", "remoteTasks"],
    ["aiRemoteTaskEdit", "remoteTasks"],
    ["aiRemoteTaskDetail", "remoteTasks"],
  ])("lights %s as %s", (routeName, expected) => {
    expect(navSection(routeName)).toBe(expected);
  });

  // Two sections share the aiAgent prefix, so neither may be matched by it.
  it("keeps the two Agent sections apart", () => {
    expect(navSection("aiAgentGraph")).not.toBe(navSection("aiAgentBehavior"));
  });

  // The Evaluations pages share one route name and are told apart by ?tab=.
  it("maps Evaluations down to its tab", () => {
    expect(navSection("aiEvaluations", "scorers")).toBe("scorers");
    expect(navSection("aiEvaluations")).toBe("quality");
    expect(navSection("aiEvaluations", "")).toBe("quality");
  });

  it("lights nothing for a route outside the shell", () => {
    expect(navSection("logs")).toBe("");
    expect(navSection(undefined)).toBe("");
    expect(navSection(Symbol("anonymous"))).toBe("");
  });
});
