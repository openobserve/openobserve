// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRouterBack = vi.fn();
const mockRouterPush = vi.fn();
const historyState: { back?: unknown } = {};

vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
    options: {
      history: {
        get state() {
          return historyState;
        },
      },
    },
  }),
}));

import { useListBackNavigation } from "./useListBackNavigation";

// Mirrors ViewDashboard.vue: the listing, plus the Infrastructure pages that push into a dashboard the same way it does.
const dashboardOptions = () => ({
  isListPath: (path: string) =>
    path === "/dashboards" || path.endsWith("/dashboards") || path.startsWith("/infra/"),
  fallback: () => ({ path: "/dashboards", query: { folder: "default" } }),
});

const metricsOptions = () => ({
  isListPath: (path: string) => path.startsWith("/metrics") && !path.startsWith("/metrics/editor"),
  fallback: () => ({ name: "metrics", query: { org_identifier: "default" } }),
});

describe("useListBackNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete historyState.back;
  });

  it("returns to the dashboards list it actually came from", () => {
    historyState.back = "/dashboards?folder=default";

    useListBackNavigation(dashboardOptions())();

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("returns to the hosts page the user actually came from", () => {
    historyState.back = "/infra/hosts?org_identifier=default&host=web-01";

    useListBackNavigation(dashboardOptions())();

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("falls back to the listing on a deep link with no history", () => {
    useListBackNavigation(dashboardOptions())();

    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({
      path: "/dashboards",
      query: { folder: "default" },
    });
  });

  // Saving a panel from Logs → Visualize lands on a dashboard the user never navigated to; back belongs on the listing, not back in the log search.
  it.each([
    ["/logs", "the Visualize flow that just created this dashboard"],
    ["/dashboards/view?dashboard=other", "another dashboard bounced through"],
    ["/dashboards/add_panel?dashboard=abc", "the panel editor already left"],
    ["/login?redirect=%2Fdashboards%2Fview", "a login bounce"],
  ])("pushes the listing rather than returning to %s (%s)", (back) => {
    historyState.back = back;

    useListBackNavigation(dashboardOptions())();

    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it("ignores a cross-origin referrer that is not an in-app route", () => {
    historyState.back = "https://example.com/some/page";

    useListBackNavigation(dashboardOptions())();

    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  describe("metrics editor — deliberately explorer-only", () => {
    it("pops back to the explorer it came from", () => {
      historyState.back = "/metrics?mode=explore";

      useListBackNavigation(metricsOptions())();

      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });

    // The /metrics -> /metrics/editor redirect is replace: true, so state.back points PAST the explorer.
    it.each(["/infra/hosts", "/logs", "/metrics/editor"])(
      "pushes the explorer rather than popping to %s",
      (back) => {
        historyState.back = back;

        useListBackNavigation(metricsOptions())();

        expect(mockRouterBack).not.toHaveBeenCalled();
        expect(mockRouterPush).toHaveBeenCalledWith({
          name: "metrics",
          query: { org_identifier: "default" },
        });
      },
    );
  });
});
