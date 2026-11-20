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

import type { ActiveDowntime } from "@/services/downtimes";
import type { AlertListAck } from "@/ts/interfaces/alert";
import { isFiringOutcome, shouldShowRunOutcome } from "@/utils/alerts/runOutcome";

export interface FiringRow {
  alert_id: string;
  folder_id: string;
  folder_name: string;
  name: string;
  alert_type: string;
  enabled?: boolean;
  stream_name?: string;
  priority?: number;
  last_outcome?: string;
  last_outcome_since?: number;
  last_satisfied_at?: number;
  firing_started_at?: number;
  is_real_time?: boolean;
  trigger_condition?: {
    period?: number;
    operator?: string;
    threshold?: number;
    frequency?: number;
    frequency_type?: string;
    cron?: string;
    silence?: number;
  } | null;
  groups_firing?: number;
  groups_firing_is_lower_bound?: boolean;
  ack?: AlertListAck;
  active_downtime?: ActiveDowntime | null;
  /** Sent only with `include_dependencies=true`. */
  destinations?: string[];
  condition?: {
    type?: string;
    sql?: string | null;
    promql?: string | null;
    promql_condition?: { operator?: string; value?: number | string } | null;
    aggregation?: {
      multi_alert?: boolean;
      function?: string;
      having?: { column?: string; operator?: string; value?: number | string };
    } | null;
    promql_multi_alert?: boolean;
  };
  stream_type?: string;
  description?: string;
  owner?: string;
  incident?: { id: string; title?: string; status: string };
}

/** The fields the open-firing rule reads, so another page's row type can use the same rule. */
export interface FiringSignals {
  enabled?: boolean;
  last_outcome?: string | null;
  firing_started_at?: number | null;
  groups_firing?: number | null;
}

/** The fields the ack rule reads, `multi_alert` being whether the alert evaluates per group now. */
export interface AckSignals {
  multi_alert?: boolean;
  groups_firing?: number | null;
  groups_firing_is_lower_bound?: boolean | null;
  ack?: Pick<AlertListAck, "groups_acked"> | null;
}

/** The fields the list row's operational state and state rail read. */
export interface RailSignals extends FiringSignals, AckSignals {
  is_real_time?: boolean | string;
  status?: unknown;
  status_unavailable?: boolean;
}

export type AlertOperationalState = "active" | "paused" | "failed";

export type AlertRailState = "failed" | "firing" | "acknowledged" | "paused" | "active";

export interface FiringPage {
  list: FiringRow[];
  /** The run state could not be read, so every row's live fields are blank. */
  status_unavailable?: boolean;
}

export const FIRING_CLOCK_MS = 30_000;

// Disabling keeps the stored firing on purpose, so the list is what hides it.
const isLive = (row: FiringSignals): boolean => row.enabled !== false;

/** The list's open-firing rule: an errored run during a firing observed no recovery. */
export const isFiringNow = (row: FiringSignals): boolean =>
  isLive(row) &&
  (row.last_outcome === "firing" ||
    row.last_outcome === "notify_failed" ||
    row.firing_started_at != null ||
    (row.last_outcome === "error" && (row.groups_firing ?? 0) > 0));

/** Whether an ack can change anything; a lower-bound group count may hide groups still unacked. */
export const ackCanChange = (row: AckSignals): boolean => {
  if (!row.ack) return true;
  if (!row.multi_alert || row.groups_firing == null) return false;
  return !!row.groups_firing_is_lower_bound || (row.ack.groups_acked ?? 0) < row.groups_firing;
};

/** Failed is an anomaly whose model training failed; otherwise enabled is active and disabled paused. */
export const alertOperationalState = (row: RailSignals): AlertOperationalState => {
  if (row?.is_real_time === "anomaly" && String(row?.status).toLowerCase() === "failed")
    return "failed";
  return row?.enabled ? "active" : "paused";
};

/** Counts muted firings too, and an open firing whose latest evaluation errored before any recovery. */
export const isFiringListRow = (row: FiringSignals): boolean =>
  (shouldShowRunOutcome(row?.enabled, row?.last_outcome) && isFiringOutcome(row?.last_outcome)) ||
  (!!row?.enabled && isFiringNow(row));

/** An unknown run state shows no firing, so a stale firing never reads as live. */
export const alertRailState = (row: RailSignals, statusUnavailable: boolean): AlertRailState => {
  const state = alertOperationalState(row);
  if (state !== "active") return state;
  if (statusUnavailable || row.status_unavailable || !isFiringListRow(row)) return "active";
  return row.ack && !ackCanChange(row) ? "acknowledged" : "firing";
};
