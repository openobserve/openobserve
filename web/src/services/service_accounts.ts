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

const service_accounts = {
  list: (org_identifier: string, config?: { silentForbidden?: boolean }) => {
    const url = `/api/${org_identifier}/service_accounts`;
    return config ? http().get(url, config) : http().get(url);
  },
  create: (data: any, org_identifier: string) => {
    return http().post(`/api/${org_identifier}/service_accounts`, data);
  },
  update: (data: any, org_identifier: string, user_email: string) => {
    return http().put(`/api/${org_identifier}/service_accounts/${user_email}`, data);
  },
  delete: (org_identifier: string, user_email: string) => {
    return http()
      .delete(`/api/${org_identifier}/service_accounts/${user_email}`)
      .then((res) => {
        analytics.track("service_account_deleted", { count: 1 });
        return res;
      });
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http()
      .delete(`/api/${org_identifier}/service_accounts/bulk`, { data })
      .then((res) => {
        const count = res.data?.successful?.length ?? 0;
        if (count > 0) analytics.track("service_account_deleted", { count });
        return res;
      });
  },
  refresh_token: (org_identifier: string, user_email: string) => {
    return http()
      .put(`/api/${org_identifier}/service_accounts/${user_email}?rotateToken=true`, {})
      .then((res) => {
        analytics.track("service_account_token_rotated");
        return res;
      });
  },
};
export default service_accounts;
