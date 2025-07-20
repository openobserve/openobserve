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

/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";
import { useStore } from "vuex";

interface DomainRestriction {
  name: string;
  allowAllUsers: boolean;
  allowedEmails: string[];
}

interface DomainSettings {
  domains: DomainRestriction[];
}

const domainManagement = {
  // Get SSO domain restrictions for an organization
  getDomainRestrictions: (metaOrg: string) => {
    const store = useStore();
    return http().get(`/api/${metaOrg}/domain_management`);
  },
  // Update specific domain settings
  updateDomainRestrictions: (metaOrg: string, domain: DomainRestriction) => {
    const store = useStore();
    return http().put(`/api/${metaOrg}/domain_management`, domain);
  },
};

export default domainManagement;
