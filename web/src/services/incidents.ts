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
  service: string;
  upstream_services: string[];
  downstream_services: string[];
  related_incident_ids: string[];
  suggested_root_cause?: string;
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
};

export default incidents;
