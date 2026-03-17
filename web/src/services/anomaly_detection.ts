// Copyright 2023 OpenObserve Inc.
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

const anomaly_detection = {
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/anomaly_detection`);
  },

  // GET /api/v2/{org}/alerts/{id} — falls back to anomaly table when ID not in alerts
  get: (org_identifier: string, anomaly_id: string) => {
    return http().get(`/api/v2/${org_identifier}/alerts/${anomaly_id}`);
  },

  // POST /api/v2/{org}/alerts — delegates to anomaly config creation when alert_type is "anomaly_detection"
  create: (org_identifier: string, data: object) => {
    return http().post(`/api/v2/${org_identifier}/alerts`, data);
  },

  // PUT /api/v2/{org}/alerts/{id} — delegates to anomaly config update when alert_type is "anomaly_detection"
  update: (org_identifier: string, anomaly_id: string, data: object) => {
    return http().put(
      `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
      data,
    );
  },

  // DELETE /api/v2/{org}/alerts/{id} — falls back to anomaly config delete when ID not in alerts
  delete: (org_identifier: string, anomaly_id: string) => {
    return http().delete(
      `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
    );
  },

  // Pause (enabled=false) or Resume (enabled=true) via unified alerts update endpoint
  toggleEnabled: (
    org_identifier: string,
    anomaly_id: string,
    enabled: boolean,
  ) => {
    return http().put(
      `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
      { alert_type: "anomaly_detection", anomaly_config: { enabled } },
    );
  },

  triggerTraining: (org_identifier: string, anomaly_id: string) => {
    return http().post(
      `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`,
      {},
    );
  },

  cancelTraining: (org_identifier: string, anomaly_id: string) => {
    return http().delete(
      `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`,
    );
  },

  triggerDetection: (org_identifier: string, anomaly_id: string) => {
    return http().post(
      `/api/${org_identifier}/anomaly_detection/${anomaly_id}/detect`,
      {},
    );
  },

  getHistory: (
    org_identifier: string,
    anomaly_id: string,
    limit: number = 100,
  ) => {
    return http().get(
      `/api/${org_identifier}/anomaly_detection/${anomaly_id}/history?limit=${limit}`,
    );
  },
};

export default anomaly_detection;
