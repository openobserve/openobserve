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

const dashboardOptions = () => ({
  isExcluded: (path: string) => path === "/dashboards/view" || path === "/dashboards/add_panel",
  fallback: () => ({ path: "/dashboards", query: { folder: "default" } }),
});

const metricsOptions = () => ({
  isExcluded: (path: string) => !path.startsWith("/metrics") || path.startsWith("/metrics/editor"),
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

  it.each([
    ["/login?redirect=%2Fdashboards%2Fview", "a login bounce"],
    ["/cb", "an OAuth callback"],
    ["/dashboards/view?dashboard=other", "another dashboard bounced through"],
    ["/dashboards/add_panel?dashboard=abc", "the panel editor already left"],
  ])("falls back rather than returning to %s (%s)", (back) => {
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

  it("reports whether the button will pop history, so the label can name the destination", () => {
    historyState.back = "/infra/hosts?host=web-01";
    expect(useListBackNavigation(dashboardOptions()).popsHistory.value).toBe(true);

    historyState.back = "/dashboards/view?dashboard=other";
    expect(useListBackNavigation(dashboardOptions()).popsHistory.value).toBe(false);
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
