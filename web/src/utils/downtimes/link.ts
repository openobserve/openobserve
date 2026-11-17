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

import type { ActiveDowntime } from "@/services/downtimes";

export interface DowntimeRoute {
  name: "downtimeDetail";
  params: { id: string };
  query: { org_identifier: string; folder?: string };
}

/** The detail page of a downtime; without its folder the server checks the default one and may 403. */
export const downtimeLink = (
  downtime: Pick<ActiveDowntime, "id" | "folder_id">,
  org: string,
): DowntimeRoute => ({
  name: "downtimeDetail",
  params: { id: downtime.id },
  query: {
    org_identifier: org,
    ...(downtime.folder_id ? { folder: downtime.folder_id } : {}),
  },
});
