// Copyright 2026 OpenObserve Inc.
//
// sloTerraform.ts — renders an SLO payload as an `openobserve_slo` resource for
// the OpenObserve Terraform provider
// (https://registry.terraform.io/providers/openobserve/openobserve/latest).
//
// The input is what `GET /api/{org}/slos/{id}` returns. The wire format is an
// adjacently tagged enum and the provider schema is a set of blocks, so the
// mapping is a shape change rather than a rename:
//
//   sli_type: "count"      + config {source: {mode, query}}  →  count_sli { single_query | dual_query | promql }
//   sli_type: "time_slice" + config {…}                      →  time_slice_sli { … }
//   sli_type: "alert"      + config {alert_id}               →  alert_sli { alert_id }
//
// The count source's `mode` is `prom_ql` on the wire and the block is `promql`,
// which is the one name that differs. `sli_type` itself is read-only in the
// provider — it is derived from whichever block is present — as are the id and
// the definition generation, so none of them are written.

import type { Node, TerraformExport, TerraformUnsupportedItem } from "@/utils/terraform/hcl";
import {
  attr,
  block,
  boolWhen,
  document,
  list,
  num,
  quote,
  resourceBlock,
  resourceLabel,
  str,
} from "@/utils/terraform/hcl";

export interface SloTerraformOptions {
  /**
   * Folder the SLO lives in, emitted only when it is not the default. SLOs share
   * the alert folder namespace; OpenObserve has no separate SLO folder type,
   * which is why the provider documents `folder_id` as an alert folder.
   */
  folderId?: string;
}

/** `config.source.query` for a count SLI, keyed by the wire's `mode`. */
function countSourceBlock(source: unknown): Node[] {
  if (!source || typeof source !== "object") return [];
  const { mode, query } = source as { mode?: unknown; query?: unknown };
  if (!query || typeof query !== "object") return [];
  const q = query as Record<string, unknown>;

  switch (mode) {
    case "single_query":
      return block("single_query", [
        ...attr("stream", str(q.stream)),
        ...attr("stream_type", str(q.stream_type)),
        ...attr("scope", str(q.scope)),
        ...attr("good_expr", str(q.good_expr)),
      ]);
    case "dual_query":
      return block("dual_query", [
        ...countQueryBlock("good", q.good),
        ...countQueryBlock("total", q.total),
      ]);
    // The block is `promql`; only the wire tag is spelled with an underscore.
    case "prom_ql":
      return block("promql", [...attr("good", str(q.good)), ...attr("total", str(q.total))]);
    default:
      return [];
  }
}

function countQueryBlock(name: string, source: unknown): Node[] {
  if (!source || typeof source !== "object") return [];
  const q = source as Record<string, unknown>;
  return block(name, [
    ...attr("stream", str(q.stream)),
    ...attr("stream_type", str(q.stream_type)),
    ...attr("sql", str(q.sql)),
  ]);
}

function timeSliceBlock(config: Record<string, unknown>, groupBy: unknown): Node[] {
  // A grouped freshness objective can never fire for the absence it watches, so
  // the provider rejects the combination; group_by is the meaningful half.
  const grouped = Array.isArray(groupBy) && groupBy.length > 0;
  return block("time_slice_sli", [
    ...attr("stream", str(config.stream)),
    ...attr("stream_type", str(config.stream_type)),
    ...attr("query_language", str(config.query_language)),
    ...attr("query", str(config.query)),
    ...attr("scope", str(config.scope)),
    ...attr("comparator", str(config.comparator)),
    ...attr("threshold", num(config.threshold)),
    ...attr("absent_is_bad", grouped ? null : boolWhen(config.absent_is_bad, true)),
  ]);
}

/** The indicator block, chosen by `sli_type`. */
function indicatorBlock(slo: Record<string, unknown>): Node[] {
  const config = (slo.config ?? {}) as Record<string, unknown>;
  switch (slo.sli_type) {
    case "count":
      return block("count_sli", countSourceBlock(config.source));
    case "time_slice":
      return timeSliceBlock(config, slo.group_by);
    case "alert":
      return block("alert_sli", attr("alert_id", str(config.alert_id)));
    default:
      return [];
  }
}

function sloResource(
  slo: Record<string, unknown>,
  label: string,
  options: SloTerraformOptions,
): string {
  // The SLO's own folder wins; the caller's active folder is only a fallback for
  // a payload that does not carry one.
  const folder = String(slo.folder_id ?? options.folderId ?? "");
  const folderId = folder && folder !== "default" ? folder : null;

  const nodes: Node[] = [
    ...attr("name", quote(String(slo.name ?? ""))),
    ...attr("folder_id", folderId === null ? null : quote(folderId)),
    ...attr("description", str(slo.description)),
    // Always written, for the same reason the alert exporter does it: a paused
    // objective and a running one should not read the same.
    ...attr("enabled", String(slo.enabled !== false)),
    ...attr("target", num(slo.target)),
    ...attr("window_secs", num(slo.window_secs)),
    ...attr("slice_interval_secs", num(slo.slice_interval_secs)),
    ...attr("group_by", list(slo.group_by)),
    ...attr("tags", list(slo.tags)),
    ...attr("owner", str(slo.owner)),
    ...indicatorBlock(slo),
  ];

  return resourceBlock("openobserve_slo", label, nodes);
}

/**
 * An SLO the provider could not accept: without an indicator block the resource
 * is invalid, and the window and slice interval are what make a slice mean
 * anything.
 */
function isIncomplete(slo: Record<string, unknown>): boolean {
  return (
    !slo.name ||
    !slo.sli_type ||
    indicatorBlock(slo).length === 0 ||
    typeof slo.window_secs !== "number" ||
    typeof slo.slice_interval_secs !== "number" ||
    typeof slo.target !== "number"
  );
}

/**
 * Converts SLO payloads into `openobserve_slo` resources. SLOs that cannot be
 * expressed are reported in `unsupported` rather than rendered as something that
 * would not apply.
 */
export function slosToTerraform(
  slos: Record<string, unknown>[],
  options: SloTerraformOptions = {},
): TerraformExport {
  const used = new Set<string>();
  const unsupported: TerraformUnsupportedItem[] = [];
  const resources: string[] = [];

  for (const slo of slos) {
    if (!slo || typeof slo !== "object") continue;
    if (isIncomplete(slo)) {
      unsupported.push({ name: String(slo.name ?? ""), reason: "incomplete" });
      continue;
    }
    resources.push(sloResource(slo, resourceLabel(slo.name, used, "slo"), options));
  }

  return { hcl: document(resources), unsupported, droppedFields: [] };
}
