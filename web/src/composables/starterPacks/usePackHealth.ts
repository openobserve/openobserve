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

import { ref } from "vue";

import { readQuery } from "@/composables/query/readQuery";
import { streamNameListQuery } from "@/services/stream.queries";

export const STALE_AFTER_US = 30 * 60 * 1_000_000;

/** The newest event of the read streams when none has arrived for 30 minutes; a stream without stats says nothing. */
export const staleSinceUs = (
  rows: Array<{ name: string; stats?: { doc_time_max?: number } }>,
  names: Set<string>,
  nowUs: number,
): number | null => {
  const latest = rows
    .filter(({ name }) => names.has(name))
    .map(({ stats }) => stats?.doc_time_max ?? 0)
    .filter(Boolean);
  if (!latest.length) return null;
  const newest = Math.max(...latest);
  return nowUs - newest >= STALE_AFTER_US ? newest : null;
};

/** Pack health from stream stats, since alerts cannot detect missing data themselves. */
export function usePackHealth(org: string) {
  const staleSince = ref<number | null>(null);
  const staleStreams = ref<Set<string>>(new Set());

  const check = async (names: string[], type = "metrics") => {
    const rows = await readQuery(streamNameListQuery(org, type)).catch(() => []);
    const nowUs = Date.now() * 1000;
    const wanted = new Set(names);
    staleSince.value = staleSinceUs(rows, wanted, nowUs);
    staleStreams.value = new Set(
      names.filter((name) => staleSinceUs(rows, new Set([name]), nowUs) !== null),
    );
  };

  return { staleSince, staleStreams, check };
}
