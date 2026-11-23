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

import { queryClient } from "@/composables/query/queryClient";
import { organizationKeys } from "./organizations.querykeys";

// The summary runs a costly server search, so a burst of creates waits until it goes quiet.
const QUIET_MS = 1_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

const fire = (org: string) => {
  timers.delete(org);
  void queryClient.invalidateQueries({ queryKey: organizationKeys.summary(org), exact: true });
};

/** Marks the org summary stale after a create, once per burst of creates. */
export const refreshOrgSummarySoon = (org: string) => {
  clearTimeout(timers.get(org));
  timers.set(
    org,
    setTimeout(() => fire(org), QUIET_MS),
  );
};
