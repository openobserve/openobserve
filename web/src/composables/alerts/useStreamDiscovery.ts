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

import { reactive } from "vue";
import store from "@/stores";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { FilterOperatorId } from "@/utils/query/filterBar";
import { buildMetricFamilies, type MetricStream } from "@/utils/metrics/metricFamily";
import {
  compactDuration,
  compactNumber,
  formatNumber,
  joinList,
  joinListMore,
} from "@/utils/alerts/alertCopy";
import {
  restoreLogsSelectedStreams,
  restoreMetricsStream,
  restoreTracesStream,
} from "@/utils/streamPersist";

export const DAY_US = 24 * 60 * 60 * 1_000_000;
export const HOUR_US = 60 * 60 * 1_000_000;
/** Values asked for per field; a full page means more may exist. */
export const VALUE_COUNT_SIZE = 20;
const CACHE_TTL_MS = 5 * 60_000;
const RECENT_MAX = 3;
const SEEN_MAX = 3;
const METRIC_TYPE_KEYS = {
  counter: "metrics.badge.counter",
  gauge: "metrics.badge.gauge",
  histogram: "metrics.badge.histogram",
  summary: "metrics.badge.summary",
} as const;
const EXACT_OPS = new Set<FilterOperatorId>(["eq", "in"]);
const TEXT_OPS = new Set<FilterOperatorId>(["contains", "contains_ci", "starts_with", "ends_with"]);

export interface DiscoveryStream extends MetricStream {
  is_internal?: boolean;
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number };
}

export interface StreamFreshness {
  receiving: boolean;
  agoSeconds?: number;
  perHour?: number;
}

export interface StreamOption extends SelectOption {
  value: string;
  subLabel?: I18nText;
  /** No event in the last 24 hours: listed last and greyed. */
  stale?: boolean;
}

export interface ValueCount {
  value: string;
  count: number;
}

export type ValueCountState = "loading" | "ready" | "failed";

export interface ValueCountEntry {
  state: ValueCountState;
  values: ValueCount[];
  /** The answer filled a whole page, so values beyond it may exist. */
  truncated: boolean;
  at: number;
}

export interface ValueCountContext {
  org: string;
  streamType: string;
  streamName: string;
  /** Look-back of the lookup; 24 hours unless set. */
  windowUs?: number;
}

/** When a stream last received data and how much, from the stats its list row already carries. */
export function streamFreshness(
  stats: DiscoveryStream["stats"] | undefined,
  nowUs: number,
): StreamFreshness {
  const last = Number(stats?.doc_time_max ?? 0);
  if (!last || nowUs - last > DAY_US) return { receiving: false };
  const first = Number(stats?.doc_time_min ?? 0) || last;
  const hours = Math.max(1, (last - first) / HOUR_US);
  const perHour = Number(stats?.doc_num ?? 0) / hours;
  return {
    receiving: true,
    agoSeconds: Math.max(0, (nowUs - last) / 1_000_000),
    perHour: perHour >= 1 ? perHour : undefined,
  };
}

export function freshnessText(freshness: StreamFreshness, t: TranslateFn): I18nText {
  if (!freshness.receiving) return t("alerts.discovery.noData24h");
  const ago = compactDuration(freshness.agoSeconds ?? 0, t);
  return freshness.perHour === undefined
    ? t("alerts.discovery.lastEventNoRate", { ago })
    : t("alerts.discovery.lastEvent", { ago, rate: compactNumber(Math.round(freshness.perHour)) });
}

/** "Counter · seconds · Seconds the CPUs spent in each mode", or nothing without real help text. */
export function metricDescription(
  meta: { type?: string; unit?: string; help?: string } | undefined,
  t: TranslateFn,
): I18nText | undefined {
  if (!meta?.help) return undefined;
  const kind = (meta.type ?? "").toLowerCase() as keyof typeof METRIC_TYPE_KEYS;
  const type = t(METRIC_TYPE_KEYS[kind] ?? "metrics.badge.other");
  const help = raw(meta.help);
  const unit = meta.unit && meta.unit !== "1" ? raw(meta.unit) : undefined;
  return unit
    ? t("alerts.discovery.metricRow", { type, unit, help })
    : t("alerts.discovery.metricRowNoUnit", { type, help });
}

