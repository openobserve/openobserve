// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  dashboardIdOf,
  dashboardsToTerraform,
  stripServerFields,
  unwrapDashboard,
} from "./dashboardTerraform";

const DASHBOARD = {
  dashboardId: "7123abcdef",
  title: "Checkout errors",
  description: "5xx by endpoint",
  version: 5,
  owner: "someone@example.com",
  role: "admin",
  hash: "9f2c",
  created: "2026-08-01T00:00:00Z",
  updated_at: 1787000000000,
  variables: { list: [] },
  panels: [{ id: "p1", type: "line", title: "Errors" }],
};

const exportOf = (dashboards: Record<string, unknown>[], options = {}) =>
  dashboardsToTerraform(dashboards, options);

describe("unwrapDashboard", () => {
  it("takes the document out of a versioned envelope", () => {
    expect(unwrapDashboard({ v5: { title: "x" }, version: 5 })).toEqual({ title: "x" });
  });

  it("takes the document out of a dashboard envelope", () => {
    expect(unwrapDashboard({ dashboard: { title: "x" } })).toEqual({ title: "x" });
  });

  it("passes a bare document through", () => {
    expect(unwrapDashboard({ title: "x" })).toEqual({ title: "x" });
  });

  // The API sends every version slot, with the unused ones null. Taking the
  // first key that merely LOOKS versioned finds v1: null and loses the document.
  it("takes the populated version slot, not the first one named like a version", () => {
    const envelope = { v1: null, v2: null, v3: null, v4: null, v5: { title: "real" } };
    expect(unwrapDashboard(envelope)).toEqual({ title: "real" });
  });
});

describe("stripServerFields", () => {
  it("removes what identifies this copy rather than the dashboard", () => {
    const clean = stripServerFields(DASHBOARD);

    for (const key of ["dashboardId", "hash", "owner", "role", "created", "updated_at"]) {
      expect(clean, key).not.toHaveProperty(key);
    }
  });

  it("keeps everything that describes the dashboard", () => {
    const clean = stripServerFields(DASHBOARD);

    expect(clean.title).toBe("Checkout errors");
    expect(clean.description).toBe("5xx by endpoint");
    expect(clean.panels).toEqual(DASHBOARD.panels);
    expect(clean.variables).toEqual(DASHBOARD.variables);
    // `version` is the document's schema version, not a server revision, and the
    // provider reads it back out of the JSON.
    expect(clean.version).toBe(5);
  });
});

describe("dashboardIdOf", () => {
  it("finds the id on the payload or inside the envelope", () => {
    expect(dashboardIdOf(DASHBOARD)).toBe("7123abcdef");
    expect(dashboardIdOf({ v5: { dashboardId: "abc" } })).toBe("abc");
    expect(dashboardIdOf({ title: "no id" })).toBe("");
  });
});

describe("dashboardsToTerraform", () => {
  it("renders an openobserve_dashboard with the document as jsonencode", () => {
    const { hcl } = exportOf([DASHBOARD]);

    expect(hcl).toContain('resource "openobserve_dashboard" "checkout_errors"');
    expect(hcl).toContain("dashboard_json = jsonencode({");
    // `=` is aligned across the object's keys, so match the pair rather than a
    // fixed number of spaces.
    expect(hcl).toMatch(/"title"\s+= "Checkout errors"/);
  });

  it("does not put the server's bookkeeping into the configuration", () => {
    const { hcl } = exportOf([DASHBOARD]);

    // These are computed in the provider schema; sending them back would be
    // reported as drift on every plan.
    expect(hcl).not.toContain('7123abcdef"');
    expect(hcl).not.toContain('"owner"');
    expect(hcl).not.toContain('"hash"');
  });

  it("emits folder_id only when it is not the default", () => {
    expect(exportOf([DASHBOARD], { folderId: "default" }).hcl).not.toContain("folder_id");
    expect(exportOf([DASHBOARD], { folderId: "team-a" }).hcl).toContain('folder_id = "team-a"');
  });

  it("reports a dashboard with no title rather than rendering it", () => {
    const { hcl, unsupported } = exportOf([{ panels: [] }]);

    expect(hcl).toBe("");
    expect(unsupported).toEqual([{ name: "", reason: "incomplete" }]);
  });

  it("gives each dashboard a distinct label when titles collide", () => {
    const { hcl } = exportOf([DASHBOARD, { ...DASHBOARD, dashboardId: "other" }]);

    expect(hcl).toContain('"openobserve_dashboard" "checkout_errors"');
    expect(hcl).toContain('"openobserve_dashboard" "checkout_errors_2"');
  });

  // A dashboard variable is written `$${var}` in a panel query, which is exactly
  // what HCL reads as an interpolation. jsonencode of a parsed object has no
  // template semantics, so it survives; a heredoc would not.
  it("survives a panel query containing a dashboard variable", () => {
    const withVariable = {
      ...DASHBOARD,
      panels: [{ id: "p1", query: "SELECT * FROM t WHERE svc = '$${service}'" }],
    };
    const { hcl } = exportOf([withVariable]);

    expect(hcl).toContain("jsonencode(");
    // The `${` is escaped so Terraform reads it as literal text.
    expect(hcl).toContain("$${");
  });
});

describe("import blocks", () => {
  it("emits one per dashboard, addressed as org/id", () => {
    const { hcl } = exportOf([DASHBOARD], { orgId: "default" });

    expect(hcl).toContain("import {");
    expect(hcl).toContain("to = openobserve_dashboard.checkout_errors");
    expect(hcl).toContain('id = "default/7123abcdef"');
  });

  it("prefers an id the caller supplied over the one in the document", () => {
    const { hcl } = exportOf([DASHBOARD], { orgId: "default", ids: ["from-caller"] });
    expect(hcl).toContain('id = "default/from-caller"');
  });

  it("writes none without an org, since the address would be incomplete", () => {
    expect(exportOf([DASHBOARD]).hcl).not.toContain("import {");
  });

  it("says which organization the ids belong to", () => {
    const { hcl } = exportOf([DASHBOARD], { orgId: "acme" });
    expect(hcl).toContain('the ids below resolve only in the "acme" organization');
  });

  it("skips a dashboard that has no id to import by", () => {
    const { hcl } = exportOf([{ title: "No id", panels: [] }], { orgId: "default" });

    expect(hcl).toContain('resource "openobserve_dashboard"');
    expect(hcl).not.toContain("import {");
  });
});
