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

import { describe, expect, it } from "vitest";

import {
  convertPromRules,
  detectImportFormat,
  isMissingMetricError,
  isPromRulesYaml,
  parsePromDuration,
  PromRulesImportError,
  routeBySeverity,
} from "./promRulesImport";

const NODE_RULES = `# node exporter rules
groups:
  - name: node
    interval: 30s
    rules:
      - record: instance:node_cpu:rate5m
        expr: rate(node_cpu_seconds_total[5m])
      - alert: InstanceDown
        expr: up == 0
        for: 5m
        keep_firing_for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Instance {{ $labels.instance }} down"
          description: "{{$labels.job}} has been down, value {{ $value }}"
      - alert: HostHighCpu
        expr: (node_load1 > 4) and on(instance) (up == 1) unless on(instance) maintenance == 1
        labels:
          severity: warning
`;

const COLLIDING_RULES = `groups:
  - name: node
    rules:
      - alert: InstanceDown
        expr: up{job="node"} == 0
  - name: blackbox.rules
    rules:
      - alert: Instance Down
        expr: probe_success == 0
      - alert: HighErrorRate
        expr: rate(errors_total[5m]) > 1
`;

describe("isPromRulesYaml", () => {
  it.each([
    ["a groups: file", NODE_RULES, true],
    ["leading comments and blank lines", "\n# c\n\ngroups:\n  - name: x\n", true],
    ["a leading document marker", "---\ngroups:\n  - name: x\n", true],
    ["JSON", '{"groups": []}', false],
    ["YAML without groups", "name: x\nrules: []\n", false],
    ["groups nested under another key", "spec:\n  groups: []\n", false],
  ])("detects %s", (_case, text, expected) => {
    expect(isPromRulesYaml(text)).toBe(expected);
  });
});

describe("parsePromDuration", () => {
  it.each([
    ["5m", 300],
    ["1h30m", 5400],
    ["30s", 30],
    ["1d", 86400],
    ["1w", 604800],
    ["1500ms", 2],
    ["0", 0],
    [0, 0],
    [undefined, 0],
  ])("reads %s as %d seconds", (value, seconds) => {
    expect(parsePromDuration(value)).toBe(seconds);
  });

  it.each(["5 minutes", "m5", "-5m", "5M"])("refuses %s", (value) => {
    expect(parsePromDuration(value)).toBeNull();
  });
});

