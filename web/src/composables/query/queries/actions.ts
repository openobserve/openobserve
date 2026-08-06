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

/**
 * Action scripts. Read on every Logs page entry (alongside functions), which is
 * why it is cached rather than re-requested per visit.
 */

import actionService from "@/services/action_scripts";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const actionsOptions = (org: string) => ({
  queryKey: qk.actions.list(org),
  queryFn: async (): Promise<any> => (await actionService.list(org)).data,
  ...tierOptions("ORG_CONFIG"),
});

export const fetchActions = (org: string): Promise<any> =>
  queryClient.fetchQuery(actionsOptions(org));

export const invalidateActions = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.actions.root(org) });
