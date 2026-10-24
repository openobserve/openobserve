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
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { orgKey } from "@/composables/query/keys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  buildHistoryQuery,
  fillCountBuckets,
  parseBucketTime,
  scoreHistory,
  type Bucket,
  type RuleKind,
} from "@/utils/alerts/backtest";

/** The parts of a Builder rule the suggestion reads; `enabled` is false in edit, realtime, SQL and PromQL. */
export interface ThresholdRule {
  enabled: boolean;
  streamName: string;
  streamType: string;
  query: string;
  kind: RuleKind;
  operator: string;
  threshold: number | null;
  periodMinutes: number;
  silenceMinutes: number;
}

interface RuleHistory {
  buckets: Bucket[];
  now: number;
  historyStart: number;
  truncatedDays: number | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const positive = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Suggested threshold and back-test for a Builder rule: one query per stream/filter/period, threshold edits re-scored locally. */
export function useThresholdSuggestion(rule: () => ThresholdRule) {
  const store = useStore();
  const { t } = useI18nTyped();
  const { getStream } = useStreams(t);

  const periodMinutes = computed(() => Math.max(1, Math.round(rule().periodMinutes || 0)));
  const historySql = computed(() =>
    rule().enabled ? buildHistoryQuery(rule().query, periodMinutes.value) : null,
  );
  const enabled = computed(() => !!historySql.value && !!rule().streamName);

  const fetchHistory = async (): Promise<RuleHistory> => {
    const { streamName, streamType, kind } = rule();
    const stepMs = periodMinutes.value * 60_000;
    const stream = await getStream(streamName, streamType, false).catch(() => null);
    const maxHours =
      positive(stream?.settings?.max_query_range) ||
      positive(store.state.zoConfig?.max_query_range);
    const windowMs = maxHours ? Math.min(WEEK_MS, maxHours * HOUR_MS) : WEEK_MS;
    const now = Date.now();
    const start = now - windowMs;
    const limit = Math.ceil(windowMs / stepMs) + 1;
    const sql = `${historySql.value} LIMIT ${limit}`;
    const base64 = !!store.state.zoConfig?.sql_base64_enabled;
    const res = await searchService.search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: {
          query: {
            sql: base64 ? b64EncodeUnicode(sql) : sql,
            start_time: start * 1000,
            end_time: now * 1000,
            from: 0,
            size: limit,
          },
          ...(base64 ? { encoding: "base64" } : {}),
        },
        page_type: streamType,
      },
      "ui",
    );
    const raw: Bucket[] = ((res?.data?.hits ?? []) as Record<string, unknown>[])
      .map((hit) => ({ time: parseBucketTime(hit.zo_sql_key), value: Number(hit.zo_sql_num) }))
      .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.value));
    const firstRecord = positive(stream?.stats?.doc_time_min) / 1000;
    const firstBucket = raw.length ? Math.min(...raw.map((b) => b.time)) : now;
    const historyStart = Math.max(start, firstRecord || firstBucket);
    return {
      // A period with no matching rows is a real zero for a count rule, and missing data for a value rule.
      buckets: kind === "count" ? fillCountBuckets(raw, historyStart, now, stepMs) : raw,
      now,
      historyStart,
      truncatedDays: windowMs < WEEK_MS ? Math.round((windowMs / DAY_MS) * 10) / 10 : null,
    };
  };

  const query = useQuery(() => ({
    queryKey: orgKey(
      store.state.selectedOrganization?.identifier ?? "",
      "alerts",
      "thresholdHistory",
      rule().streamType,
      rule().streamName,
      rule().kind,
      periodMinutes.value,
      historySql.value,
    ),
    queryFn: fetchHistory,
    enabled: enabled.value,
    staleTime: MEDIUM_STALE_TIME,
    retry: false,
  }));

  const history = computed(() => (enabled.value ? query.data.value : undefined));
  const score = computed(() =>
    history.value
      ? scoreHistory({
          buckets: history.value.buckets,
          now: history.value.now,
          historyStart: history.value.historyStart,
          kind: rule().kind,
          operator: rule().operator,
          silenceMinutes: Number(rule().silenceMinutes) || 0,
          periodMinutes: periodMinutes.value,
        })
      : null,
  );

  return {
    suggested: computed(() => score.value?.suggested ?? null),
    usualHigh: computed(() => score.value?.usualHigh ?? null),
    truncatedDays: computed(() => history.value?.truncatedDays ?? null),
    history: computed(() => score.value?.history ?? null),
    backtest: computed(() => score.value?.backtestFor(rule().threshold) ?? null),
    loading: computed(() => enabled.value && query.isFetching.value),
    error: computed(() => enabled.value && query.isError.value),
  };
}
