// Copyright 2026 OpenObserve Inc.
//
// alertTerraform.ts — renders an exported alert payload as an `openobserve_alert`
// resource for the OpenObserve Terraform provider
// (https://registry.terraform.io/providers/openobserve/openobserve/latest).
//
// The input is exactly what `POST /api/v2/{org}/alerts/{id}/export` returns, and
// the output targets the provider's alert schema. The two vocabularies are close
// but not identical, which is what this module exists to bridge:
//
//   • `multi_time_range[].offSet` is `offset` in the provider schema.
//   • Operators serialize as `contains` / `not_contains` but the provider's
//     validator only accepts `Contains` / `NotContains`.
//   • A condition `value` is a JSON number or string on the wire and always a
//     string in the provider schema.
//   • `query_condition.conditions` is free-form JSON, so it goes through
//     `jsonencode()` — the idiom the provider documents.
//   • The provider rejects a trigger-side gate on an SLO alert and a
//     `warning_threshold` on an aggregation alert, both of which the API sends
//     anyway; they are dropped here.
//   • Read-only fields (ids, timestamps, last_edited_by) have no place in a
//     configuration file and are dropped.
//
// Attributes that match the provider's own default are omitted, so the output
// reads like config someone wrote rather than a state dump. `enabled` is the one
// exception: whether an alert is live is the first thing a reviewer looks for,
// and leaving it to the default would make a paused alert look identical to a
// running one.

import type {
  ImportTarget,
  Node,
  TerraformExport,
  TerraformIdentityOptions,
  TerraformUnsupportedItem,
  TerraformUnsupportedReason,
} from "@/utils/terraform/hcl";
import {
  INDENT,
  attr,
  block,
  boolWhen,
  bool,
  document,
  importTarget,
  isFilled,
  list,
  literal,
  map,
  num,
  numUnless,
  quote,
  resourceBlock,
  resourceLabel,
  str,
} from "@/utils/terraform/hcl";

export interface AlertTerraformOptions extends TerraformIdentityOptions {
  /** Alert folder the export came from. Emitted only when it is not the default. */
  folderId?: string;
}

// `=`, `!=`, `>`, `>=`, `<` and `<=` pass through; only the two word operators
// are spelled differently on the wire than in the provider's validator.
const OPERATORS: Record<string, string> = {
  contains: "Contains",
  not_contains: "NotContains",
  Contains: "Contains",
  NotContains: "NotContains",
};

function operator(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return quote(OPERATORS[value] ?? value);
}

/** A threshold is a JSON number or string on the wire, always a string in HCL. */
function conditionValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return quote(value);
  if (typeof value === "number" || typeof value === "boolean") return quote(String(value));
  return quote(JSON.stringify(value));
}

function conditionBlock(name: string, source: unknown, dropped: Set<string>): Node[] {
  if (!source || typeof source !== "object") return [];
  const c = source as Record<string, unknown>;
  // The provider's condition block is column/operator/value only.
  if (c.ignore_case === true) dropped.add(`${name}.ignore_case`);
  return block(name, [
    ...attr("column", str(c.column)),
    ...attr("operator", operator(c.operator)),
    ...attr("value", conditionValue(c.value)),
  ]);
}

function aggregationBlock(source: unknown, dropped: Set<string>): Node[] {
  if (!source || typeof source !== "object") return [];
  const a = source as Record<string, unknown>;
  return block("aggregation", [
    ...attr("group_by", list(a.group_by)),
    ...attr("function", str(a.function)),
    ...attr("warning_value", num(a.warning_value)),
    ...attr("multi_alert", boolWhen(a.multi_alert, true)),
    ...conditionBlock("having", a.having, dropped),
  ]);
}

function sloConditionBlock(source: unknown): Node[] {
  if (!source || typeof source !== "object") return [];
  const s = source as Record<string, unknown>;
  // The two windows only exist for burn-rate alerts; the provider rejects them on
  // an error-budget alert, which measures over the SLO's own window.
  const burnRate = s.kind === "burn_rate";
  return block("slo_condition", [
    ...attr("slo_id", str(s.slo_id)),
    ...attr("kind", str(s.kind)),
    ...attr("operator", operator(s.operator)),
    ...attr("critical", num(s.critical)),
    ...attr("warning", num(s.warning)),
    ...attr("long_window_secs", burnRate ? num(s.long_window_secs) : null),
    ...attr("short_window_secs", burnRate ? num(s.short_window_secs) : null),
    ...attr("multi_alert", boolWhen(s.multi_alert, true)),
  ]);
}

