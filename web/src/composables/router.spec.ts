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

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockIngestionRoutes = [
  { path: "ingestion", name: "ingestion" },
  { path: "ingestion/logs", name: "ingestLogs" },
];

vi.mock("./shared/useIngestionRoutes", () => ({
  default: vi.fn(() => mockIngestionRoutes),
}));

const mockRouteGuard = vi.fn();
vi.mock("@/utils/zincutils", () => ({
  routeGuard: (...args: unknown[]) => mockRouteGuard(...args),
}));

import useOSRoutes from "./router";
import useIngestionRoutes from "./shared/useIngestionRoutes";

describe("useOSRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parentRoutes is an empty array", () => {
    const { parentRoutes } = useOSRoutes();
    expect(parentRoutes).toEqual([]);
  });

  it("homeChildRoutes starts with the routes returned by useIngestionRoutes", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes.slice(0, mockIngestionRoutes.length)).toEqual(mockIngestionRoutes);
  });

  it("homeChildRoutes has one extra route (the AI Monitor shell) beyond the mocked ingestion routes", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes).toHaveLength(mockIngestionRoutes.length + 1);
  });

  it("homeChildRoutes items match the mocked route objects", () => {
    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes[0]).toEqual({ path: "ingestion", name: "ingestion" });
    expect(homeChildRoutes[1]).toEqual({ path: "ingestion/logs", name: "ingestLogs" });
  });

  it("registers the AI Monitor shell with only LLM Insights + Sessions as children", () => {
    const { homeChildRoutes } = useOSRoutes();
    const aiRoute = homeChildRoutes.find((r: any) => r.path === "ai");
    expect(aiRoute).toBeDefined();
    expect(aiRoute.children.map((c: any) => c.name)).toEqual([
      "aiObservability",
      "aiLLMInsights",
      "aiSessions",
    ]);
  });

  describe("the AI Monitor shell route", () => {
    function aiRoute() {
      const { homeChildRoutes } = useOSRoutes();
      return homeChildRoutes.find((r: any) => r.path === "ai") as any;
    }

    it("redirects the bare /ai path to aiLLMInsights, same as the enterprise tree", () => {
      const redirectChild = aiRoute().children[0];
      expect(redirectChild).toEqual({
        path: "",
        name: "aiObservability",
        redirect: { name: "aiLLMInsights" },
      });
    });

    it("calls routeGuard from the shell's own beforeEnter, same as every other OSS route", () => {
      const next = vi.fn();
      aiRoute().beforeEnter({ path: "/ai" }, {}, next);
      expect(mockRouteGuard).toHaveBeenCalledWith({ path: "/ai" }, {}, next);
    });

    it("lazy-loads each child's component rather than importing it eagerly", () => {
      const [, llmInsightsChild, sessionsChild] = aiRoute().children;
      expect(typeof llmInsightsChild.component).toBe("function");
      expect(typeof sessionsChild.component).toBe("function");
    });

    it("gives llm-insights and sessions their own distinct paths under /ai", () => {
      const [, llmInsightsChild, sessionsChild] = aiRoute().children;
      expect(llmInsightsChild.path).toBe("llm-insights");
      expect(sessionsChild.path).toBe("sessions");
    });
  });

  it("useIngestionRoutes is called when the composable is invoked", () => {
    useOSRoutes();
    expect(useIngestionRoutes).toHaveBeenCalledTimes(1);
  });

  it("multiple calls return independent instances with separate arrays", () => {
    const result1 = useOSRoutes();
    const result2 = useOSRoutes();

    expect(result1).not.toBe(result2);
    expect(result1.parentRoutes).not.toBe(result2.parentRoutes);
    expect(result1.homeChildRoutes).not.toBe(result2.homeChildRoutes);
  });

  it("multiple calls each invoke useIngestionRoutes independently", () => {
    useOSRoutes();
    useOSRoutes();
    expect(useIngestionRoutes).toHaveBeenCalledTimes(2);
  });

  it("returns an object with parentRoutes and homeChildRoutes keys", () => {
    const result = useOSRoutes();
    expect(result).toHaveProperty("parentRoutes");
    expect(result).toHaveProperty("homeChildRoutes");
  });

  it("parentRoutes is always an empty array regardless of ingestion routes", () => {
    vi.mocked(useIngestionRoutes).mockReturnValueOnce([{ path: "extra", name: "extra" }] as any);
    const { parentRoutes } = useOSRoutes();
    expect(parentRoutes).toEqual([]);
    expect(parentRoutes).toHaveLength(0);
  });

  it("homeChildRoutes reflects updated mock return values", () => {
    const customRoutes = [{ path: "custom", name: "customRoute" }];
    vi.mocked(useIngestionRoutes).mockReturnValueOnce(customRoutes as any);

    const { homeChildRoutes } = useOSRoutes();
    expect(homeChildRoutes.slice(0, customRoutes.length)).toEqual(customRoutes);
  });
});
