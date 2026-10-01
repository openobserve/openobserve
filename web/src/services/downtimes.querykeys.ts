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
export const downtimeKeys = {
  all: (org: string) => orgKey(org, "downtimes"),
  list: (org: string) => orgKey(org, "downtimes", "list"),
  detail: (org: string, id: string) => orgKey(org, "downtimes", "detail", id),
  preview: (org: string, body: unknown) => orgKey(org, "downtimes", "preview", body),
  resources: (org: string, body: unknown) => orgKey(org, "downtimes", "resources", body),
};
