// Copyright 2026 OpenObserve Inc.
//
// The expected output here is `terraform fmt`-canonical: it was checked by
// running the generated file through the real terraform CLI and the built
// provider (`terraform validate`), so these assertions pin both the formatting
// and the attribute names the provider schema accepts.

import { describe, expect, it } from "vitest";

import { alertsToTerraform } from "./alertTerraform";

const sqlAlert = {
  id: "2fXkZ8QlmNbYcV1pR3sT",
  name: "high error rate",
  org_id: "default",
  stream_type: "logs",
  stream_name: "app_logs",
  is_real_time: false,
  enabled: true,
  description: "Error volume above baseline",
  destinations: ["slack-alerts"],
  row_template: "",
  row_template_type: "String",
  tz_offset: 0,
  last_triggered_at: 1755000000000000,
  updated_at: 1755000000000000,
  last_edited_by: "admin@example.com",
  query_condition: {
    type: "sql",
    sql: 'SELECT count(*) AS total FROM "app_logs"',
    aggregation: null,
  },
  trigger_condition: {
    period: 15,
    operator: ">=",
    threshold: 100,
    frequency: 5,
    frequency_type: "minutes",
    silence: 60,
    align_time: true,
  },
};

describe("alertsToTerraform", () => {
  it("renders a scheduled SQL alert as canonical, fmt-aligned HCL", () => {
    const { hcl, unsupported, droppedFields } = alertsToTerraform([sqlAlert]);

    expect(unsupported).toEqual([]);
    expect(droppedFields).toEqual([]);
    // Read-only fields, and anything left at a provider default, are absent.
    expect(hcl.slice(hcl.indexOf("resource"))).toBe(
      `resource "openobserve_alert" "high_error_rate" {
  name         = "high error rate"
  stream_type  = "logs"
  stream_name  = "app_logs"
  description  = "Error volume above baseline"
  enabled      = true
  destinations = ["slack-alerts"]
  query_condition {
    type = "sql"
    sql  = "SELECT count(*) AS total FROM \\"app_logs\\""
  }
  trigger_condition {
    period    = 15
    operator  = ">="
    threshold = 100
    frequency = 5
    silence   = 60
  }
}
`,
    );
  });

  it("names the provider in a header so the config is usable on its own", () => {
    const { hcl } = alertsToTerraform([sqlAlert]);

    expect(hcl).toContain('#         source  = "openobserve/openobserve"');
    expect(hcl).toContain("#     required_providers {");
  });

  it("passes custom conditions through jsonencode and stringifies numeric thresholds", () => {
    const { hcl, droppedFields } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          type: "custom",
          conditions: [{ column: "logtag", operator: "=", value: "F", ignore_case: false }],
          aggregation: {
            group_by: ["service"],
            function: "p95",
            multi_alert: true,
            having: { column: "duration_ms", operator: ">", value: 1000, ignore_case: true },
          },
        },
      },
    ]);

    expect(hcl).toContain("conditions = jsonencode([");
    expect(hcl).toContain('"column"      = "logtag"');
    expect(hcl).toContain('group_by    = ["service"]');
    expect(hcl).toContain('function    = "p95"');
    expect(hcl).toContain("multi_alert = true");
    // A JSON number threshold becomes a string, which is what the schema takes.
    expect(hcl).toContain('value    = "1000"');
    // The provider's having block has no ignore_case, so the loss is reported.
    expect(droppedFields).toEqual(["having.ignore_case"]);
  });

  it("maps wire operators onto the names the provider validator accepts", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          type: "custom",
          aggregation: {
            function: "count",
            having: { column: "msg", operator: "not_contains", value: "healthcheck" },
          },
        },
      },
    ]);

    expect(hcl).toContain('operator = "NotContains"');
    expect(hcl).not.toContain("not_contains");
  });

  it("renames multi_time_range offSet to the schema's offset", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          ...sqlAlert.query_condition,
          multi_time_range: [{ offSet: "1h" }, { offSet: "1d" }],
        },
      },
    ]);

    expect(hcl).toContain('multi_time_range {\n      offset = "1h"\n    }');
    expect(hcl).toContain('offset = "1d"');
    expect(hcl).not.toContain("offSet");
  });

  it("renders promql and deduplication blocks", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        stream_type: "metrics",
        query_condition: {
          type: "promql",
          promql: 'rate(node_cpu_seconds_total{mode!="idle"}[5m])',
          promql_condition: { column: "value", operator: ">", value: 0.9 },
          promql_warning_value: 0.7,
          promql_multi_alert: true,
        },
        deduplication: { enabled: true, fingerprint_fields: ["instance"], time_window_minutes: 30 },
      },
    ]);

    expect(hcl).toContain("promql_condition {");
    expect(hcl).toContain('value    = "0.9"');
    expect(hcl).toContain("promql_warning_value = 0.7");
    expect(hcl).toContain("promql_multi_alert   = true");
    expect(hcl).toContain('fingerprint_fields  = ["instance"]');
    expect(hcl).toContain("time_window_minutes = 30");
  });

  it("drops the trigger-side gate on an SLO alert, which the provider rejects", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          type: "slo",
          slo_condition: {
            slo_id: "slo-123",
            kind: "burn_rate",
            operator: ">",
            critical: 14.4,
            long_window_secs: 3600,
            short_window_secs: 300,
          },
        },
      },
    ]);

    expect(hcl).toContain('slo_id            = "slo-123"');
    expect(hcl).toContain("long_window_secs  = 3600");
    // An SLO alert is thresholded by slo_condition.critical, not by the trigger.
    expect(hcl).toContain("trigger_condition {\n    period    = 15\n    frequency = 5");
    expect(hcl).not.toContain("threshold");
    expect(hcl).not.toMatch(/^\s+operator\s+= ">="/m);
  });

  it("drops the burn-rate windows on an error-budget alert", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          type: "slo",
          slo_condition: {
            slo_id: "slo-123",
            kind: "error_budget",
            operator: ">=",
            critical: 90,
            long_window_secs: 3600,
            short_window_secs: 300,
          },
        },
      },
    ]);

    expect(hcl).toContain('kind     = "error_budget"');
    expect(hcl).not.toContain("long_window_secs");
    expect(hcl).not.toContain("short_window_secs");
  });

  it("drops warning_threshold on an aggregation alert, where warning_value owns it", () => {
    const { hcl } = alertsToTerraform([
      {
        ...sqlAlert,
        query_condition: {
          type: "custom",
          aggregation: {
            function: "avg",
            warning_value: 50,
            having: { column: "latency", operator: ">", value: 100 },
          },
        },
        trigger_condition: { ...sqlAlert.trigger_condition, warning_threshold: 50 },
      },
    ]);

    expect(hcl).toContain("warning_value = 50");
    expect(hcl).not.toContain("warning_threshold");
  });

  it("escapes interpolation openers so Terraform does not parse them", () => {
    const { hcl } = alertsToTerraform([
      { ...sqlAlert, description: 'total ${count} rows for "svc"', row_template: "%{name}" },
    ]);

    expect(hcl).toContain('description  = "total $${count} rows for \\"svc\\""');
    expect(hcl).toContain('row_template = "%%{name}"');
  });

  it("reports anomaly configs and truncated payloads as unsupported", () => {
    const { hcl, unsupported } = alertsToTerraform([
      { name: "traffic anomaly", alert_type: "anomaly_detection", stream_name: "app_logs" },
      { name: "half a payload" },
      sqlAlert,
    ]);

    expect(unsupported).toEqual([
      { name: "traffic anomaly", reason: "anomaly" },
      { name: "half a payload", reason: "incomplete" },
    ]);
    // The convertible alert is still rendered.
    expect(hcl).toContain('resource "openobserve_alert" "high_error_rate"');
    expect(hcl).not.toContain("traffic anomaly");
  });

  it("gives every alert a unique resource label", () => {
    const { hcl } = alertsToTerraform([
      sqlAlert,
      { ...sqlAlert, name: "high/error/rate" },
      { ...sqlAlert, name: "5xx" },
    ]);

    expect(hcl).toContain('"openobserve_alert" "high_error_rate" {');
    expect(hcl).toContain('"openobserve_alert" "high_error_rate_2" {');
    // A Terraform label may not start with a digit.
    expect(hcl).toContain('"openobserve_alert" "alert_5xx" {');
  });

  it("emits folder_id only for a non-default folder", () => {
    expect(alertsToTerraform([sqlAlert], { folderId: "default" }).hcl).not.toContain("folder_id");
    expect(alertsToTerraform([sqlAlert], { folderId: "platform" }).hcl).toContain(
      'folder_id    = "platform"',
    );
  });

  it("returns empty output when nothing is convertible", () => {
    const { hcl, unsupported } = alertsToTerraform([
      { name: "anomaly", alert_type: "anomaly_detection", stream_name: "s" },
    ]);

    expect(hcl).toBe("");
    expect(unsupported).toHaveLength(1);
  });
});

