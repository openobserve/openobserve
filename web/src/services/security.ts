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

/** What the caller may do in Security: read = enter, triage = PUT/POST, admin = DELETE. */
export interface SecurityAccess {
  read: boolean;
  triage: boolean;
  author: boolean;
  admin: boolean;
}

/** One change to the org's Security configuration, read from the audit trail. */
export interface SecurityAuditEvent {
  timestamp: number;
  user_email: string;
  method: string;
  path: string;
  query: string;
  status_code: number;
  category: "detection" | "case" | "source" | "security";
  body: string;
}

export interface SecurityAuditPage {
  audit_enabled: boolean;
  start_time: number;
  end_time: number;
  events: SecurityAuditEvent[];
}

const LEGACY_OPEN_ACCESS: SecurityAccess = { read: true, triage: true, author: true, admin: true };

const security = {
  getAccess: (org: string) =>
    http()
      .get<SecurityAccess>(`/api/${org}/security/access`)
      .catch((error) => {
        // A backend without this route predates the Security gate and enforces none, so hiding the UI only breaks it.
        if (error?.response?.status === 404) return { data: LEGACY_OPEN_ACCESS };
        throw error;
      }),
  getAudit: (org: string, size = 100) =>
    http().get<SecurityAuditPage>(`/api/${org}/security/audit`, { params: { size } }),
};

export default security;
