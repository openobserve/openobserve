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

export type AuthzResource = "dashboard" | "alert" | "pipeline" | "function" | "stream";
export type AuthzAction = "edit" | "delete";

export interface AuthzCheckItem {
  resource: AuthzResource;
  id: string;
  action: AuthzAction;
  folder?: string;
  stream_type?: string;
}

export interface AuthzCheckResponse {
  enforced: boolean;
  results: { allowed: boolean | null }[];
}

export const AUTHZ_CHECK_MAX_ITEMS = 500;

// The dev stub is a Vite middleware, so it must be reached on the dev-server origin, not API_ENDPOINT.
const stubOrigin = (): string | undefined =>
  import.meta.env.DEV && import.meta.env.VITE_AUTHZ_STUB ? window.location.origin : undefined;

const authz = {
  check: (org: string, items: AuthzCheckItem[]) => {
    const origin = stubOrigin();
    return http().post<AuthzCheckResponse>(
      `${origin ?? ""}/api/${org}/authz/check`,
      { items },
      { skipAccessToast: true, silentForbidden: true },
    );
  },
};

export default authz;
