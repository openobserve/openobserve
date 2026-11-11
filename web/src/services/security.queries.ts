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

import { queryOptions } from "@tanstack/vue-query";
import { LIVE_STALE_TIME, NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import security, { type SecurityAccess, type SecurityAuditPage } from "./security";
import { securityKeys } from "./security.querykeys";

export const securityAccessQuery = (org: string) =>
  queryOptions({
    queryKey: securityKeys.access(org),
    queryFn: async (): Promise<SecurityAccess> => (await security.getAccess(org)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const securityAuditQuery = (org: string) =>
  queryOptions({
    queryKey: securityKeys.audit(org),
    queryFn: async (): Promise<SecurityAuditPage> => (await security.getAudit(org)).data,
    staleTime: LIVE_STALE_TIME,
  });
