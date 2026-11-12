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

const alertSources = {
  list: (org_identifier: string) => {
    return http().get(`/api/v2/${org_identifier}/incidents/integrations`);
  },
  create: (org_identifier: string, data: any) => {
    return http()
      .post(`/api/v2/${org_identifier}/incidents/integrations`, data)
      .then((res) => {
        analytics.track("alert_source_created");
        return res;
      });
  },
  setEnabled: (org_identifier: string, integration_id: string, enabled: boolean) => {
    return http()
      .patch(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}/enable`, {
        enabled,
      })
      .then((res) => {
        analytics.track(enabled ? "alert_source_enabled" : "alert_source_disabled");
        return res;
      });
  },
  rotate: (org_identifier: string, integration_id: string) => {
    return http()
      .post(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}/rotate`)
      .then((res) => {
        analytics.track("alert_source_token_rotated");
        return res;
      });
  },
  update: (
    org_identifier: string,
    integration_id: string,
    data: { name?: string; destinations?: string[] },
  ) => {
    return http()
      .patch(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}`, data)
      .then((res) => {
        analytics.track("alert_source_updated", {
          name_changed: data.name !== undefined,
          destinations_changed: data.destinations !== undefined,
        });
        return res;
      });
  },
  listSenders: (org_identifier: string, integration_id: string) => {
    return http().get(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}/senders`);
  },
  delete: (org_identifier: string, integration_id: string) => {
    return http()
      .delete(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}`)
      .then((res) => {
        analytics.track("alert_source_deleted", { count: 1 });
        return res;
      });
  },
};

export default alertSources;
