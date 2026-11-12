// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi } from "vitest";
import { useAIObservabilityRouteChildren } from "./useAIObservabilityRoutes";

vi.mock("@/utils/zincutils", () => ({ routeGuard: vi.fn() }));

describe("useAIObservabilityRouteChildren — online evaluations gate", () => {
  const children = useAIObservabilityRouteChildren();
  const namesWhere = (requiresOnlineEvals: boolean) =>
    children
      .filter((r) => r.name && !r.redirect && !!r.meta?.requiresOnlineEvals === requiresOnlineEvals)
      .map((r) => r.name);

  // Each of these reads an API the server registers only with O2_EVAL_ENABLED.
  it("marks every evaluation page and its sub-routes", () => {
    expect(namesWhere(true)).toEqual([
      "aiDiscovery",
      "aiQueues",
      "aiQueueDetail",
      "aiQueueWorkbench",
      "aiDatasets",
      "aiDatasetDetail",
      "aiEvaluations",
      "aiExperiments",
      "aiExperimentCreate",
      "aiExperimentCompare",
      "aiExperimentDetail",
      "aiRemoteTasks",
      "aiRemoteTaskCreate",
      "aiRemoteTaskEdit",
      "aiRemoteTaskDetail",
      "aiPlayground",
      // `/providers` is registered only with evaluations on.
      "llmProviders",
    ]);
  });

  it("leaves Monitor, Prompts, Agent Mapping and Model Pricing alone — their APIs do not depend on evaluations", () => {
    expect(namesWhere(false)).toEqual([
      "aiLLMInsights",
      "aiSessions",
      "aiUsers",
      "aiBudgets",
      "aiAgentGraph",
      "aiAgentBehavior",
      "aiPrompts",
      "aiPromptCreate",
      "aiPromptVersionCreate",
      "modelPricing",
      "modelPricingGaps",
      "modelPricingEditor",
      "genAiAgentMapping",
    ]);
  });
});

describe("useAIObservabilityRouteChildren — tab titles", () => {
  const children = useAIObservabilityRouteChildren();

  it("titles each tab of the shared evaluations route by the rail item that lists it", () => {
    const evaluations = children.find((r) => r.name === "aiEvaluations")!;
    expect(evaluations.meta?.titleKeyByTab).toEqual({
      quality: "aiObservability.nav.evaluations",
      jobs: "aiObservability.nav.evaluations",
      scorers: "aiObservability.nav.scorers",
      scoreConfigs: "aiObservability.nav.scorers",
    });
  });

  it("gives a route that only one rail item uses no per-tab titles", () => {
    expect(children.find((r) => r.name === "aiExperiments")!.meta?.titleKeyByTab).toBeUndefined();
  });
});
