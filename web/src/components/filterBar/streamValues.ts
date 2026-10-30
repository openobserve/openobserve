// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { requestFieldValues, type StreamContext } from "@/composables/fieldValueStore";

export type FilterValueLoader = (field: string, search: string) => Promise<string[]>;

// An unresolved `$variable` or `{{template}}` names no stream the values API can read.
const UNRESOLVED = /\$|\{\{/;

/** A builder value loader over a stream's recent values, the logs bar's API; none while the stream is unknown. */
export const streamValuesLoader = (
  context: Partial<StreamContext> | null | undefined,
): FilterValueLoader | undefined => {
  const { org, streamType, streamName } = context ?? {};
  if (!org || !streamType || !streamName || UNRESOLVED.test(streamName)) return undefined;
  return (field, search) =>
    requestFieldValues({ org, streamType, streamName }, field, { keyword: search || undefined });
};
