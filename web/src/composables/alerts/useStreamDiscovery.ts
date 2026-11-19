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

import { computed, reactive, type ComputedRef } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { streamSchemaQuery } from "@/services/stream.queries";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { FilterCondition, FilterGroup, FilterOperatorId } from "@/utils/query/filterBar";
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
const VALUE_COUNT_TIMEOUT_MS = 30_000;
const RECENT_MAX = 3;
// Stream stats trail ingestion by up to an hour, so a newer last event is only "in the last hour".
const ACTIVE_US = HOUR_US;
const ACTIVITY_PROBES = 8;
const SEEN_MAX = 3;
// A lookup by a value's first letters also finds its look-alikes (OOMKilled → OOMKilling).
const PROBE_PREFIX = 4;
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
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number; created_at?: number };
}

export interface StreamFreshness {
  receiving: boolean;
  agoSeconds?: number;
  perHour?: number;
  /** A last event inside the stats' own lag, or one a probe found: said as "in the last hour". */
  activeNow?: boolean;
}

export interface ActivityContext {
  org: string;
  streamType: string;
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

/** A column the JSON flattener made from a number's internal wrapper, not a field anyone sent. */
export const isIngestArtifact = (name: string): boolean => name.includes("__serde_json__private__");

/** Whole days since the stream's first event, from its stats; undefined when they hold none. */
export function dataSpanDays(
  stats: DiscoveryStream["stats"] | undefined,
  nowUs: number,
): number | undefined {
  const first = Number(stats?.doc_time_min ?? 0);
  return first > 0 ? Math.max(0, Math.floor((nowUs - first) / DAY_US)) : undefined;
}

/** `dataSpanDays` of a stream, read from the cached schema the anomaly step reads too. */
export function useStreamDays(
  org: () => string,
  streamType: () => string,
  streamName: () => string,
): ComputedRef<number | undefined> {
  const schema = useQuery(() =>
    Object.assign(streamSchemaQuery(org(), streamName(), streamType()), {
      enabled: !!org() && !!streamType() && !!streamName(),
    }),
  );
  return computed(() => dataSpanDays(schema.data.value?.stats, Date.now() * 1000));
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
    activeNow: nowUs - last <= ACTIVE_US,
  };
}

