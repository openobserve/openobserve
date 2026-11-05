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

import type { DockHostId, InlineHostId, ProposalHostId } from "./assistantStore.types";

/** Editors that take the inline helper but never dock a chat. */
export const INLINE_HOST_IDS: ReadonlySet<ProposalHostId> = new Set<InlineHostId>([
  "logs",
  "dashboard",
  "anomaly",
  "alert",
]);

/** True for an editor whose hand-off opens its own dock. */
export function isDockHostId(id: ProposalHostId): id is DockHostId {
  return !INLINE_HOST_IDS.has(id);
}
