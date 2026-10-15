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

import http from "./http";
import analytics from "./product_analytics";
import type { TranslateFn } from "@/types/i18n";
import serviceStreamsApi, {
  type CorrelationRequest,
  type CorrelationResponse,
  type StreamInfo,
} from "./service_streams";
import { filterDimensionsForCorrelation } from "@/utils/telemetryCorrelation";
import {
  loadIdentityConfig,
  clearIdentityConfigCache,
  clearAllIdentityConfigCache,
} from "@/utils/identityConfig";

// Types matching backend API responses
export interface Incident {
  id: string;
  org_id: string;
  status: "open" | "acknowledged" | "resolved";
  severity: "P1" | "P2" | "P3" | "P4";
  group_values?: Record<string, string>;
  key_type?: "Primary" | "Secondary" | "AlertId";
  topology_context?: IncidentTopology;
  first_alert_at: number;
  last_alert_at: number;
  resolved_at?: number;
  alert_count: number;
  title?: string;
  assigned_to?: string;
  acknowledged_by?: string;
  acknowledged_at?: number;
  created_at: number;
  updated_at: number;
  /** Set while a downtime mutes the incident; cleared by the first firing after the window. */
  muted_by_downtime_id?: string | null;
  /** Summary of the latest RCA run, or null when the incident has none. */
  rca: RcaSummary | null;
  /** Why no automatic run started for this incident (e.g. "l0_off"), or null. */
  rca_off_reason?: string | null;
}

export type RcaRunState = "running" | "waiting_input" | "completed" | "failed" | "cancelled";

export type RcaTrigger =
  | "auto_new_incident"
  | "auto_new_alert_type"
  | "auto_reopen"
  | "manual"
  | "reanalyze"
  | "oncall_page"
  | "resume"
  | "legacy";

export type RcaRunMode = "fresh" | "build_on_previous";

export type RcaRunSubjectType = "incident" | "alert";

/** The finished result shown while a newer run is live, failed or cancelled. */
export interface RcaPreviousResult {
  run_id: string;
  outcome: string | null;
  confidence: string | null;
  /** Microseconds since epoch. */
  ended_at: number;
}

/** The `rca_summary` fields stored on the incident row. */
export interface RcaSummaryFields {
  stage: string | null;
  stage_index: number | null;
  stage_count: number;
  steps: number;
  tool_calls: number;
  steered_by: string[];
  unblocked_by: string | null;
  /** The error reason of a failed run, or the blocked detail. */
  detail: string | null;
  deadline_at: number | null;
  /** Display name of the user who cancelled the run. */
  cancelled_by?: string | null;
  previous: RcaPreviousResult | null;
}

/** Run summary of an incident's latest run. Times are microseconds since epoch. */
export interface RcaSummary {
  run_id: string;
  state: RcaRunState;
  /** Computed by the server: a running run with no update past the stale threshold. */
  stale: boolean;
  started_at: number;
  updated_at: number;
  outcome: string | null;
  confidence: string | null;
  summary: RcaSummaryFields;
  /** Detail endpoint only: the newest run, without its report. */
  current_run?: RcaRun | null;
  /** Detail endpoint only: the newest completed run, without its report. */
  report_run?: RcaRunItem | null;
  /** Detail endpoint only: runs newest first. */
  history?: RcaRunItem[];
}

export interface RcaRunItem {
  run_id: string;
  subject_type: RcaRunSubjectType;
  trigger: RcaTrigger;
  mode: RcaRunMode;
  started_by: string;
  state: RcaRunState;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  confidence: string | null;
  cancelled_by: string | null;
  error_reason: string | null;
}

export interface RcaRunError {
  code: string;
  reason: string;
  details: string | null;
  trigger_type: string | null;
}

export interface RcaRunStats {
  steps?: number;
  tool_calls?: number;
  duration_ms?: number;
  tokens?: unknown;
  credits?: number;
  steered?: number;
}

export interface RcaRun {
  run_id: string;
  subject_type: RcaRunSubjectType;
  subject_id: string;
  incident_id: string | null;
  trigger: RcaTrigger;
  mode: RcaRunMode;
  started_by: string;
  guidance: string | null;
  state: RcaRunState;
  started_at: number;
  updated_at: number;
  ended_at: number | null;
  cancelled_by: string | null;
  outcome: string | null;
  confidence: string | null;
  report: string | null;
  result: unknown;
  error: RcaRunError | null;
  session_id: string | null;
  stats: RcaRunStats | null;
}

