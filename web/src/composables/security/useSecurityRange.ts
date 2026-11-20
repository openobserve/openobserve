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

import { computed, ref } from "vue";
import type { DateTimeRangeChange } from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import { securityTime } from "@/utils/security/time";

const UNIT_MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000,
} as const;
const RELATIVE = /^(\d+)([smhdwM])$/;

export const DEFAULT_SECURITY_PERIOD = "24h";

export function isRelativePeriod(value: unknown): value is string {
  return typeof value === "string" && RELATIVE.test(value);
}

/** Milliseconds in a relative period such as `15m`, `24h` or `7d`; 0 when it is not one. */
export function periodMs(period: string): number {
  const m = RELATIVE.exec(period);
  return m ? Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS] : 0;
}

type Query = Record<string, unknown>;

/**
 * The one time window of a Security page: a relative period or an absolute range, read from and
 * written to the URL as `period` or `from`/`to` (epoch microseconds).
 */
export function useSecurityRange(query: Query, fallback = DEFAULT_SECURITY_PERIOD) {
  const from = Number(query.from);
  const to = Number(query.to);
  const linked =
    Number.isFinite(from) && Number.isFinite(to) && to > from
      ? { startMs: Math.floor(from / 1000), endMs: Math.ceil(to / 1000) }
      : null;

  const period = ref(isRelativePeriod(query.period) ? query.period : fallback);
  const absolute = ref<{ startMs: number; endMs: number } | null>(linked);
  const endMs = ref(linked?.endMs ?? Date.now());

  const windowMs = computed(() =>
    absolute.value
      ? absolute.value.endMs - absolute.value.startMs
      : periodMs(period.value) || periodMs(fallback),
  );
  const startMs = computed(() => absolute.value?.startMs ?? endMs.value - windowMs.value);
  const startUs = computed(() => startMs.value * 1000);
  const endUs = computed(() => endMs.value * 1000);

  /** Slides a relative window to now; an absolute range stays where it was set. */
  function touch() {
    endMs.value = absolute.value?.endMs ?? Date.now();
  }

  /** Takes a picker change; false when it came from the page itself or changed nothing. */
  function apply(change: DateTimeRangeChange): boolean {
    if (change.userChangedValue === false) return false;
    const rel = change.relativeTimePeriod;
    if (isRelativePeriod(rel)) {
      if (!absolute.value && rel === period.value) return false;
      period.value = rel;
      absolute.value = null;
    } else {
      absolute.value = {
        startMs: Math.floor(change.startTime / 1000),
        endMs: Math.ceil(change.endTime / 1000),
      };
    }
    touch();
    return true;
  }

  /** The URL and cross-page link params that carry this window. */
  const linkQuery = computed((): Record<string, string> => {
    if (!absolute.value) return { period: period.value };
    return {
      from: String(absolute.value.startMs * 1000),
      to: String(absolute.value.endMs * 1000),
    };
  });

  const pickerProps = computed(() =>
    absolute.value
      ? {
          defaultType: "absolute" as const,
          defaultRelativeTime: fallback,
          defaultAbsoluteTime: { startTime: absolute.value.startMs, endTime: absolute.value.endMs },
        }
      : { defaultType: "relative" as const, defaultRelativeTime: period.value },
  );

  /** Short text for sentences: "24h", or "Nov 9, 03:59 AM – Nov 10, 03:59 AM" for a range. */
  const text = computed(() =>
    absolute.value
      ? `${securityTime(absolute.value.startMs)} – ${securityTime(absolute.value.endMs)}`
      : period.value,
  );

  return {
    period,
    absolute,
    endMs,
    startMs,
    startUs,
    endUs,
    windowMs,
    linkQuery,
    pickerProps,
    text,
    touch,
    apply,
  };
}
