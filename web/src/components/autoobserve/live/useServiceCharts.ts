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

import { scopeFieldsOf } from "@/utils/alerts/prefill/fromAutoObserve";
import {
  computed,
  onBeforeUnmount,
  reactive,
  readonly,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import useHttpStreaming from "@/composables/useStreamingSearch";
import useStreams from "@/composables/useStreams";
import serviceStreamsApi, {
  type CorrelationResponse,
  type StreamInfo,
} from "@/services/service_streams";
import { featureState } from "@/utils/featureGate";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { STEPS, type ChartRange, type MetricSeries, type MetricUnit } from "../coverageSeries";
import type { CoverageRow, LiveIdentity } from "../fixtures";
import { chartText, statusOf, type ChartReasonKind } from "./liveCopy";
import {
  chartWindow,
  emptySeries,
  LIVE_SIGNALS,
  logsSql,
  noFacts,
  pickErrorField,
  toSeries,
  tracesSql,
  unitOf,
  valueOf,
  type BucketHit,
  type ChartSource,
  type ErrorRule,
  type LiveChartSignal,
  type ServiceChartFacts,
} from "./serviceChartSql";

export type ServiceChartStatus =
  "loading" | "ready" | "empty" | "noField" | "noMatch" | "failed" | "denied";

export interface ServiceChart {
  status: ServiceChartStatus;
  unit: MetricUnit;
  series: MetricSeries;
  facts: ServiceChartFacts;
  reason: I18nText | null;
  detail: I18nText | null;
  partial: boolean;
  wide: boolean;
  retry: () => void;
}

interface ChartState extends Omit<ServiceChart, "reason" | "detail"> {
  reason: ChartReasonKind | null;
  message: string | null;
  stream: string;
}

interface Source {
  kind: ChartSource;
  name: string;
  filters: Record<string, string | null>;
  wide: boolean;
  fields: Map<string, string>;
}

type Sources = Partial<Record<ChartSource, Source>>;

interface StreamEvent {
  type?: string;
  content?: {
    results?: { hits?: BucketHit[]; is_partial?: boolean };
    streaming_aggs?: boolean;
  };
}

interface StreamError {
  content?: { status?: number; message?: string; error?: string };
}

// A schema read needs the stream's own permission, so its failure must not read as a correlation failure.
class SchemaError extends Error {
  constructor(
    readonly stream: string,
    readonly error: unknown,
  ) {
    super((error as Error | null)?.message ?? "");
  }
}

interface Query {
  source: Source;
  sql: string;
  range: ChartRange;
  now: number;
  serves: { signal: LiveChartSignal; missing: 0 | null }[];
}

// Discovery changes a service's streams rarely, so one _correlate answer serves every drawer open for a while.
const CORRELATION_TTL_MS = 5 * 60_000;
const correlations = new Map<string, { at: number; answer: Promise<CorrelationResponse | null> }>();

export const resetCorrelationCache = () => correlations.clear();

// Default semantic group ids; _correlate maps them to each org's own field names.
const dimensionsOf = (id: LiveIdentity): Record<string, string> =>
  Object.fromEntries(
    Object.entries({
      service: id.serviceName,
      "k8s-cluster": id.cluster,
      "k8s-namespace": id.namespace,
    }).filter((entry): entry is [string, string] => !!entry[1]),
  );

const correlateOnce = (org: string, id: LiveIdentity) => {
  const key = `${org}:${id.serviceId}`;
  const cached = correlations.get(key);
  if (cached && Date.now() - cached.at < CORRELATION_TTL_MS) return cached.answer;
  const [source] = id.streams;
  const answer = serviceStreamsApi
    .correlate(org, {
      source_stream: source.name,
      source_type: source.type,
      available_dimensions: dimensionsOf(id),
    })
    .then((res) => res.data ?? null);
  correlations.set(key, { at: Date.now(), answer });
  answer.catch(() => correlations.delete(key));
  return answer;
};

// A stream without filters can't be scoped to the service, so it is never queried.
const firstScoped = (streams: StreamInfo[] | undefined) =>
  streams?.find((s) => Object.keys(s.filters ?? {}).length > 0);

const blank = (signal: LiveChartSignal): ChartState => ({
  status: "loading",
  unit: unitOf(signal, "traces"),
  series: emptySeries(),
  facts: noFacts(),
  reason: null,
  message: null,
  stream: "",
  partial: false,
  wide: false,
  retry: () => undefined,
});

export const useServiceCharts = (row: Ref<CoverageRow | null>, range: Ref<ChartRange>) => {
  const { t } = useI18nTyped();
  const store = useStore();
  const { getStream } = useStreams(t);
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

  const states = reactive(
    Object.fromEntries(LIVE_SIGNALS.map((s) => [s, blank(s)])) as Record<
      LiveChartSignal,
      ChartState
    >,
  );
  const nowMs = ref(Date.now());
  const running = new Map<ChartSource, string>();
  let generation = 0;
  let resolved: { key: string; sources: Sources } | null = null;

  const org = (): string => store.state.selectedOrganization?.identifier ?? "";

  const set = (signal: LiveChartSignal, patch: Partial<ChartState>) =>
    Object.assign(states[signal], patch);

  const setAll = (patch: Partial<ChartState>) => LIVE_SIGNALS.forEach((s) => set(s, patch));

  const noMatch = () =>
    setAll({ status: "noMatch", reason: "noMatch", series: emptySeries(), facts: noFacts() });

  const cancelAll = () => {
    for (const traceId of running.values())
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: org() });
    running.clear();
  };

  const schemaOf = async (
    kind: ChartSource,
    info: StreamInfo | undefined,
    id: LiveIdentity,
  ): Promise<Source | undefined> => {
    if (!info) return undefined;
    const stream = await getStream(info.stream_name, kind, true).catch((err: unknown) => {
      throw new SchemaError(info.stream_name, err);
    });
    const schema: { name: string; type: string }[] = stream?.schema ?? [];
    const filters: Record<string, string | null> = { ...(info.filters ?? {}) };
    // Without this the "no namespace" entity would chart every namespace's rows under its name.
    const nsField = id.namespace
      ? null
      : scopeFieldsOf(kind).namespace.find((f) => schema.some((s) => s.name === f));
    if (nsField && !(nsField in filters)) filters[nsField] = null;
    return {
      kind,
      name: info.stream_name,
      filters,
      wide: !!info.dropped_dimensions?.length,
      fields: new Map(schema.map((f) => [f.name, f.type])),
    };
  };

  const resolveSources = async (id: LiveIdentity): Promise<Sources> => {
    const answer = await correlateOnce(org(), id);
    if (!answer || answer.service_name !== id.serviceName) return {};
    const [traces, logs] = await Promise.all([
      schemaOf("traces", firstScoped(answer.related_streams?.traces), id),
      schemaOf("logs", firstScoped(answer.related_streams?.logs), id),
    ]);
    return { traces, logs };
  };

  const noField = (
    signal: LiveChartSignal,
    reason: ChartReasonKind,
    stream: string,
    field: string | null,
  ) =>
    set(signal, {
      status: "noField",
      reason,
      stream,
      series: emptySeries(),
      facts: noFacts(field),
    });

  const draw = (q: Query, hits: BucketHit[], partial: boolean, done: boolean) => {
    for (const { signal, missing } of q.serves) {
      const pick = valueOf(signal, q.source.kind, q.range);
      const { series, facts, hasData } = toSeries(hits, q.range, q.now, pick, missing);
      if (hasData)
        set(signal, { status: "ready", series, facts, reason: null, partial, wide: q.source.wide });
      else if (done)
        set(signal, {
          status: "empty",
          series: emptySeries(),
          facts: noFacts(),
          reason: "empty",
          partial,
        });
    }
  };

  const failQuery = (q: Query, err: StreamError | undefined) => {
    const denied = err?.content?.status === 403;
    const message = err?.content?.message || err?.content?.error || null;
    for (const { signal } of q.serves)
      set(signal, {
        status: denied ? "denied" : "failed",
        reason: denied ? "deniedQuery" : "failedQuery",
        message: denied ? null : message,
        series: emptySeries(),
        facts: noFacts(),
        partial: false,
        retry: denied ? () => undefined : () => runQuery(q),
      });
  };

  const runQuery = (q: Query) => {
    const { traceId } = generateTraceContext();
    const kind = q.source.kind;
    const win = chartWindow(q.range, q.now);
    running.set(kind, traceId);
    for (const { signal } of q.serves)
      set(signal, { ...blank(signal), unit: unitOf(signal, kind), stream: q.source.name });
    const hits = new Map<string, BucketHit>();
    let partial = false;
    const current = () => running.get(kind) === traceId;
    void fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(q.sql),
            start_time: win.start * 1000,
            end_time: win.end * 1000,
            from: 0,
            size: STEPS[q.range].count * 2,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: org(),
        pageType: kind,
        searchType: "ui",
      },
      {
        data: (_payload: unknown, res: StreamEvent) => {
          if (!current()) return;
          const results = res?.content?.results;
          if (results?.is_partial) partial = true;
          if (res?.type !== "search_response_hits") return;
          if (res?.content?.streaming_aggs) hits.clear();
          for (const hit of results?.hits ?? []) hits.set(String(hit.t), hit);
          // A long range keeps streaming for tens of seconds, so each chunk is drawn as it lands.
          draw(q, [...hits.values()], true, false);
        },
        error: (_payload: unknown, err?: StreamError) => {
          if (!current()) return;
          running.delete(kind);
          failQuery(q, err);
        },
        complete: () => {
          if (!current()) return;
          running.delete(kind);
          draw(q, [...hits.values()], partial, true);
        },
      },
    );
  };

  const plan = (sources: Sources, now: number): Query[] => {
    const { traces, logs } = sources;
    const toTraces: Query["serves"] = [];
    const toLogs: Query["serves"] = [];
    let rule: ErrorRule | null = null;
    (logs ? toLogs : toTraces).push({ signal: "requests", missing: 0 });
    if (traces) {
      if (traces.fields.has("span_status")) toTraces.push({ signal: "errors", missing: 0 });
      else noField("errors", "noSpanStatus", traces.name, "span_status");
      if (traces.fields.has("duration")) toTraces.push({ signal: "latency", missing: null });
      else noField("latency", "noDuration", traces.name, "duration");
    } else if (logs) {
      rule = pickErrorField(logs.fields);
      if (rule) toLogs.push({ signal: "errors", missing: 0 });
      else noField("errors", "noLevel", logs.name, "level");
      noField("latency", "noTraces", logs.name, null);
    }
    const has = (serves: Query["serves"], signal: LiveChartSignal) =>
      serves.some((s) => s.signal === signal);
    const queries: Query[] = [];
    if (traces && toTraces.length) {
      const want = { errors: has(toTraces, "errors"), latency: has(toTraces, "latency") };
      const sql = tracesSql(traces.name, traces.filters, range.value, want);
      queries.push({ source: traces, sql, range: range.value, now, serves: toTraces });
    }
    if (logs && toLogs.length) {
      const sql = logsSql(logs.name, logs.filters, range.value, rule);
      queries.push({ source: logs, sql, range: range.value, now, serves: toLogs });
    }
    return queries;
  };

  const failSchema = ({ stream, error, message }: SchemaError) => {
    if (statusOf(error) === 403)
      return setAll({ status: "denied", reason: "deniedQuery", stream, message: null });
    setAll({
      status: "failed",
      reason: "failedQuery",
      stream,
      message: message || null,
      retry: () => void load(),
    });
  };

  const failMatch = (err: unknown) => {
    if (err instanceof SchemaError) return failSchema(err);
    if (statusOf(err) === 403)
      return setAll({ status: "denied", reason: "deniedMatch", message: null });
    const data = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
    const message = typeof data?.message === "string" ? data.message : null;
    setAll({ status: "failed", reason: "failedMatch", message, retry: () => void load() });
  };

  // The equality filters each source's charts read, for the pages the drawer opens.
  const scopes = shallowRef<Partial<Record<ChartSource, Record<string, string>>>>({});

  const load = async () => {
    const gen = ++generation;
    scopes.value = {};
    cancelAll();
    nowMs.value = Date.now();
    LIVE_SIGNALS.forEach((s) => set(s, blank(s)));
    const id = row.value?.identity;
    if (!row.value) return;
    const locked = featureState(store.state.zoConfig?.features, "correlation") === "locked";
    if (!id?.streams.length || locked) return noMatch();
    let sources = resolved?.key === id.serviceId ? resolved.sources : null;
    if (!sources) {
      try {
        sources = await resolveSources(id);
      } catch (err) {
        if (gen === generation) failMatch(err);
        return;
      }
      if (gen !== generation) return;
      resolved = { key: id.serviceId, sources };
    }
    scopes.value = Object.fromEntries(
      Object.entries(sources).flatMap(([kind, src]) =>
        src
          ? [
              [
                kind,
                Object.fromEntries(
                  Object.entries(src.filters).filter((e): e is [string, string] => e[1] !== null),
                ),
              ],
            ]
          : [],
      ),
    );
    if (!sources.traces && !sources.logs) return noMatch();
    plan(sources, nowMs.value).forEach(runQuery);
  };

  watch(
    [() => row.value?.identity?.serviceId ?? row.value?.service ?? null, range],
    () => void load(),
    { immediate: true },
  );

  onBeforeUnmount(() => {
    generation += 1;
    cancelAll();
  });

  const charts = computed(
    () =>
      Object.fromEntries(
        LIVE_SIGNALS.map((signal) => {
          const { reason, message, stream, ...chart } = states[signal];
          const text = reason
            ? chartText(t, reason, {
                service: row.value?.service ?? "",
                stream,
                range: range.value,
                partial: chart.partial,
                message,
              })
            : null;
          return [signal, { ...chart, reason: text?.reason ?? null, detail: text?.detail ?? null }];
        }),
      ) as Record<LiveChartSignal, ServiceChart>,
  );

  const span = computed(() => {
    const { start, last } = chartWindow(range.value, nowMs.value);
    return { start, end: last };
  });

  return { charts, span, scopes: readonly(scopes) };
};
