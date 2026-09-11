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
import licenseServer from "./license_server";
import { licenseKeys } from "./license_server.querykeys";

/** Not org-scoped. Always revalidated: entitlement changes must land at once. */
export const licenseQuery = () =>
  queryOptions({
    queryKey: licenseKeys.get(),
    queryFn: async () => (await licenseServer.get_license()).data,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
