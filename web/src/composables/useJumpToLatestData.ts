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

import { computed } from "vue";
import { useStore } from "vuex";
import { DateTime } from "luxon";
import useTraces from "@/composables/useTraces";
import { getConsumableRelativeTime } from "@/utils/date";

const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
// Backend uses an exclusive end boundary, so nudge the end by 1s to include the
// record sitting exactly at doc_time_max.
const END_NUDGE_US = 1_000_000;
// setAbsoluteTime round-trips through date strings and loses sub-second
// precision, so compare the window against the data envelope with tolerance.
const TOLERANCE_US = 30_000_000;

/**
 * Shared "jump to latest data" logic for the traces empty states (service graph,
 * services catalog). When the selected stream has data but the current time
 * window sits before it, offers a precise 15-minute window around the stream's
 * most recent record — mirroring the traces search "no events" state so the
 * action reads consistently across pages.
 *
 * Derives the stream doc time range and query window from the shared `searchObj`
 * (same source the traces search page uses). The selected stream's authoritative
 * doc_time_min/max are mirrored into `streamResults.list[].stats` by the Index's
 * extractFields() on load and on every stream change, so this stays current
 * without threading props through the panels.
 */
const useJumpToLatestData = () => {
  const store = useStore();
  const { searchObj } = useTraces();

  // Stream's [min, max] doc time (µs), from the streams name-list stats.
  const streamDocTimeRange = computed<{ min: number; max: number } | undefined>(
    () => {
      const selected = searchObj.data?.stream?.selectedStream?.value;
      if (!selected) return undefined;
      let min = Infinity;
      let max = -Infinity;
      for (const s of searchObj.data?.streamResults?.list ?? []) {
        if (s.name !== selected) continue;
        const st = s.stats;
        if (!st) continue;
        if (st.doc_time_min > 0 && st.doc_time_min < min) min = st.doc_time_min;
        if (st.doc_time_max > 0 && st.doc_time_max > max) max = st.doc_time_max;
      }
      if (!isFinite(min) || !isFinite(max)) return undefined;
      return { min, max };
    },
  );

  // Resolved current query window (µs).
  const queryWindowUs = computed<{ start: number; end: number } | undefined>(
    () => {
      const dt = searchObj.data?.datetime;
      if (!dt) return undefined;
      if (dt.type === "absolute" && dt.startTime && dt.endTime) {
        return { start: Number(dt.startTime), end: Number(dt.endTime) };
      }
      if (dt.type === "relative" && dt.relativeTimePeriod) {
        const r = getConsumableRelativeTime(dt.relativeTimePeriod);
        if (r) return { start: r.startTime, end: r.endTime };
      }
      return undefined;
    },
  );

  // A filter (not the range) is what emptied an overlapping window.
  const hasFilters = computed(
    () => (searchObj.data?.editorValue || "").trim().length > 0,
  );

  // Does the current window overlap the stream's known data envelope? When
  // stats are unavailable, assume overlap (conservative). Mirrors the logs /
  // traces "no events" state so the jump appears in the same situations.
  const windowHasStreamData = computed(() => {
    const r = streamDocTimeRange.value;
    const w = queryWindowUs.value;
    if (!r || !w) return true;
    return w.start <= r.max + TOLERANCE_US && w.end >= r.min - TOLERANCE_US;
  });

  // Offer the jump whenever we know where the stream's last data is and the
  // emptiness isn't caused by a filter within an overlapping window (in which
  // case jumping wouldn't help — the user should relax the query instead).
  const jumpTarget = computed<{ from: number; to: number } | null>(() => {
    const r = streamDocTimeRange.value;
    if (!r) return null;
    if (windowHasStreamData.value && hasFilters.value) return null;
    return { from: r.max - FIFTEEN_MINS_US, to: r.max + END_NUDGE_US };
  });

  const jumpTargetSublabel = computed(() => {
    const r = streamDocTimeRange.value;
    if (!jumpTarget.value || !r) return "";
    const tz = store.state.timezone || "UTC";
    const zone =
      tz.toLowerCase() === "local" || tz.toLowerCase() === "browser"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : tz;
    const formatted = DateTime.fromMillis(r.max / 1000)
      .setZone(zone)
      .toFormat("MMM d, yyyy HH:mm:ss");
    return `Last data: ${formatted} (${zone})`;
  });

  return { jumpTarget, jumpTargetSublabel };
};

export default useJumpToLatestData;