// ── Composite alerts ────────────────────────────────────────────────────────
// A composite has no stream, no query and no schedule; it combines the states of
// other alerts. It is a different provider resource type, so the exporter has to
// dispatch on alert_type rather than treating it as an alert that is missing
// half its fields.
const COMPOSITE = {
  alert_type: "composite",
  name: "Bad deploy",
  description: "Errors up right after a deploy",
  enabled: true,
  destinations: ["soc-webhook"],
  trigger_condition: { silence: 30 },
  composite_condition: {
    expression: "{2abc} && {3def}",
    warning_counts_as_firing: true,
    stale_child_policy: "use_last_state",
  },
  tags: ["prod"],
  priority: 1,
};

describe("composite alerts", () => {
  it("renders openobserve_composite_alert, not openobserve_alert", () => {
    const { hcl, unsupported } = alertsToTerraform([COMPOSITE]);

    expect(unsupported).toEqual([]);
    expect(hcl).toContain('resource "openobserve_composite_alert" "bad_deploy"');
    expect(hcl).not.toContain('"openobserve_alert"');
  });

  it("writes the expression and the attributes a composite actually has", () => {
    const { hcl } = alertsToTerraform([COMPOSITE]);

    // `=` is aligned across the block, so match each pair rather than a fixed
    // number of spaces.
    expect(hcl).toMatch(/expression\s+= "\{2abc\} && \{3def\}"/);
    expect(hcl).toMatch(/enabled\s+= true/);
    expect(hcl).toMatch(/destinations\s+= \["soc-webhook"\]/);
    // silence arrives inside trigger_condition on the wire and is top-level in
    // the provider schema.
    expect(hcl).toMatch(/silence\s+= 30/);
  });

  it("writes none of the query or schedule attributes a composite cannot have", () => {
    const { hcl } = alertsToTerraform([COMPOSITE]);

    for (const absent of [
      "stream_name",
      "stream_type",
      "query_condition",
      "trigger_condition",
      "period",
      "frequency",
      "threshold",
    ]) {
      expect(hcl, absent).not.toContain(absent);
    }
  });

  it("omits the two policy attributes when they are at their default", () => {
    const { hcl } = alertsToTerraform([COMPOSITE]);

    expect(hcl).not.toContain("warning_counts_as_firing");
    expect(hcl).not.toContain("stale_child_policy");
  });

  it("writes the policy attributes in their non-default direction", () => {
    const { hcl } = alertsToTerraform([
      {
        ...COMPOSITE,
        composite_condition: {
          ...COMPOSITE.composite_condition,
          warning_counts_as_firing: false,
          stale_child_policy: "treat_as_false",
        },
      },
    ]);

    expect(hcl).toMatch(/warning_counts_as_firing\s+= false/);
    expect(hcl).toMatch(/stale_child_policy\s+= "treat_as_false"/);
  });

  it("accepts the capitalised alert_type a list row carries", () => {
    const { hcl } = alertsToTerraform([{ ...COMPOSITE, alert_type: "Composite" }]);
    expect(hcl).toContain('"openobserve_composite_alert"');
  });

  it("reports a composite with no expression rather than rendering an invalid one", () => {
    const { hcl, unsupported } = alertsToTerraform([
      { ...COMPOSITE, composite_condition: { expression: "" } },
    ]);

    expect(hcl).toBe("");
    expect(unsupported).toEqual([{ name: "Bad deploy", reason: "incomplete" }]);
  });

  it("renders a mixed selection as both resource types", () => {
    const { hcl } = alertsToTerraform([COMPOSITE, sqlAlert]);

    expect(hcl).toContain('"openobserve_composite_alert" "bad_deploy"');
    expect(hcl).toContain('"openobserve_alert"');
  });
});

