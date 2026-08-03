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

const alertSources = {
  list: (org_identifier: string) => {
    return http().get(`/api/v2/${org_identifier}/incidents/integrations`);
  },
  create: (org_identifier: string, data: any) => {
    return http().post(`/api/v2/${org_identifier}/incidents/integrations`, data);
  },
  setEnabled: (org_identifier: string, integration_id: string, enabled: boolean) => {
    return http().patch(
      `/api/v2/${org_identifier}/incidents/integrations/${integration_id}/enable`,
      { enabled },
    );
  },
  rotate: (org_identifier: string, integration_id: string) => {
    return http().post(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}/rotate`);
  },
  listSenders: (org_identifier: string, integration_id: string) => {
    return http().get(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}/senders`);
  },
  delete: (org_identifier: string, integration_id: string) => {
    return http().delete(`/api/v2/${org_identifier}/incidents/integrations/${integration_id}`);
  },
};

export default alertSources;
