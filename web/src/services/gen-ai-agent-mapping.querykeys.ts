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
export const genAiAgentKeys = {
  all: (org: string) => orgKey(org, "genAiAgents"),
  /** Callers pass an already-quantized range: a relative window re-anchors to `now` on every mount and would never hit. */
  agents: (org: string, start: number, end: number) =>
    orgKey(org, "genAiAgents", "list", `${start}-${end}`),
};