export function freshnessText(freshness: StreamFreshness, t: TranslateFn): I18nText {
  if (!freshness.receiving) return t("alerts.discovery.noData24h");
  if (freshness.activeNow) {
    return freshness.perHour === undefined
      ? t("alerts.discovery.activeNoRate")
      : t("alerts.discovery.active", { rate: compactNumber(Math.round(freshness.perHour)) });
  }
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
 * Picker rows for a stream list: Recent, Receiving data, then No recent data (greyed), user streams
 * before system ones in each; headings only when more than one group has rows.
 */
export function streamOptions(
  streams: DiscoveryStream[],
  options: {
    t: TranslateFn;
    nowUs: number;
    recent?: string[];
    /** Whether a stream the stats call quiet had an event in the last hour; undefined while unknown. */
    activeNow?: (name: string) => boolean | undefined;
  },
): StreamOption[] {
  const { t, nowUs } = options;
  const { familyOfStream } = buildMetricFamilies(
    streams.filter((s) => s.stream_type === "metrics" || s.metrics_meta),
  );
  const isSystem = (s: DiscoveryStream) => s.is_internal === true || s.name.startsWith("_");
  const named = streams.filter((stream) => stream?.name);
  const live = probedLive(
    named.filter((s) => !isSystem(s)),
    nowUs,
    options.activeNow,
  );
  const rows = [...named.filter((s) => !isSystem(s)), ...named.filter(isSystem)].map(
    (stream): StreamOption => {
      const freshness = live.has(stream.name)
        ? { receiving: true, activeNow: true }
        : streamFreshness(stream.stats, nowUs);
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
    },
  );
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

// The newest user streams the stats do not place in the last hour, asked whether they are live after all.
function probedLive(
  streams: DiscoveryStream[],
  nowUs: number,
  activeNow: ((name: string) => boolean | undefined) | undefined,
): Set<string> {
  if (!activeNow) return new Set();
  const seenAt = (s: DiscoveryStream) =>
    Math.max(Number(s.stats?.doc_time_max ?? 0), Number(s.stats?.created_at ?? 0));
  return new Set(
    streams
      .filter((s) => !streamFreshness(s.stats, nowUs).activeNow)
      .sort((a, b) => seenAt(b) - seenAt(a))
      .slice(0, ACTIVITY_PROBES)
      .filter((s) => activeNow(s.name) === true)
      .map((s) => s.name),
  );
}

// ── Whether a stream had any event in the last hour, from one count per stream while cached ──

const activity = reactive(
  new Map<string, { state: ValueCountState; active: boolean; at: number }>(),
);

/** True or false once a last-hour count for the stream is in; undefined while it runs or is asked. */
export function recentActivity(ctx: ActivityContext, name: string): boolean | undefined {
  const key = [ctx.org, ctx.streamType, name].join("\u0000");
  const known = activity.get(key);
  if (known && (known.state === "loading" || Date.now() - known.at < CACHE_TTL_MS)) {
    return known.state === "ready" ? known.active : undefined;
  }
  activity.set(key, { state: "loading", active: false, at: Date.now() });
  // The reactive copy, so a template reading the answer re-renders when it lands.
  const entry = activity.get(key)!;
  queueMicrotask(() => {
    const endTime = Date.now() * 1000;
    streaming ??= useHttpStreaming();
    streaming.fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`),
            start_time: endTime - HOUR_US,
            end_time: endTime,
            from: 0,
            size: 1,
          },
          encoding: "base64",
        },
        type: "search",
        traceId: generateTraceContext().traceId,
        org_id: ctx.org,
        pageType: ctx.streamType,
        searchType: "ui",
      },
      {
        data: (_payload: unknown, response: any) => {
          if (response?.type !== "search_response_hits") return;
          const hits: any[] = response.content?.results?.hits ?? [];
          if (hits.some((hit) => Number(hit?.n ?? 0) > 0)) entry.active = true;
        },
        error: () => Object.assign(entry, { state: "failed", at: Date.now() }),
        complete: () => Object.assign(entry, { state: "ready", at: Date.now() }),
        reset: () => {},
      },
    );
  });
  return undefined;
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
  activity.clear();
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
  // A stream that never ends must not leave the list loading; the next ask tries again.
  const ceiling = setTimeout(() => settle("failed"), VALUE_COUNT_TIMEOUT_MS);
  const settle = (state: ValueCountState) => {
    clearTimeout(ceiling);
    if (inFlight.get(key) !== request) return;
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

// Longest shared run of letters, ignoring case; a run that starts the seen value counts a little more.
const likeness = (seen: string, typed: string) => {
  const a = seen.toLowerCase().slice(0, 64);
  const b = typed.toLowerCase().slice(0, 64);
  let best = 0;
  let bestAtStart = false;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      row[j] = previous[j - 1] + 1;
      const atStart = i - row[j] === 0;
      if (row[j] > best || (row[j] === best && atStart)) [best, bestAtStart] = [row[j], atStart];
    }
    previous = row;
  }
  return best + (bestAtStart ? 0.5 : 0);
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
  const best = new Map<string, number>();
  for (const v of values) if (v.value) best.set(v.value, Math.max(best.get(v.value) ?? 0, v.count));
  const ranked = [...best].sort(
    ([a, x], [b, y]) => likeness(b, typed) - likeness(a, typed) || y - x,
  );
  return joinListMore(
    ranked.map(([value, count]) =>
      String(t("alerts.discovery.valueCount", { value: raw(value), count: formatNumber(count) })),
    ),
    t,
    SEEN_MAX,
  );
}

// Asked outside the caller's render; the reactive cache brings the answer back.
const probe = (ctx: ValueCountContext, field: string, keyword: string) => {
  const entry = cachedValueCounts(ctx, field, keyword);
  if (!entry) queueMicrotask(() => void loadValueCounts(ctx, field, keyword));
  return entry?.state === "ready" ? entry : undefined;
};

/**
 * Whether a value appeared, from the top list, else a lookup by its first letters (which also finds
 * look-alikes), else by the whole value; undefined while a lookup runs.
 */
function lookupSeen(
  ctx: ValueCountContext,
  field: string,
  base: ValueCountEntry,
  typed: string,
  operator: FilterOperatorId,
): { seen: boolean | undefined; nearby: ValueCount[] } {
  const hit = (entry: ValueCountEntry) =>
    entry.values.some((v) => matches(v.value, typed, operator));
  if (hit(base)) return { seen: true, nearby: [] };
  if (!base.truncated) return { seen: false, nearby: [] };
  const prefix = probe(ctx, field, typed.slice(0, PROBE_PREFIX));
  if (!prefix) return { seen: undefined, nearby: [] };
  if (hit(prefix)) return { seen: true, nearby: [] };
  if (!prefix.truncated || typed.length <= PROBE_PREFIX)
    return { seen: false, nearby: prefix.values };
  const whole = probe(ctx, field, typed);
  return { seen: whole ? hit(whole) : undefined, nearby: prefix.values };
}

/**
 * The amber note for a chip whose value never appeared in the window, or nothing while unknown.
 * A truncated top list is only trusted after a lookup for the value itself.
 */
export function valueNotSeenHint(
  ctx: ValueCountContext | null,
  field: string,
  typedValues: string[],
  operator: FilterOperatorId | undefined,
  t: TranslateFn,
): I18nText | undefined {
  if (!ctx || !operator || !(EXACT_OPS.has(operator) || TEXT_OPS.has(operator))) return undefined;
  const found = unseenValues(ctx, field, typedValues, operator);
  if (found === "empty") return t("alerts.discovery.fieldEmpty");
  if (!found?.unseen.length) return undefined;
  return t("alerts.guard.valueNotSeen", {
    value: joinList(found.unseen),
    seen: seenList(found.unseen[0], found.seen, t),
  });
}

/** The typed values missing from the window with what did appear (`pending` while a value's lookup
 * runs), "empty" for a field with no values, undefined until the field's counts are in. */
function unseenValues(
  ctx: ValueCountContext,
  field: string,
  typedValues: string[],
  operator: FilterOperatorId,
): { unseen: string[]; seen: ValueCount[]; pending: boolean } | "empty" | undefined {
  const base = cachedValueCounts(ctx, field);
  if (base?.state !== "ready") return undefined;
  if (!base.values.length) return "empty";
  const unseen: string[] = [];
  const nearby: ValueCount[] = [];
  let pending = false;
  for (const typed of typedValues.filter(Boolean)) {
    const found = lookupSeen(ctx, field, base, typed, operator);
    pending ||= found.seen === undefined;
    if (found.seen !== false) continue;
    unseen.push(typed);
    nearby.push(...found.nearby);
  }
  return { unseen, seen: [...nearby, ...base.values], pending };
}

const andLeaves = (group: FilterGroup): FilterCondition[] | null => {
  if (group.negate || group.items.slice(1).some((item) => item.connector !== "AND")) return null;
  const leaves: FilterCondition[] = [];
  for (const item of group.items) {
    const inner = item.kind === "group" ? andLeaves(item) : item.kind === "condition" ? [item] : [];
    if (!inner) return null;
    leaves.push(...inner);
  }
  return leaves;
};

/**
 * Why a builder filter drew nothing over the window `ctx` names: the first exact condition whose values
 * did not appear in it, said as the PromQL preview says it. Undefined when no one condition explains it.
 */
export function filterNotSeenText(
  ctx: ValueCountContext,
  tree: FilterGroup,
  window: I18nText,
  t: TranslateFn,
): I18nText | undefined {
  const day = (ctx.windowUs ?? DAY_US) === DAY_US;
  const leaves = (andLeaves(tree) ?? []).filter(
    (leaf) => EXACT_OPS.has(leaf.operator) && leaf.values.length,
  );
  leaves.forEach((leaf) => probe(ctx, leaf.field, ""));
  for (const leaf of leaves) {
    const found = unseenValues(ctx, leaf.field, leaf.values, leaf.operator);
    if (found === undefined || (found !== "empty" && found.pending)) return undefined;
    if (found === "empty")
      return t("alerts.guard.fieldEmptyIn", { field: raw(leaf.field), window });
    if (!found.unseen.length) continue;
    const params = {
      value: joinList(found.unseen.map((v) => `${leaf.field}="${v}"`)),
      seen: seenList(found.unseen[0], found.seen, t),
    };
    return day
      ? t("alerts.guard.valueNotSeen", params)
      : t("alerts.guard.valueNotSeenIn", { ...params, window });
  }
  return undefined;
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
