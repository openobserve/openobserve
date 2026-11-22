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
import type { DomainRestrictionsBody } from "@/utils/domainRestrictions";
import type { DomainManagementResponse } from "@/ts/interfaces";

const domainManagement = {
  getDomainRestrictions: (metaOrg: string) => {
    return http().get<DomainManagementResponse>(`/api/${metaOrg}/domain_management`);
  },
  updateDomainRestrictions: (metaOrg: string, domain: DomainRestrictionsBody) => {
    return http()
      .put(`/api/${metaOrg}/domain_management`, domain)
      .then((res) => {
        analytics.track("domain_restrictions_updated");
        return res;
      });
  },
};

export default domainManagement;