export function recentStreams(org: string, streamType: string): string[] {
  try {
    if (streamType === "logs") return restoreLogsSelectedStreams(org, "logs");
    if (streamType === "traces") return [restoreTracesStream(org)];
    if (streamType === "metrics") return [restoreMetricsStream(org)];
  } catch {
    // Storage may be blocked; the list then simply has no Recent group.
  }
  return [];
}

/**
 * Picker rows for a stream list: Recent, Receiving data, then No recent data (greyed), each in the
 * incoming order; headings only when more than one group has rows.
 */
export function streamOptions(
  streams: DiscoveryStream[],
  options: { t: TranslateFn; nowUs: number; recent?: string[] },
): StreamOption[] {
  const { t, nowUs } = options;
  const { familyOfStream } = buildMetricFamilies(
    streams.filter((s) => s.stream_type === "metrics" || s.metrics_meta),
  );
  const rows = streams
    .filter((stream) => stream?.name)
    .map((stream): StreamOption => {
      const freshness = streamFreshness(stream.stats, nowUs);
      const family = familyOfStream.get(stream.name);
      const meta = family
        ? { type: family.familyType, unit: family.unit, help: family.help }
        : undefined;
      const description = freshness.receiving ? metricDescription(meta, t) : undefined;
      return {
        label: raw(stream.name),
        value: stream.name,
        subLabel: description ?? freshnessText(freshness, t),
        searchText: meta?.help ? meta.help.toLowerCase() : undefined,
        stale: !freshness.receiving,
      };
    });
  const recentNames = new Set((options.recent ?? []).filter(Boolean).slice(0, RECENT_MAX));
  const groups: [I18nText, StreamOption[]][] = [
    [t("alerts.discovery.groupRecent"), rows.filter((row) => recentNames.has(row.value))],
    [
      t("alerts.discovery.groupReceiving"),
      rows.filter((row) => !row.stale && !recentNames.has(row.value)),
    ],
    [
      t("alerts.discovery.groupNoRecent"),
      rows.filter((row) => row.stale && !recentNames.has(row.value)),
    ],
  ];
  const filled = groups.filter(([, items]) => items.length);
  if (filled.length < 2) return filled.flatMap(([, items]) => items);
  return filled.flatMap(([label, items]) => [
    { label, value: `\u0000group-${String(label)}`, header: true },
    ...items,
  ]) as StreamOption[];
}

// ── Value counts over the streaming values endpoint, cached per stream, field and window ──

const entries = reactive(new Map<string, ValueCountEntry>());
const inFlight = new Map<string, Promise<ValueCountEntry>>();
let streaming: ReturnType<typeof useHttpStreaming> | null = null;

const keyOf = (ctx: ValueCountContext, field: string, keyword = "") =>
  [
    ctx.org,
    ctx.streamType,
    ctx.streamName,
    ctx.windowUs ?? DAY_US,
    field,
    keyword.toLowerCase(),
  ].join("\u0000");

const fresh = (entry: ValueCountEntry | undefined) =>
  !!entry && entry.state !== "failed" && Date.now() - entry.at < CACHE_TTL_MS;

/** Clears every cached answer; for tests and an org switch. */
export function clearValueCounts(): void {
  entries.clear();
  inFlight.clear();
}

/** The cached answer for a field, if any; reactive, so a template re-renders when it lands. */
export function cachedValueCounts(
  ctx: ValueCountContext | null,
  field: string,
  keyword = "",
): ValueCountEntry | undefined {
  return ctx ? entries.get(keyOf(ctx, field, keyword)) : undefined;
}

