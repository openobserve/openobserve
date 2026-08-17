// Copyright 2026 OpenObserve Inc.
//
// The expected output here is `terraform fmt`-canonical and was checked against
// the built provider with `terraform validate`, so these assertions pin both the
// formatting and the attribute names the provider schema accepts.

import { describe, expect, it } from "vitest";

import { slosToTerraform } from "./sloTerraform";

const countSlo = {
  id: "2fXkZ8QlmNbYcV1pR3sT",
  org: "default",
  folder_id: "reliability",
  name: "checkout availability",
  description: "Successful checkout requests over 30 days",
  sli_type: "count",
  config: {
    source: {
      mode: "single_query",
      query: {
        stream: "app_logs",
        stream_type: "logs",
        scope: "service = 'checkout'",
        good_expr: "status < 500",
      },
    },
  },
  window_secs: 2592000,
  slice_interval_secs: 300,
  target: 99.9,
  enabled: true,
  owner: "sre@example.com",
  tags: ["prod", "team:checkout"],
  definition_generation: 3,
  groups_reserved: 0,
};

describe("slosToTerraform", () => {
  it("renders a count SLO as canonical, fmt-aligned HCL", () => {
    const { hcl, unsupported } = slosToTerraform([countSlo]);

    expect(unsupported).toEqual([]);
    expect(hcl.slice(hcl.indexOf("resource"))).toBe(
      `resource "openobserve_slo" "checkout_availability" {
  name                = "checkout availability"
  folder_id           = "reliability"
  description         = "Successful checkout requests over 30 days"
  enabled             = true
  target              = 99.9
  window_secs         = 2592000
  slice_interval_secs = 300
  tags                = ["prod", "team:checkout"]
  owner               = "sre@example.com"
  count_sli {
    single_query {
      stream      = "app_logs"
      stream_type = "logs"
      scope       = "service = 'checkout'"
      good_expr   = "status < 500"
    }
  }
}
`,
    );
  });

  it("omits read-only fields the provider derives or assigns", () => {
    const { hcl } = slosToTerraform([countSlo]);

    // Matched as whole attributes: a bare "id" substring also occurs in folder_id.
    for (const field of ["id", "org", "sli_type", "definition_generation", "groups_reserved"]) {
      expect(hcl).not.toMatch(new RegExp(`^\\s+${field}\\s+=`, "m"));
    }
  });

  it("renames the prom_ql source mode to the promql block", () => {
    const { hcl } = slosToTerraform([
      {
        ...countSlo,
        config: {
          source: {
            mode: "prom_ql",
            query: { good: "sum(increase(ok[5m]))", total: "sum(increase(all[5m]))" },
          },
        },
      },
    ]);

    expect(hcl).toContain("promql {");
    expect(hcl).toContain('good  = "sum(increase(ok[5m]))"');
    expect(hcl).toContain('total = "sum(increase(all[5m]))"');
    expect(hcl).not.toContain("prom_ql");
  });

  it("renders a dual-query source as its two nested query blocks", () => {
    const { hcl } = slosToTerraform([
      {
        ...countSlo,
        config: {
          source: {
            mode: "dual_query",
            query: {
              good: { stream: "app_logs", stream_type: "logs", sql: "SELECT 1 AS zo_slo_value" },
              total: { stream: "app_logs", stream_type: "logs", sql: "SELECT 2 AS zo_slo_value" },
            },
          },
        },
      },
    ]);

    expect(hcl).toContain("dual_query {");
    expect(hcl).toMatch(/good \{\n\s+stream\s+= "app_logs"\n\s+stream_type\s+= "logs"/);
    expect(hcl).toMatch(/total \{\n\s+stream\s+= "app_logs"/);
    expect(hcl).toMatch(/sql\s+= "SELECT 2 AS zo_slo_value"/);
  });

  it("renders a time-slice indicator, keeping absent_is_bad on an ungrouped SLO", () => {
    const { hcl } = slosToTerraform([
      {
        ...countSlo,
        sli_type: "time_slice",
        config: {
          stream: "app_logs",
          stream_type: "logs",
          query_language: "sql",
          query: 'SELECT count(_timestamp) AS zo_slo_value FROM "app_logs"',
          comparator: ">",
          threshold: 0,
          absent_is_bad: true,
        },
      },
    ]);

    expect(hcl).toContain("time_slice_sli {");
    expect(hcl).toContain('query_language = "sql"');
    expect(hcl).toContain("threshold      = 0");
    expect(hcl).toContain("absent_is_bad  = true");
  });

  it("drops absent_is_bad on a grouped SLO, which the provider rejects", () => {
    const { hcl } = slosToTerraform([
      {
        ...countSlo,
        sli_type: "time_slice",
        group_by: ["region"],
        config: {
          stream: "app_logs",
          stream_type: "logs",
          query_language: "sql",
          query: "SELECT 1 AS zo_slo_value",
          comparator: ">",
          threshold: 0,
          absent_is_bad: true,
        },
      },
    ]);

    expect(hcl).toContain('group_by            = ["region"]');
    expect(hcl).not.toContain("absent_is_bad");
  });

  it("renders an alert-derived indicator", () => {
    const { hcl } = slosToTerraform([
      { ...countSlo, sli_type: "alert", config: { alert_id: "2abcXYZ" } },
    ]);

    expect(hcl).toContain('alert_sli {\n    alert_id = "2abcXYZ"\n  }');
  });

  it("escapes interpolation openers in a query", () => {
    const { hcl } = slosToTerraform([
      {
        ...countSlo,
        sli_type: "time_slice",
        config: {
          stream: "app_logs",
          stream_type: "logs",
          query_language: "sql",
          query: "SELECT ${x} AS zo_slo_value",
          comparator: ">",
          threshold: 1,
        },
      },
    ]);

    expect(hcl).toContain('query          = "SELECT $${x} AS zo_slo_value"');
  });

  it("prefers the SLO's own folder and omits the default one", () => {
    expect(slosToTerraform([{ ...countSlo, folder_id: "default" }]).hcl).not.toContain("folder_id");
    // Only a payload with no folder falls back to the caller's active folder.
    const { hcl } = slosToTerraform([{ ...countSlo, folder_id: undefined }], {
      folderId: "platform",
    });
    expect(hcl).toContain('folder_id           = "platform"');
  });

  it("reports an SLO with no usable indicator as unsupported", () => {
    const { hcl, unsupported } = slosToTerraform([
      { name: "truncated" },
      { ...countSlo, sli_type: "count", config: {} },
      { ...countSlo, name: "no target", target: undefined },
      countSlo,
    ]);

    expect(unsupported).toEqual([
      { name: "truncated", reason: "incomplete" },
      { name: "checkout availability", reason: "incomplete" },
      { name: "no target", reason: "incomplete" },
    ]);
    expect(hcl).toContain('resource "openobserve_slo" "checkout_availability" {');
  });

  it("gives every SLO a unique resource label", () => {
    const { hcl } = slosToTerraform([
      countSlo,
      { ...countSlo, name: "checkout/availability" },
      { ...countSlo, name: "99th" },
    ]);

    expect(hcl).toContain('"openobserve_slo" "checkout_availability" {');
    expect(hcl).toContain('"openobserve_slo" "checkout_availability_2" {');
    // A Terraform label may not start with a digit.
    expect(hcl).toContain('"openobserve_slo" "slo_99th" {');
  });
});