function queryConditionBlock(source: unknown, indent: string, dropped: Set<string>): Node[] {
  if (!source || typeof source !== "object") return [];
  const q = source as Record<string, unknown>;
  const historic = Array.isArray(q.multi_time_range) ? q.multi_time_range : [];

  return block("query_condition", [
    ...attr("type", str(q.type)),
    ...attr("sql", str(q.sql)),
    ...attr("promql", str(q.promql)),
    // Free-form JSON in both the flat and the grouped shape — handed to the
    // provider as a JSON document, exactly as its schema expects.
    ...attr(
      "conditions",
      isFilled(q.conditions) ? `jsonencode(${literal(q.conditions, `${indent}${INDENT}`)})` : null,
    ),
    ...attr("promql_warning_value", num(q.promql_warning_value)),
    ...attr("promql_multi_alert", boolWhen(q.promql_multi_alert, true)),
    ...attr("vrl_function", str(q.vrl_function)),
    ...attr("search_event_type", str(q.search_event_type)),
    ...conditionBlock("promql_condition", q.promql_condition, dropped),
    ...aggregationBlock(q.aggregation, dropped),
    ...sloConditionBlock(q.slo_condition),
    ...historic.flatMap((entry: unknown) => {
      const offset = str((entry as Record<string, unknown>)?.offSet);
      return offset === null ? [] : block("multi_time_range", attr("offset", offset));
    }),
  ]);
}

function triggerConditionBlock(source: unknown, query: Record<string, unknown>): Node[] {
  if (!source || typeof source !== "object") return [];
  const t = source as Record<string, unknown>;
  // An SLO alert has no count gate — it is compared by slo_condition.operator
  // against slo_condition.critical — and on an aggregation alert the warning level
  // lives on aggregation.warning_value. The provider rejects the trigger-side
  // spellings outright, and the API sends them anyway, so they are dropped here.
  const isSlo = query.type === "slo";
  const hasAggregation = isFilled(query.aggregation);
  // period / operator / threshold / frequency are the alert's whole schedule, so
  // they are written even when they happen to match the provider default.
  return block("trigger_condition", [
    ...attr("period", num(t.period)),
    ...attr("operator", isSlo ? null : operator(t.operator)),
    ...attr("threshold", isSlo ? null : num(t.threshold)),
    ...attr("warning_threshold", hasAggregation ? null : num(t.warning_threshold)),
    ...attr("notify_on_warning", t.notify_on_warning === false ? "false" : null),
    ...attr("frequency", num(t.frequency)),
    ...attr("frequency_type", t.frequency_type === "cron" ? quote("cron") : null),
    ...attr("cron", str(t.cron)),
    ...attr("silence", numUnless(t.silence, 0)),
    ...attr("timezone", str(t.timezone)),
    ...attr("tolerance_in_secs", num(t.tolerance_in_secs)),
    ...attr("align_time", boolWhen(t.align_time, false)),
  ]);
}

function deduplicationBlock(source: unknown): Node[] {
  if (!source || typeof source !== "object") return [];
  const d = source as Record<string, unknown>;
  return block("deduplication", [
    ...attr("enabled", bool(d.enabled)),
    ...attr("fingerprint_fields", list(d.fingerprint_fields)),
    ...attr("time_window_minutes", num(d.time_window_minutes)),
  ]);
}

/**
 * Whether this payload is a composite alert.
 *
 * The tag is `composite` on the wire and `Composite` on a list row, so the
 * comparison is case-insensitive rather than trusting one spelling.
 */
function isComposite(alert: Record<string, unknown>): boolean {
  return String(alert.alert_type ?? "").toLowerCase() === "composite";
}

/** Anomaly-detection configs and truncated payloads have no provider resource. */
function unsupportedReason(alert: Record<string, unknown>): TerraformUnsupportedReason | null {
  if (alert.alert_type === "anomaly_detection") return "anomaly";
  // A composite has no stream and no schedule of its own — it is evaluated when a
  // child changes state — so the ordinary alert's completeness test would reject
  // every one of them. What it must have instead is an expression to combine.
  if (isComposite(alert)) {
    const expression = (alert.composite_condition as Record<string, unknown>)?.expression;
    return typeof expression === "string" && expression.trim() !== "" ? null : "incomplete";
  }
  if (!alert.stream_name || !alert.trigger_condition) return "incomplete";
  return null;
}

/**
 * Renders a composite alert as `openobserve_composite_alert`.
 *
 * A composite combines the states of other alerts through a boolean expression,
 * so it carries none of the query or schedule attributes an ordinary alert has:
 * no stream, no period, no frequency, no threshold. `silence` is the only
 * scheduling knob the provider accepts, and it arrives inside
 * `trigger_condition` on the wire while being a top-level attribute in the
 * schema.
 *
 * The expression references children by alert id. Those ids are left exactly as
 * the server wrote them rather than being rewritten into `${openobserve_alert.x.alert_id}`
 * references: the children may not be Terraform-managed at all, and inventing a
 * reference to a resource that does not exist in the configuration would produce
 * a file that cannot even parse. A user adopting the children too can replace
 * the literals by hand, and the import blocks make that straightforward.
 */
