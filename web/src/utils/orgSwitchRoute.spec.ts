import { describe, expect, it } from "vitest";
import { getOrgSwitchRoute } from "./orgSwitchRoute";

describe("getOrgSwitchRoute", () => {
  const dashboardQuery = {
    org_identifier: "default",
    dashboard: "7351",
    folder: "default",
    tab: "default",
  };

  it.each(["/dashboards/view", "/dashboards/add_panel", "/dashboards/tv"])(
    "sends %s to the dashboard list of the new org",
    (path) => {
      expect(getOrgSwitchRoute(path, dashboardQuery, "_meta")).toEqual({
        path: "/dashboards",
        query: { org_identifier: "_meta" },
      });
    },
  );

  it("keeps the query on logs pages", () => {
    const query = { org_identifier: "default", stream: "app", sql_mode: "true" };
    expect(getOrgSwitchRoute("/web.logs", query, "_meta")).toEqual({
      path: "/web.logs",
      query: { stream: "app", sql_mode: "true", org_identifier: "_meta" },
    });
  });

  it.each(["/dashboards", "/alerts", "/dashboards/import"])(
    "keeps the path of %s and drops its query",
    (path) => {
      expect(getOrgSwitchRoute(path, { folder: "f1", org_identifier: "default" }, "_meta")).toEqual(
        { path, query: { org_identifier: "_meta" } },
      );
    },
  );
});
