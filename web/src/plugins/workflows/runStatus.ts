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

import type { I18nKey } from "@/types/i18n";
import type { HttpRequestFacts, WorkflowHistoryRow } from "@/services/workflows";
import { runSourceOf, type RunSource } from "./httpEndpoint";

/** date-fns pattern for times in run lists and the HTTP endpoint panel ("Oct 21, 09:39"). */
export const RUN_TIME_SHORT = "MMM d, HH:mm";
/** date-fns pattern for one run's chip and request facts ("Oct 21, 2026 09:39"). */
export const RUN_TIME_LONG = "MMM d, yyyy HH:mm";

/** Why a run never executed or never finished; drives the second line under its status chip. */
export type RunReason = "expired" | "worker_lost" | "workflow_disabled" | "run_timeout";

/** "all", "http_request", or a trigger kind such as "alert_fired". */
export type RunTriggerFilter = string;

export interface RunOutcomeFields {
  status?: string | null;
  error?: string | null;
  http_request?: Pick<HttpRequestFacts, "error"> | null;
}

export const RUN_REASON_KEYS: Record<RunReason, I18nKey> = {
  expired: "workflow.history.reasonExpired",
  worker_lost: "workflow.history.reasonWorkerLost",
  workflow_disabled: "workflow.history.reasonWorkflowDisabled",
  run_timeout: "workflow.history.reasonRunTimeout",
};

const LEDGER_REASONS: ReadonlySet<string> = new Set([
  "worker_lost",
  "workflow_disabled",
  "run_timeout",
]);

const KIND_SOURCES: Record<string, RunSource> = {
  alert_fired: "alert_fired",
  incident_event: "incident_event",
};

const KIB = 1024;

/** The ledger's code wins over `error`: a merged stream row's `error` is step text, not the code. */
export function runReasonOf(row: RunOutcomeFields | null | undefined): RunReason | null {
  if (row?.status === "expired") return "expired";
  if (row?.status !== "failed") return null;
  const code = row.http_request?.error ?? row.error ?? null;
  return code && LEDGER_REASONS.has(code) ? (code as RunReason) : null;
}

/** False when no step ran or none finished, so the run detail API holds nothing for it. */
export function hasStoredRunData(row: RunOutcomeFields | null | undefined): boolean {
  if (!row) return true;
  if (row.status === "queued" || row.status === "running" || row.status === "expired") return false;
  const reason = runReasonOf(row);
  return reason !== "worker_lost" && reason !== "workflow_disabled";
}

export function triggerFilterSource(kind: string | null | undefined): RunSource | null {
  return (kind && KIND_SOURCES[kind]) || null;
}

/** A Retry of an HTTP run is a retry (it carries no request facts), so it only shows under "all". */
export function matchesTriggerFilter(
  row: Pick<WorkflowHistoryRow, "event_type">,
  filter: RunTriggerFilter,
): boolean {
  if (filter === "all") return true;
  const source = runSourceOf(row);
  if (filter === "http_request") return source === "http";
  return source === triggerFilterSource(filter);
}

export function matchesRunSearch(
  row: { run_id: string; http_request?: Pick<HttpRequestFacts, "idempotency_key"> | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.run_id.toLowerCase().startsWith(q)) return true;
  return (row.http_request?.idempotency_key ?? "").toLowerCase().includes(q);
}

export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

export function bodySizeParts(bytes: number): { key: I18nKey; size: string } {
  if (bytes < KIB) return { key: "workflow.http.bodySizeBytes", size: String(bytes) };
  return {
    key: "workflow.http.bodySizeKiB",
    size: (bytes / KIB).toFixed(1).replace(/\.0$/, ""),
  };
}

/** The first errored step in the Steps rail's order, since the error map's key order is arbitrary. */
export function firstFailedStep(
  errors: Record<string, unknown> | null | undefined,
  order: string[],
): string | null {
  if (!errors) return null;
  return order.find((id) => Object.prototype.hasOwnProperty.call(errors, id)) ?? null;
}