describe("convertPromRules", () => {
  it("turns one alerting rule into the golden rule-mode payload", () => {
    const { alerts } = convertPromRules(NODE_RULES, { orgId: "default" });
    expect(alerts[0]).toEqual({
      name: "instance_down",
      org_id: "default",
      stream_type: "metrics",
      stream_name: "",
      is_real_time: false,
      enabled: false,
      query_condition: {
        type: "promql",
        promql: "up == 0",
        promql_rule_mode: true,
        promql_multi_alert: true,
        promql_condition: null,
        conditions: null,
        sql: "",
        aggregation: null,
        vrl_function: null,
        multi_time_range: [],
      },
      trigger_condition: {
        period: 1,
        operator: ">=",
        threshold: 1,
        frequency: 1,
        frequency_type: "minutes",
        cron: "",
        silence: 10,
      },
      pending_period_sec: 300,
      keep_firing_for: 600,
      priority: 1,
      destinations: [],
      context_attributes: {},
      description:
        "Instance {{ $labels.instance }} down\n{{$labels.job}} has been down, value {{ $value }}",
    });
  });

  it("keeps and/unless expressions verbatim", () => {
    const { alerts } = convertPromRules(NODE_RULES);
    expect((alerts[1].query_condition as any).promql).toBe(
      "(node_load1 > 4) and on(instance) (up == 1) unless on(instance) maintenance == 1",
    );
  });

  it("skips recording rules and counts them", () => {
    const result = convertPromRules(NODE_RULES);
    expect(result.alerts.map((a) => a.name)).toEqual(["instance_down", "host_high_cpu"]);
    expect(result.skipped).toBe(1);
  });

  it("maps severity to priority and flags an unknown severity", () => {
    const text = `groups:
  - name: g
    rules:
      - alert: A
        expr: up
        labels: { severity: warning }
      - alert: B
        expr: up
        labels: { severity: info }
      - alert: C
        expr: up
        labels: { severity: page }
      - alert: D
        expr: up
`;
    const { alerts, warnings } = convertPromRules(text);
    expect(alerts.map((a) => a.priority)).toEqual([3, 4, undefined, undefined]);
    expect(alerts.map((a) => Object.hasOwn(a, "priority"))).toEqual([true, true, false, false]);
    expect(warnings).toContainEqual({ code: "unknown_severity", alert: "c", severity: "page" });
  });

  it("reads for and keep_firing_for, and leaves both at 0 when absent", () => {
    const { alerts } = convertPromRules(NODE_RULES);
    expect([alerts[0].pending_period_sec, alerts[0].keep_firing_for]).toEqual([300, 600]);
    expect([alerts[1].pending_period_sec, alerts[1].keep_firing_for]).toEqual([0, 0]);
  });

  it("flags a duration it cannot read instead of guessing", () => {
    const text =
      "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        for: soon\n";
    const { alerts, warnings } = convertPromRules(text);
    expect(alerts[0].pending_period_sec).toBe(0);
    expect(warnings).toContainEqual({
      code: "invalid_duration",
      alert: "a",
      field: "for",
      value: "soon",
    });
  });

  it("evaluates on the group's interval, in whole minutes", () => {
    const text =
      "groups:\n  - name: g\n    interval: 5m\n    rules:\n      - alert: A\n        expr: up\n";
    const { alerts } = convertPromRules(text);
    expect((alerts[0].trigger_condition as any).frequency).toBe(5);
    expect((alerts[0].trigger_condition as any).period).toBe(5);
  });

  it("suffixes colliding names with their group and reports the rename", () => {
    const { alerts, warnings } = convertPromRules(COLLIDING_RULES);
    expect(alerts.map((a) => a.name)).toEqual([
      "instance_down_node",
      "instance_down_blackbox_rules",
      "high_error_rate",
    ]);
    expect(warnings).toContainEqual({
      code: "renamed",
      alert: "instance_down_blackbox_rules",
      from: "Instance Down",
    });
  });

  it("numbers a collision the group suffix cannot separate", () => {
    const text =
      "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n      - alert: a\n        expr: up\n";
    expect(convertPromRules(text).alerts.map((a) => a.name)).toEqual(["a_g", "a_g_2"]);
  });

  it("sanitises names to snake case with no whitespace or unsupported characters", () => {
    const text = `groups:
  - name: g
    rules:
      - alert: "KubePod CrashLooping: #1?"
        expr: up
      - alert: HTTPErrorsHigh
        expr: up
`;
    expect(convertPromRules(text).alerts.map((a) => a.name)).toEqual([
      "kube_pod_crash_looping_1",
      "http_errors_high",
    ]);
  });

  // The description is sent as written, never expanded per series (core/src/alerts/alert.rs:4284).
  it("keeps every template verbatim and flags each one", () => {
    const text = `groups:
  - name: g
    rules:
      - alert: A
        expr: up
        annotations:
          summary: "{{ $labels.instance }} at {{ $value | humanize }}"
`;
    const { alerts, warnings } = convertPromRules(text);
    expect(alerts[0].description).toBe("{{ $labels.instance }} at {{ $value | humanize }}");
    expect(warnings.filter((w) => w.code === "unmapped_template")).toEqual([
      { code: "unmapped_template", alert: "a", text: "{{ $labels.instance }}" },
      { code: "unmapped_template", alert: "a", text: "{{ $value | humanize }}" },
    ]);
  });

  it("never writes an OpenObserve placeholder that would not fill", () => {
    const { alerts } = convertPromRules(NODE_RULES);
    expect(alerts[0].description).not.toMatch(/(^|[^{])\{(instance|job|value)\}/);
  });

  it("starts every imported alert paused", () => {
    expect(convertPromRules(NODE_RULES).alerts.every((a) => a.enabled === false)).toBe(true);
  });

  it("flags a rule with no alert or record name, or no expression", () => {
    const text =
      "groups:\n  - name: g\n    rules:\n      - expr: up\n      - alert: NoExpr\n      - alert: Ok\n        expr: up\n";
    const { alerts, warnings } = convertPromRules(text);
    expect(alerts.map((a) => a.name)).toEqual(["ok"]);
    expect(warnings.filter((w) => w.code === "invalid_rule")).toEqual([
      { code: "invalid_rule", group: "g", index: 1 },
      { code: "invalid_rule", group: "g", index: 2 },
    ]);
  });

  it.each([
    ["broken YAML", "groups:\n  - name: [", "invalid_yaml"],
    ["no groups list", "groups: 3\n", "no_groups"],
  ])("refuses %s with a code", (_case, text, code) => {
    expect(() => convertPromRules(text)).toThrow(PromRulesImportError);
    try {
      convertPromRules(text);
    } catch (e) {
      expect((e as PromRulesImportError).code).toBe(code);
    }
  });
});

describe("detectImportFormat", () => {
  it.each([
    ["broken JSON", '{"name": "a",}', "json"],
    ["a JSON array", "[1, 2", "json"],
    ["YAML that is not a rule file", "name: a\nenabled: true\n", "yaml"],
    ["Terraform", 'resource "openobserve_alert" "a" {\n  name = "a"\n}\n', "terraform"],
    ["plain words", "hello there", "unknown"],
  ])("names %s", (_case, text, format) => {
    expect(detectImportFormat(text)).toBe(format);
  });
});

describe("convertPromRules group count", () => {
  it("counts every group in the file, including ones with only recording rules", () => {
    const text = `groups:
  - name: a
    rules:
      - alert: A
        expr: up == 0
  - name: b
    rules:
      - record: r
        expr: up
`;
    expect(convertPromRules(text).groups).toBe(2);
  });
});

describe("routeBySeverity", () => {
  const ruleAlert = (priority?: number, destinations: string[] = []) => ({
    name: `p${priority ?? "none"}`,
    destinations,
    query_condition: { type: "promql", promql_rule_mode: true },
    ...(priority === undefined ? {} : { priority }),
  });

  it("sends critical rules to the critical route and every other severity to the warning route", () => {
    const alerts: Record<string, any>[] = [ruleAlert(1), ruleAlert(3), ruleAlert(4), ruleAlert()];
    routeBySeverity(alerts, { critical: "pager", warning: "team-email" });
    expect(alerts.map((a) => a.destinations)).toEqual([
      ["pager"],
      ["team-email"],
      ["team-email"],
      ["team-email"],
    ]);
  });

  it("leaves a rule without destinations when its route is not chosen", () => {
    const alerts: Record<string, any>[] = [ruleAlert(1), ruleAlert(3)];
    routeBySeverity(alerts, { critical: "pager", warning: "" });
    expect(alerts.map((a) => a.destinations)).toEqual([["pager"], []]);
  });

  it("keeps destinations a rule already names, and never routes a non-rule alert", () => {
    const named = ruleAlert(1, ["kept"]);
    const sqlAlert = {
      name: "sql",
      destinations: [],
      priority: 1,
      query_condition: { type: "sql" },
    };
    routeBySeverity([named, sqlAlert], { critical: "pager", warning: "team-email" });
    expect(named.destinations).toEqual(["kept"]);
    expect(sqlAlert.destinations).toEqual([]);
  });
});

describe("isMissingMetricError", () => {
  it.each([
    [
      "Cannot infer a referenced metrics stream for PromQL rule: expression has no referenced existing metrics stream; supply stream_name",
      true,
    ],
    ["Stream node_up not found", true],
    [
      "Cannot infer a referenced metrics stream for PromQL rule: rule mode requires stream_type=metrics",
      false,
    ],
    ["Alert destination pager not found", false],
    ["", false],
  ])("reads %j as missing metric: %s", (message, expected) => {
    expect(isMissingMetricError(message)).toBe(expected);
  });
});