export interface ListRcaRunsResponse {
  runs: RcaRunItem[];
  has_more: boolean;
}

/** POST …/rca: 202 `{message, run_id}` (spawned) or 200 `{rca_content, run_id}` (inline). */
export interface TriggerRcaResponse {
  message?: string;
  rca_content?: string;
  run_id: string;
}

export interface CancelRcaResponse {
  message: string;
  aborted_local_task: boolean;
  run_id: string;
}

export interface IncidentTopology {
  nodes: AlertNode[];
  edges: AlertEdge[];
  related_incident_ids: string[];
}

export interface AlertNode {
  alert_id: string;
  alert_name: string;
  service_name: string;
  alert_count: number;
  first_fired_at: number;
  last_fired_at: number;
}

export interface AlertEdge {
  from_node_index: number;
  to_node_index: number;
  edge_type: "temporal" | "service_dependency";
}

export interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_kind?: "internal" | "external";
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "primary_match" | "secondary_match" | "alert_id";
  created_at: number;
  source_url?: string | null;
  labels?: Record<string, string> | null;
  detected_source?: string | null;
}

export interface CompositeAlertSummary {
  id: string;
  name: string;
  alert_type: "composite";
  enabled: boolean;
  folder_id: string;
}

export interface IncidentWithAlerts extends Incident {
  alerts: IncidentAlert[];
  triggers: IncidentAlert[];
  composite_alerts?: CompositeAlertSummary[];
}

export interface ExternalAlertPayload {
  id: string;
  detected_source: string;
  source_url: string | null;
  first_seen_at: number;
  last_seen_at: number;
  last_payload: unknown;
}

export interface UpdateSeverityResponse extends Incident {
  analysis_in_flight: boolean;
}

export interface ListIncidentsResponse {
  incidents: Incident[];
  total: number;
}

export interface IncidentStats {
  total_incidents: number;
  open_incidents: number;
  acknowledged_incidents: number;
  resolved_incidents: number;
  by_severity: Record<string, number>;
  by_service: Record<string, number>;
  mttr_minutes?: number;
  alerts_per_incident_avg: number;
}

// Telemetry correlation types
export interface IncidentCorrelatedStreams {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  additionalDimensions: Record<string, string>;
  logStreams: StreamInfo[];
  metricStreams: StreamInfo[];
  traceStreams: StreamInfo[];
  correlationData: CorrelationResponse | null;
}

