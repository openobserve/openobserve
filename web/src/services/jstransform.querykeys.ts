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

/**
 * Keys only, and deliberately dependency-free apart from `orgKey`.
 *
 * A write in another domain often has to drop this one's scope, and importing
 * `<domain>.queries.ts` to reach a key would pull that file's transport import
 * with it — and, once two domains invalidate each other, form a cycle. A leaf
 * module cannot participate in one.
 *
 * `all` is the invalidation scope; the rest are individual entries beneath it.
 */
export const functionKeys = {
  all: (org: string) => orgKey(org, "functions"),
  list: (org: string) => orgKey(org, "functions", "list"),
  enrichmentStatuses: (org: string) => orgKey(org, "functions", "enrichmentStatuses"),
};
