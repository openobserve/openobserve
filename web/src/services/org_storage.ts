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
import store from "@/stores";

const orgStorage = {
  get: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/storage`);
  },

  create: (org_identifier: string, data: any) => {
    return http()
      .post(`/api/${org_identifier}/storage`, data)
      .then((res) => {
        analytics.track("storage_settings_created", { provider: data?.provider });
        return res;
      });
  },

  update: (org_identifier: string, data: any) => {
    return http()
      .put(`/api/${org_identifier}/storage`, data)
      .then((res) => {
        analytics.track("storage_settings_updated", { provider: data?.provider });
        return res;
      });
  },

  enable: (org_identifier: string) => {
    const currentOrg = store.state.selectedOrganization.identifier;
    return http()
      .put(`/api/${currentOrg}/enable_org_storage`, {
        org_id: org_identifier,
      })
      .then((res) => {
        analytics.track("storage_settings_enabled");
        return res;
      });
  },
};

export default orgStorage;