const incidents = {
  /**
   * List incidents with optional filtering and pagination
   */
  list: (
    org_identifier: string,
    status?: string,
    limit: number = 50,
    offset: number = 0,
    keyword?: string,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/incidents?limit=${limit}&offset=${offset}`;
    if (status) {
      url += `&status=${status}`;
    }
    if (keyword) {
      url += `&keyword=${encodeURIComponent(keyword)}`;
    }
    return http().get<ListIncidentsResponse>(url);
  },

  /**
   * Get incident details with all correlated alerts
   */
  get: (org_identifier: string, incident_id: string) => {
    return http().get<IncidentWithAlerts>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}`,
    );
  },

  /**
   * Get the raw webhook payload originally received for an external alert
   */
  getExternalAlertPayload: (org_identifier: string, external_alert_id: string) => {
    return http().get<ExternalAlertPayload>(
      `/api/v2/${org_identifier}/alerts/incidents/external-alerts/${external_alert_id}/payload`,
    );
  },

  /**
   * Update incident status (open, acknowledged, resolved)
   */
  updateStatus: (
    org_identifier: string,
    incident_id: string,
    status: "open" | "acknowledged" | "resolved",
  ) => {
    return http()
      .patch<Incident>(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/update`, {
        status,
      })
      .then((res) => {
        analytics.track("incident_status_updated", { status });
        return res;
      });
  },

  /**
   * Update incident details (title, severity, etc.)
   */
  updateIncident: (
    org_identifier: string,
    incident_id: string,
    updates: { title?: string; severity?: string },
  ) => {
    return http()
      .patch<Incident | UpdateSeverityResponse>(
        `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/update`,
        updates,
      )
      .then((res) => {
        analytics.track("incident_updated", {
          severity_changed: updates.severity !== undefined,
          title_changed: updates.title !== undefined,
        });
        return res;
      });
  },

  /**
   * Get incident statistics
   */
  getStats: (org_identifier: string) => {
    return http().get<IncidentStats>(`/api/v2/${org_identifier}/alerts/incidents/stats`);
  },

  /**
   * Trigger RCA analysis and return the complete result
   */
  triggerRca: (
    org_identifier: string,
    incident_id: string,
    params: { reanalysis?: boolean; build_on_previous?: boolean } = {},
    config: { signal?: AbortSignal } = {},
  ) => {
    return http()
      .post<TriggerRcaResponse>(
        `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca`,
        null,
        { params, signal: config.signal },
      )
      .then((res) => {
        analytics.track("incident_rca_requested", {
          build_on_previous: params.build_on_previous === true,
        });
        return res;
      });
  },

  /**
   * List the RCA runs of an incident, newest first. `before` is a run id for paging.
   */
  listRcaRuns: (
    org_identifier: string,
    incident_id: string,
    params: { limit?: number; before?: string } = {},
  ) => {
    return http().get<ListRcaRunsResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs`,
      { params },
    );
  },

  /**
   * Get one RCA run of an incident, including its report.
   */
  getRcaRun: (org_identifier: string, incident_id: string, run_id: string) => {
    return http().get<RcaRun>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}`,
    );
  },

  /**
   * Cancel the live RCA run of an incident.
   *
   * Aborts the server-side task when the handling node owns it, and always ends the
   * run as cancelled so a new run can start, stale or not.
   */
  cancelRca: (org_identifier: string, incident_id: string) => {
    return http().delete<CancelRcaResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca`,
    );
  },

  /**
   * Get correlated telemetry streams for an incident
   *
   * Uses the incident's group_values to find related logs, metrics, and traces
   * via the service correlation API. Filters dimensions to only include
   * fields that are actually used for disambiguation.
   *
   * @param org_identifier Organization ID
   * @param incident The incident with group_values
   * @param t Translator, threaded from the calling component — the only
   *   user-facing string here is the "unknown service" fallback name.
   * @returns Correlated streams grouped by type
   */
  getCorrelatedStreams: async (
    org_identifier: string,
    incident: Incident,
    t: TranslateFn,
  ): Promise<IncidentCorrelatedStreams> => {
    const allDimensions = incident.group_values ?? {};

    // Load identity config to filter dimensions (with caching)
    let filteredDimensions = allDimensions;
    try {
      const identityConfig = await loadIdentityConfig(org_identifier);

      // Filter dimensions to only include disambiguation fields
      filteredDimensions = filterDimensionsForCorrelation(allDimensions, identityConfig);
    } catch (err) {
      console.warn(
        "[incidents] Failed to load identity config for dimension filtering, using all dimensions:",
        err,
      );
    }

    const request: CorrelationRequest = {
      source_stream:
        // filteredDimensions only contains "service" key if present (not variations)
        filteredDimensions.service ||
        // Fallback to original dimensions for service name variations
        allDimensions.serviceName ||
        allDimensions["service.name"] ||
        allDimensions["service_name"] ||
        "default",
      source_type: "logs",
      available_dimensions: filteredDimensions,
    };

    const response = await serviceStreamsApi.correlate(org_identifier, request);
    const correlationData = response.data;

    // Handle null response when no service is found
    if (!correlationData) {
      return {
        serviceName: t("traces.unknownService"),
        matchedDimensions: {},
        additionalDimensions: allDimensions,
        logStreams: [],
        metricStreams: [],
        traceStreams: [],
        correlationData: null,
      };
    }

    return {
      serviceName: correlationData.service_name,
      matchedDimensions: correlationData.matched_dimensions || {},
      additionalDimensions: correlationData.additional_dimensions || {},
      logStreams: correlationData.related_streams.logs || [],
      metricStreams: correlationData.related_streams.metrics || [],
      traceStreams: correlationData.related_streams.traces || [],
      correlationData,
    };
  },

  /**
   * Get event timeline for an incident
   */
  getEvents: (org_identifier: string, incident_id: string) => {
    return http().get(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/events`);
  },

  /**
   * Post a comment on an incident
   */
  postComment: (org_identifier: string, incident_id: string, comment: string) => {
    return http()
      .post(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/events/comment`, {
        comment,
      })
      .then((res) => {
        analytics.track("incident_comment_added");
        return res;
      });
  },

  /**
   * Clear identity config cache for a specific organization
   * Call this when identity config settings are updated
   */
  clearIdentityConfigCache,

  /**
   * Clear all identity config caches
   * Use when switching organizations or on logout
   */
  clearAllIdentityConfigCaches: clearAllIdentityConfigCache,
};

export default incidents;