/** A field's top values with their counts; one request per stream, field and keyword while cached. */
export function loadValueCounts(
  ctx: ValueCountContext,
  field: string,
  keyword = "",
): Promise<ValueCountEntry> {
  const key = keyOf(ctx, field, keyword);
  const known = entries.get(key);
  if (fresh(known) && known!.state === "ready") return Promise.resolve(known!);
  const running = inFlight.get(key);
  if (running) return running;

  const entry: ValueCountEntry = { state: "loading", values: [], truncated: false, at: Date.now() };
  entries.set(key, entry);
  const endTime = Date.now() * 1000;
  const queryReq = {
    fields: [field],
    size: VALUE_COUNT_SIZE,
    no_count: false,
    start_time: endTime - (ctx.windowUs ?? DAY_US),
    end_time: endTime,
    stream_name: ctx.streamName,
    stream_type: ctx.streamType,
    sql: b64EncodeUnicode(`SELECT * FROM "${ctx.streamName.replace(/"/g, '""')}"`),
    keyword: keyword || undefined,
    timeout: 30000,
    use_cache: true,
  };
  streaming ??= useHttpStreaming();
  let resolve: (entry: ValueCountEntry) => void = () => {};
  const request = new Promise<ValueCountEntry>((done) => (resolve = done));
  // Registered before the call starts: a stream that settles at once must not leave its promise behind.
  inFlight.set(key, request);
  const settle = (state: ValueCountState) => {
    const live = entries.get(key);
    if (live) {
      live.state = state;
      live.at = Date.now();
    }
    inFlight.delete(key);
    resolve(live ?? entry);
  };
  streaming!.fetchQueryDataWithHttpStream(
    {
      queryReq,
      type: "values",
      traceId: generateTraceContext().traceId,
      org_id: ctx.org,
      meta: queryReq,
    },
    {
      data: (_payload: unknown, response: any) => {
        if (response?.type !== "search_response_hits") return;
        const hits: any[] = response.content?.results?.hits ?? [];
        // Each chunk carries the whole ranking so far, so it replaces the last one.
        const values: ValueCount[] = hits
          .flatMap((hit) => hit?.values ?? [])
          .map((item: any) => ({
            value: String(item?.zo_sql_key ?? ""),
            count: Number(item?.zo_sql_num ?? 0),
          }));
        const live = entries.get(key);
        if (!live) return;
        live.values = values.sort((a, b) => b.count - a.count);
        live.truncated = values.length >= VALUE_COUNT_SIZE;
      },
      error: () => settle("failed"),
      complete: () => settle("ready"),
    },
  );
  return request;
}

const sharedPrefix = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

const matches = (seen: string, typed: string, operator: FilterOperatorId) => {
  if (operator === "contains") return seen.includes(typed);
  if (operator === "contains_ci") return seen.toLowerCase().includes(typed.toLowerCase());
  if (operator === "starts_with") return seen.startsWith(typed);
  if (operator === "ends_with") return seen.endsWith(typed);
  return seen === typed;
};

/** "Seen: OOMKilling (412), Killing (53,920)": the values closest to what was typed first, then the busiest. */
export function seenList(typed: string, values: ValueCount[], t: TranslateFn): I18nText {
  const ranked = [...values].sort(
    (a, b) => sharedPrefix(b.value, typed) - sharedPrefix(a.value, typed) || b.count - a.count,
  );
  return joinListMore(
    ranked.map((v) =>
      String(
        t("alerts.discovery.valueCount", { value: raw(v.value), count: formatNumber(v.count) }),
      ),
    ),
    t,
    SEEN_MAX,
  );
}

/**
 * The amber note for a chip whose value never appeared in the window, or nothing while unknown.
 * A truncated top list is only trusted after a keyword lookup for the value itself.
 */
export function valueNotSeenHint(
  ctx: ValueCountContext | null,
  field: string,
  typedValues: string[],
  operator: FilterOperatorId | undefined,
  t: TranslateFn,
): I18nText | undefined {
  if (!ctx || !operator || !(EXACT_OPS.has(operator) || TEXT_OPS.has(operator))) return undefined;
  const base = cachedValueCounts(ctx, field);
  if (base?.state !== "ready") return undefined;
  if (!base.values.length) return t("alerts.discovery.fieldEmpty");
  const unseen = typedValues.filter((typed) => {
    if (!typed || base.values.some((v) => matches(v.value, typed, operator))) return false;
    if (!base.truncated) return true;
    const probe = cachedValueCounts(ctx, field, typed);
    // Asked outside the caller's render; the reactive cache brings the answer back.
    if (!probe) queueMicrotask(() => void loadValueCounts(ctx, field, typed));
    return probe?.state === "ready" && !probe.values.some((v) => matches(v.value, typed, operator));
  });
  if (!unseen.length) return undefined;
  return t("alerts.guard.valueNotSeen", {
    value: joinList(unseen),
    seen: seenList(unseen[0], base.values, t),
  });
}

