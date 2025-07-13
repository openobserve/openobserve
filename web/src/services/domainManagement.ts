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
  getDomainRestrictions: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/sso/domain-restrictions`);
  },

  // Update SSO domain restrictions for an organization
  updateDomainRestrictions: (orgIdentifier: string, data: DomainSettings) => {
    return http().post(`/api/${orgIdentifier}/sso/domain-restrictions`, data);
  },

  // Add a new domain restriction
  addDomainRestriction: (orgIdentifier: string, domain: DomainRestriction) => {
    return http().post(`/api/${orgIdentifier}/sso/domain-restrictions/domain`, domain);
  },

  // Remove a domain restriction
  removeDomainRestriction: (orgIdentifier: string, domainName: string) => {
    return http().delete(`/api/${orgIdentifier}/sso/domain-restrictions/domain/${domainName}`);
  },

  // Update specific domain settings
  updateDomainSettings: (orgIdentifier: string, domainName: string, domain: DomainRestriction) => {
    return http().put(`/api/${orgIdentifier}/sso/domain-restrictions/domain/${domainName}`, domain);
  },
};

export default domainManagement;
