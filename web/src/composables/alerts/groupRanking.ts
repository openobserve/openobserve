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

import { reactive } from "vue";

export interface GroupRankingKey {
  org: string;
  streamType: string;
  streamName: string;
}

const rankings = reactive(new Map<string, readonly string[]>());
const keyOf = (k: GroupRankingKey) => [k.org, k.streamType, k.streamName].join("\u0000");

/** Step 1 ranks a stream's group fields from its data; every group-by picker lists in that order. */
export const publishGroupRanking = (k: GroupRankingKey, names: readonly string[]): void => {
  rankings.set(keyOf(k), [...names]);
};

export const groupRanking = (k: GroupRankingKey): readonly string[] => rankings.get(keyOf(k)) ?? [];
