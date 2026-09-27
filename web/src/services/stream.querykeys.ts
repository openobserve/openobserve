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

import { orgKey } from "@/composables/query/keys";
import type { StreamPageParams } from "./stream";

/**
 * Keys only, dependency-free apart from `orgKey`, so a write in another domain
 * can drop this scope without importing this domain's transport — and so two
 * domains invalidating each other cannot form an import cycle.
 *
 * `all` is the invalidation scope; the rest are entries beneath it.
 */
export const streamKeys = {
  all: (org: string) => orgKey(org, "streams"),
  nameList: (org: string, type: string) => orgKey(org, "streams", "nameList", type),
  /** Every paginated Log Streams page, any type — the scope a delete or forced read drops. */
  pagesAll: (org: string) => orgKey(org, "streams", "page"),
  page: (org: string, type: string, params: StreamPageParams) =>
    orgKey(org, "streams", "page", type || "all", params),
  /** One entry per stream, not per caller — the list queries deliberately fetch with `schema: false`. */
  schema: (org: string, type: string, streamName: string) =>
    orgKey(org, "streams", "schema", type || "all", streamName),
};
