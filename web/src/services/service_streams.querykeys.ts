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

/** Keys only, so another domain can drop this scope without importing this domain's transport (no import cycle). */
export const serviceStreamKeys = {
  all: (org: string) => orgKey(org, "serviceStreams"),
  semanticGroups: (org: string) => orgKey(org, "serviceStreams", "semanticGroups"),
  identityConfig: (org: string) => orgKey(org, "serviceStreams", "identityConfig"),
};

/** Org-scoped keys cannot be swept for every org at once, so the all-org clear has to be a predicate. */
export const isServiceStreamKey = (queryKey: readonly unknown[], entry: string): boolean =>
  queryKey[0] === "org" && queryKey[2] === "serviceStreams" && queryKey[3] === entry;