function compositeAlertResource(
  alert: Record<string, unknown>,
  label: string,
  options: AlertTerraformOptions,
): string {
  const folderId = options.folderId && options.folderId !== "default" ? options.folderId : null;
  const composite = (alert.composite_condition ?? {}) as Record<string, unknown>;
  const trigger = (alert.trigger_condition ?? {}) as Record<string, unknown>;

  const nodes: Node[] = [
    ...attr("name", quote(String(alert.name ?? ""))),
    ...attr("folder_id", folderId === null ? null : quote(folderId)),
    ...attr("expression", str(composite.expression)),
    ...attr("description", str(alert.description)),
    // Written unconditionally, for the same reason the ordinary alert exporter
    // does it: a paused composite must not read like a live one.
    ...attr("enabled", String(alert.enabled !== false)),
    // Both default to their non-emitted value in the provider, so only the
    // interesting direction is written.
    ...attr("warning_counts_as_firing", boolWhen(composite.warning_counts_as_firing, false)),
    ...attr(
      "stale_child_policy",
      composite.stale_child_policy && composite.stale_child_policy !== "use_last_state"
        ? str(composite.stale_child_policy)
        : null,
    ),
    ...attr("priority", num(alert.priority)),
    ...attr("tags", list(alert.tags)),
    ...attr("destinations", list(alert.destinations)),
    ...attr("template", str(alert.template)),
    ...attr("context_attributes", map(alert.context_attributes, INDENT)),
    ...attr("silence", numUnless(trigger.silence, 0)),
    ...attr("creates_incident", boolWhen(alert.creates_incident, true)),
    ...attr("workflows", list(alert.workflows)),
  ];

  return resourceBlock("openobserve_composite_alert", label, nodes);
}

function alertResource(
  alert: Record<string, unknown>,
  label: string,
  options: AlertTerraformOptions,
  dropped: Set<string>,
): string {
  const folderId = options.folderId && options.folderId !== "default" ? options.folderId : null;
  const query = (alert.query_condition ?? {}) as Record<string, unknown>;

  const nodes: Node[] = [
    ...attr("name", quote(String(alert.name ?? ""))),
    ...attr("stream_type", quote(String(alert.stream_type ?? "logs"))),
    ...attr("stream_name", quote(String(alert.stream_name ?? ""))),
    ...attr("folder_id", folderId === null ? null : quote(folderId)),
    ...attr("description", str(alert.description)),
    // Always written, unlike every other defaulted attribute. See the note at
    // the top of this file, and the header the export carries.
    ...attr("enabled", String(alert.enabled !== false)),
    ...attr("is_real_time", boolWhen(alert.is_real_time, true)),
    ...attr("owner", str(alert.owner)),
    ...attr("priority", num(alert.priority)),
    ...attr("tags", list(alert.tags)),
    // Destination and template names must already exist in the target org, or be
    // managed by their own openobserve_alert_destination / _template resources.
    ...attr("destinations", list(alert.destinations)),
    ...attr("template", str(alert.template)),
    ...attr("context_attributes", map(alert.context_attributes, INDENT)),
    ...attr("row_template", str(alert.row_template)),
    ...attr("row_template_type", alert.row_template_type === "Json" ? quote("Json") : null),
    ...attr("tz_offset", numUnless(alert.tz_offset, 0)),
    ...attr("creates_incident", boolWhen(alert.creates_incident, true)),
    ...attr("workflows", list(alert.workflows)),
    ...queryConditionBlock(alert.query_condition, INDENT, dropped),
    ...triggerConditionBlock(alert.trigger_condition, query),
    ...deduplicationBlock(alert.deduplication),
  ];

  return resourceBlock("openobserve_alert", label, nodes);
}

/**
 * Converts exported alert payloads into provider resources.
 *
 * Ordinary alerts become `openobserve_alert` and composites become
 * `openobserve_composite_alert` — they are separate resource types with
 * different schemas, and the payloads are told apart by `alert_type`. Alerts
 * with no provider equivalent are reported in `unsupported` rather than
 * rendered as something that would not apply.
 */
export function alertsToTerraform(
  alerts: Record<string, unknown>[],
  options: AlertTerraformOptions = {},
): TerraformExport {
  const used = new Set<string>();
  const dropped = new Set<string>();
  const unsupported: TerraformUnsupportedItem[] = [];
  const resources: string[] = [];
  const imports: ImportTarget[] = [];

  alerts.forEach((alert, index) => {
    if (!alert || typeof alert !== "object") return;
    const reason = unsupportedReason(alert);
    if (reason) {
      unsupported.push({ name: String(alert.name ?? ""), reason });
      return;
    }
    const composite = isComposite(alert);
    const type = composite ? "openobserve_composite_alert" : "openobserve_alert";
    const label = resourceLabel(alert.name, used, composite ? "composite_alert" : "alert");
    resources.push(
      composite
        ? compositeAlertResource(alert, label, options)
        : alertResource(alert, label, options, dropped),
    );
    imports.push(...importTarget(type, label, options.orgId, options.ids?.[index]));
  });

  return {
    hcl: document(resources, imports, options.orgId ?? ""),
    unsupported,
    droppedFields: [...dropped].sort(),
  };
}
