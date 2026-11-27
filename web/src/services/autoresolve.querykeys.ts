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

/** Keys only, so another domain can drop this scope without importing the transport. */
export const autoresolveKeys = {
  all: (org: string) => orgKey(org, "autoresolve"),
  summary: (org: string) => orgKey(org, "autoresolve", "summary"),
  runs: (org: string, filters: Record<string, unknown>) =>
    orgKey(org, "autoresolve", "runs", filters),
  run: (org: string, id: string) => orgKey(org, "autoresolve", "run", id),
  saved: (org: string) => orgKey(org, "autoresolve", "saved"),
  savedOne: (org: string, id: string) => orgKey(org, "autoresolve", "saved", id),
  corrections: (org: string, autoresolveId: string) =>
    orgKey(org, "autoresolve", "corrections", autoresolveId),
  incident: (org: string, incidentId: string) => orgKey(org, "autoresolve", "incident", incidentId),
};
