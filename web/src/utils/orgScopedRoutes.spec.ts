import { describe, expect, it } from "vitest";
import { orgSwitchListRoute } from "@/utils/orgScopedRoutes";

describe("orgSwitchListRoute", () => {
  it.each([
    ["viewDashboard", "dashboards"],
    ["addPanel", "dashboards"],
    ["editAlert", "alertList"],
    ["pipelineEditor", "pipelines"],
    ["editGroup", "groups"],
    ["traceDetails", "traces"],
  ])("sends %s to %s", (name, list) => {
    expect(orgSwitchListRoute(name)).toBe(list);
  });

  it("sends an existing report edit to the list but not a new report", () => {
    expect(orgSwitchListRoute("createReport", { report_id: "r1" })).toBe("reports");
    expect(orgSwitchListRoute("createReport", { name: "daily" })).toBe("reports");
    expect(orgSwitchListRoute("createReport", {})).toBeNull();
  });

  it("ignores pages that are not tied to an org-scoped id", () => {
    expect(orgSwitchListRoute("logs")).toBeNull();
    expect(orgSwitchListRoute("dashboards")).toBeNull();
    expect(orgSwitchListRoute(undefined)).toBeNull();
  });
});