/**
 * Value counts for a filter builder: `loadValues`, `valueLabel` (count on each value row),
 * `valueHint` (value not seen in 24 h), `fieldDetail` and `valueEmptyText` (field empty in 24 h).
 */
export function useFilterDiscovery(context: () => ValueCountContext | null, t: TranslateFn) {
  const isEmpty = (field: string) => {
    const entry = cachedValueCounts(context(), field);
    return entry?.state === "ready" && !entry.values.length;
  };

  const loadValues = async (field: string, search: string): Promise<string[]> => {
    const ctx = context();
    if (!ctx || !field) return [];
    const base = await loadValueCounts(ctx, field);
    const needle = search.trim();
    if (!needle) return base.values.map((v) => v.value);
    if (!base.truncated) {
      const lower = needle.toLowerCase();
      return base.values.filter((v) => v.value.toLowerCase().includes(lower)).map((v) => v.value);
    }
    return (await loadValueCounts(ctx, field, needle)).values.map((v) => v.value);
  };

  const valueLabel = (field: string, value: string) => {
    const ctx = context();
    if (!ctx) return undefined;
    const hit = [...entries.entries()]
      .filter(([key]) => key.startsWith(keyOf(ctx, field, "")))
      .flatMap(([, entry]) => entry.values)
      .find((v) => v.value === value);
    return hit ? { label: value, detail: formatNumber(hit.count) } : undefined;
  };

  const valueHint = (field: string, values: string[], operator?: FilterOperatorId) =>
    valueNotSeenHint(context(), field, values, operator, t);

  const fieldDetail = (field: string) =>
    isEmpty(field) ? t("alerts.discovery.fieldEmpty") : undefined;

  return { loadValues, valueLabel, valueHint, fieldDetail, valueEmptyText: fieldDetail };
}

const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const escapeValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Adds a label to a PromQL query: with a value as a matcher on the metric's selector, without one
 * to the first `by (...)` list, else as `avg by (label) (query)`. An empty query starts from the metric.
 */
export function insertLabelIntoPromql(
  query: string,
  metric: string,
  label: string,
  value?: string,
): string {
  if (!LABEL_NAME.test(label)) return query;
  const text = query.trim();
  if (value !== undefined) {
    const matcher = `${label}="${escapeValue(value)}"`;
    if (!text) return `${metric}{${matcher}}`;
    const at = metric ? findMetric(text, metric) : -1;
    if (at < 0) return text;
    const end = at + metric.length;
    if (text[end] === "{") {
      const close = text.indexOf("}", end);
      if (close < 0) return text;
      const inner = text.slice(end + 1, close).trim();
      return `${text.slice(0, end + 1)}${inner ? `${inner}, ` : ""}${matcher}${text.slice(close)}`;
    }
    return `${text.slice(0, end)}{${matcher}}${text.slice(end)}`;
  }
  if (!text) return `avg by (${label}) (${metric})`;
  const by = /\bby\s*\(([^)]*)\)/.exec(text);
  if (by) {
    const names = by[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.includes(label)) return text;
    const list = [...names, label].join(", ");
    return `${text.slice(0, by.index)}by (${list})${text.slice(by.index + by[0].length)}`;
  }
  return `avg by (${label}) (${text})`;
}

// The metric's own name, not a longer one it prefixes (node_cpu inside node_cpu_seconds_total).
function findMetric(text: string, metric: string): number {
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(metric, from);
    if (at < 0) return -1;
    const before = text[at - 1] ?? "";
    const after = text[at + metric.length] ?? "";
    if (!/[\w:]/.test(before) && !/[\w:]/.test(after)) return at;
    from = at + 1;
  }
  return -1;
}