describe("import blocks", () => {
  it("addresses each alert as org/id", () => {
    const { hcl } = alertsToTerraform([sqlAlert], { orgId: "default", ids: ["2abcXYZ"] });

    expect(hcl).toContain("import {");
    expect(hcl).toContain('id = "default/2abcXYZ"');
  });

  it("points a composite at the composite resource type", () => {
    const { hcl } = alertsToTerraform([COMPOSITE], { orgId: "default", ids: ["9zz"] });

    expect(hcl).toContain("to = openobserve_composite_alert.bad_deploy");
    expect(hcl).toContain('id = "default/9zz"');
  });

  it("keeps ids paired with the right resource when one is skipped", () => {
    // The anomaly config renders nothing, so a naive index walk would attach the
    // second alert to the first id.
    const anomaly = { ...sqlAlert, name: "Anomaly", alert_type: "anomaly_detection" };
    const { hcl } = alertsToTerraform([anomaly, COMPOSITE], {
      orgId: "default",
      ids: ["anomaly-id", "composite-id"],
    });

    expect(hcl).toContain('id = "default/composite-id"');
    expect(hcl).not.toContain("anomaly-id");
  });

  it("writes none without an org", () => {
    expect(alertsToTerraform([sqlAlert], { ids: ["2abcXYZ"] }).hcl).not.toContain("import {");
  });

  it("writes none for an alert with no id", () => {
    expect(alertsToTerraform([sqlAlert], { orgId: "default" }).hcl).not.toContain("import {");
  });
});
