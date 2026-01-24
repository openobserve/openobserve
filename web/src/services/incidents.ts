// Copyright 2025 OpenObserve Inc.
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
import serviceStreamsApi, {
  type CorrelationRequest,
  type CorrelationResponse,
  type StreamInfo,
} from "./service_streams";

// Types matching backend API responses
export interface Incident {
  id: string;
  org_id: string;
  correlation_key: string;
  status: "open" | "acknowledged" | "resolved";
  severity: "P1" | "P2" | "P3" | "P4";
  stable_dimensions: Record<string, string>;
  topology_context?: IncidentTopology;
  first_alert_at: number;
  last_alert_at: number;
  resolved_at?: number;
  alert_count: number;
  title?: string;
  assigned_to?: string;
  created_at: number;
  updated_at: number;
}

export interface IncidentTopology {
  nodes: AlertNode[];
  edges: AlertEdge[];
  related_incident_ids: string[];
  suggested_root_cause?: string;
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
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "manual_extraction" | "temporal";
  created_at: number;
}

export interface IncidentWithAlerts extends Incident {
  alerts: IncidentAlert[];
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
  correlationData: CorrelationResponse;
}

// Service Graph visualization types
export interface IncidentServiceGraph {
  nodes: AlertNode[];
  edges: AlertEdge[];
  stats: IncidentGraphStats;
}

export interface IncidentGraphStats {
  total_services: number;
  total_alerts: number;
  services_with_alerts: number;
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
    keyword?: string
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
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}`
    );
  },

  /**
   * Update incident status (open, acknowledged, resolved)
   */
  updateStatus: (
    org_identifier: string,
    incident_id: string,
    status: "open" | "acknowledged" | "resolved"
  ) => {
    return http().patch<Incident>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/status`,
      { status }
    );
  },

  /**
   * Update incident details (title, severity, etc.)
   */
  updateIncident: (
    org_identifier: string,
    incident_id: string,
    updates: { title?: string; severity?: string }
  ) => {
    return http().patch<Incident>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/update`,
      updates
    );
  },

  /**
   * Get incident statistics
   */
  getStats: (org_identifier: string) => {
    return http().get<IncidentStats>(
      `/api/v2/${org_identifier}/alerts/incidents/stats`
    );
  },

  /**
   * Trigger RCA analysis and return the complete result
   */
  triggerRca: (org_identifier: string, incident_id: string) => {
    return http().post<{ rca_content: string }>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca`
    );
  },

  /**
   * Get correlated telemetry streams for an incident
   *
   * Uses the incident's stable_dimensions to find related logs, metrics, and traces
   * via the service correlation API.
   *
   * @param org_identifier Organization ID
   * @param incident The incident with stable_dimensions
   * @returns Correlated streams grouped by type
   */
  getCorrelatedStreams: async (
    org_identifier: string,
    incident: Incident
  ): Promise<IncidentCorrelatedStreams> => {
    const dimensions = incident.stable_dimensions;

    const request: CorrelationRequest = {
      source_stream:
        dimensions.service ||
        dimensions.serviceName ||
        dimensions["service.name"] ||
        dimensions["service_name"] ||
        "default",
      source_type: "logs",
      available_dimensions: dimensions,
    };

    const response = await serviceStreamsApi.correlate(org_identifier, request);
    const correlationData = response.data;

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
   * Extract trace_id from incident's first alert
   *
   * Attempts to find a trace_id dimension in the incident's stable_dimensions.
   * This can be used as a fallback correlation method.
   *
   * @param incident The incident to extract trace_id from
   * @returns trace_id if found, undefined otherwise
   */
  extractTraceId: (incident: Incident): string | undefined => {
    const dimensions = incident.stable_dimensions;

    // Check common trace_id field variations
    return (
      dimensions["trace_id"] ||
      dimensions["traceId"] ||
      dimensions["trace.id"] ||
      dimensions["TraceId"]
    );
  },

  /**
   * Get service graph visualization data for an incident
   */
  getServiceGraph: (org_identifier: string, incident_id: string) => {
    return http().get<IncidentServiceGraph>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/service_graph`
    );
  },
};

export default incidents;
