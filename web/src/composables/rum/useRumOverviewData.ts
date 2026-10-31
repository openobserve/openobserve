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

import { computed, reactive, ref, type Ref } from "vue";
import useAnalyticsSearch, { type PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { RumTabDateTime } from "@/composables/rum/useRumPerformanceTab";
import {
  bucketInterval,
  chartSql,
  dropOpenBucket,
  fillBuckets,
  intervalFromKey,
  intervalMicros,
  filterOptionsSql,
  isLowData,
  kpiSql,
  mapPages,
  mapSegments,
  mapVitals,
  pagesSql,
  previousWindow,
  releaseNewErrorsSql,
  releaseRowsFromKpi,
  releaseSessionsSql,
  releaseVitalsSql,
  segmentColumns,
  segmentDims,
  segmentsSql,
  seriesSql,
  splitSegments,
  toNum,
  vitalsSql,
  windowRow,
  biggestDifference,
  versionPredatesRange,
  type OverviewFilters,
  type QueryCtx,
  type SegmentDim,
  type SegmentRow,
} from "@/utils/rum/performanceOverview";

type Row = Record<string, unknown>;
export type WidgetStatus = "loading" | "error" | "forbidden" | "empty" | "low" | "ok" | "hidden";
export type WidgetGroup =
  "verdict" | "kpis" | "chart" | "pages" | "segments" | "release" | "frustration";

const ID = {
  vitals: "ov-vitals",
  kpi: "ov-kpi",
  series: "ov-series",
  pages: "ov-pages",
  segments: "ov-segments",
  relSessions: "ov-rel-sessions",
  relVitals: "ov-rel-vitals",
  relNew: "ov-rel-new",
  options: "ov-options",
};

const toMicros = (v: Date | number | null | undefined): number =>
  v instanceof Date ? v.getTime() * 1000 : typeof v === "number" ? v * 1000 : 0;

const bucketLabel = (us: number): string => new Date(us / 1000).toISOString().slice(0, 19);

// histogram() buckets arrive as UTC strings without a zone suffix.
const bucketMicros = (v: unknown): number => {
  if (typeof v === "number") return v;
  const raw = String(v ?? "");
  const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? 0 : ms * 1000;
};

const EMPTY: PanelState<Row> = {
  status: "idle",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
};

const emptyFilters = (): OverviewFilters => ({ service: [], env: [], version: [] });

export default function useRumOverviewData(
  dateTime: Ref<RumTabDateTime | undefined>,
  schema: Ref<Set<string> | null>,
) {
  const search = useAnalyticsSearch();
  const filters = ref<OverviewFilters>(emptyFilters());
  const range = ref<{ startUs: number; endUs: number } | null>(null);

  const rows = (id: string): PanelState<Row> => search.panel<Row>(id).value ?? EMPTY;
  // Panels that have shown an answer keep it on screen while a reload is in flight.
  const answered = reactive(new Set<string>());
  const pending = (id: string) => ["idle", "loading", "aborted"].includes(rows(id).status);
  const statusOf = (ids: string[]): "loading" | "error" | "forbidden" | "ok" => {
    const s = ids.map((id) => rows(id).status);
    if (s.includes("error")) return "error";
    if (s.includes("forbidden")) return "forbidden";
    if (ids.some(pending)) return ids.every((id) => answered.has(id)) ? "ok" : "loading";
    return "ok";
  };
  // A window with no rows aggregates to zeros, as a query without GROUP BY would return.
  const windowOf = (id: string, w: 0 | 1): Row | undefined => {
    const p = rows(id);
    if (!p.rows.length) return p.status === "ok" ? {} : undefined;
    return windowRow(p.rows, w) ?? {};
  };

  const ctx = (): QueryCtx => ({ schema: schema.value ?? new Set(), filters: filters.value });

  // A version filter must not narrow the release pick, so release sessions then need their own query.
  const releaseViaKpi = () => !filters.value.version.length;
  const releaseSource = () => (releaseViaKpi() ? ID.kpi : ID.relSessions);
  const releaseRows = (): Row[] =>
    releaseViaKpi() ? releaseRowsFromKpi(rows(ID.kpi).rows) : rows(ID.relSessions).rows;

  const track = (id: string, p: PanelState<Row>) => {
    if (p.status === "ok") answered.add(id);
    else if (p.status === "error" || p.status === "forbidden") answered.delete(id);
  };
  const runOnce = (
    id: string,
    sql: string,
    w: { startUs: number; endUs: number },
    limit: number,
    useCache?: boolean,
  ) => search.run<Row>(id, { sql, ...w, limit, sampled: 1, useCache }, `${id}:${sql}`);
  const exec = (
    id: string,
    sql: string | null,
    w: { startUs: number; endUs: number },
    limit = 20,
  ) => {
    if (!sql) {
      answered.delete(id);
      search.hold(id, "idle");
      return Promise.resolve();
    }
    return runOnce(id, sql, w, limit).then((p) => track(id, p));
  };

  const bothWindows = (w: { startUs: number; endUs: number }) => ({
    startUs: previousWindow(w.startUs, w.endUs).startUs,
    endUs: w.endUs,
  });

  let runSeq = 0;
  const pagesDue = ref(false);
  const pagesSeen = ref(false);

  const loadVerdict = () => {
    const w = range.value;
    if (!w) return Promise.resolve();
    return exec(ID.vitals, vitalsSql(ctx(), w.startUs), bothWindows(w), 2);
  };

  let releaseRun = 0;
  const loadReleaseDetails = async () => {
    const w = range.value;
    if (!w) return;
    const [cur, prev] = releaseRows().map((r) => String(r.version));
    await Promise.all([
      exec(ID.relVitals, releaseVitalsSql(ctx(), [cur, prev].filter(Boolean)), w, 2),
      exec(ID.relNew, cur && prev ? releaseNewErrorsSql(ctx(), cur, prev) : null, w, 1),
    ]);
  };
  const loadReleaseSessions = async () => {
    const w = range.value;
    if (!w) return;
    const run = ++releaseRun;
    await exec(ID.relSessions, releaseSessionsSql(ctx()), w, 2);
    if (run === releaseRun) await loadReleaseDetails();
  };

  // Release details chain off the KPI scan but must not hold back the second wave.
  const loadKpi = () => {
    const w = range.value;
    if (!w) return Promise.resolve();
    const withRelease = releaseViaKpi() && !!schema.value?.has("version");
    return exec(ID.kpi, kpiSql(ctx(), w.startUs, withRelease), bothWindows(w), 1000).then(() => {
      if (withRelease && rows(ID.kpi).status === "ok") void loadReleaseDetails();
    });
  };
  const loadSeries = () => {
    const w = range.value;
    if (!w) return Promise.resolve();
    const sql = seriesSql(ctx(), bucketInterval(w.startUs, w.endUs));
    // The server's histogram result cache has returned missing buckets and 400s for reused ranges, so the chart reads fresh.
    return runOnce(ID.series, sql, w, 500, false).then((p) => track(ID.series, p));
  };
  const loadKpis = () => Promise.all([loadKpi(), loadSeries()]);
  const loadPages = () =>
    range.value ? exec(ID.pages, pagesSql(ctx()), range.value, 200) : Promise.resolve();
  const loadSegments = () =>
    range.value ? exec(ID.segments, segmentsSql(ctx()), range.value, 1000) : Promise.resolve();
  const loadRelease = () => {
    if (!releaseViaKpi()) return loadReleaseSessions();
    return rows(ID.kpi).status === "ok" ? loadReleaseDetails() : loadKpi();
  };

  // Pages is the costliest scan, so it waits for its panel to be on screen as well as for wave two.
  const maybeLoadPages = () => {
    if (!pagesDue.value || !pagesSeen.value) return;
    pagesDue.value = false;
    void loadPages();
  };
  const markPagesVisible = () => {
    pagesSeen.value = true;
    maybeLoadPages();
  };

  const loaders: Record<WidgetGroup, () => Promise<unknown>> = {
    verdict: loadVerdict,
    kpis: loadKpis,
    chart: loadSeries,
    pages: loadPages,
    segments: loadSegments,
    release: loadRelease,
    frustration: loadKpi,
  };

  // The server runs one query per core, so the verdict and KPI scans go alone before the rest.
  const loadAll = async () => {
    const startUs = toMicros(dateTime.value?.start_time);
    const endUs = toMicros(dateTime.value?.end_time);
    if (!startUs || !endUs || !schema.value) return;
    range.value = { startUs, endUs };
    const run = ++runSeq;
    pagesDue.value = false;
    releaseRun++;
    for (const id of [ID.pages, ID.segments, ID.relSessions, ID.relVitals, ID.relNew]) {
      search.hold(id, "loading", true);
    }
    await Promise.all([loadVerdict(), loadKpis()]);
    if (run !== runSeq) return;
    pagesDue.value = true;
    maybeLoadPages();
    await Promise.all([
      loadSegments(),
      releaseViaKpi() ? Promise.resolve() : loadReleaseSessions(),
      exec(ID.options, filterOptionsSql(schema.value), range.value, 500),
    ]);
  };

  const abortAll = () => {
    runSeq++;
    releaseRun++;
    pagesDue.value = false;
    search.abortAll();
  };

  const retry = (group: WidgetGroup) => loaders[group]();

  const vitals = computed(() => mapVitals(windowOf(ID.vitals, 1)));
  const vitalsPrev = computed(() => mapVitals(windowOf(ID.vitals, 0)));

  const verdictStatus = computed<WidgetStatus>(() => {
    const s = statusOf([ID.vitals]);
    if (s !== "ok") return s;
    const v = vitals.value;
    if (!v || v.views === 0) return "empty";
    return isLowData(v.views) ? "low" : "ok";
  });

  const totals = computed(() => {
    const cur = windowOf(ID.kpi, 1);
    const prev = windowOf(ID.kpi, 0);
    const shape = (r?: Row) =>
      r
        ? {
            sessions: toNum(r.sessions),
            errorFree: toNum(r.sessions)
              ? ((toNum(r.sessions) - toNum(r.err_sessions)) / toNum(r.sessions)) * 100
              : null,
            errors: toNum(r.errors),
            unhandled: toNum(r.unhandled),
          }
        : null;
    return { cur: shape(cur), prev: shape(prev) };
  });

  const series = computed(() => {
    const pts = rows(ID.series).rows.map((r) => ({
      ts: bucketMicros(r.bucket),
      sessions: toNum(r.sessions),
      errSessions: toNum(r.err_sessions),
      errors: toNum(r.errors),
      unhandled: toNum(r.unhandled),
    }));
    const interval = intervalFromKey(rows(ID.series).key);
    const step = interval ? intervalMicros(interval) : 0;
    const filled = fillBuckets(pts, step, (ts) => ({
      ts,
      sessions: 0,
      errSessions: 0,
      errors: 0,
      unhandled: 0,
    }));
    return dropOpenBucket(filled, step, Date.now() * 1000);
  });

  // The chart draws the same zero-filled points as the table and sparklines, under its own axis aliases.
  const chartHits = computed(() =>
    series.value.map((p) => ({
      x_axis_1: bucketLabel(p.ts),
      y_axis_1: p.sessions,
      y_axis_2: p.errors,
    })),
  );

  const chartStatus = computed<WidgetStatus>(() => {
    const s = statusOf([ID.series]);
    if (s !== "ok") return s;
    return chartHits.value.length ? "ok" : "empty";
  });

  const kpiStatus = computed<WidgetStatus>(() => {
    const s = statusOf([ID.kpi, ID.series]);
    if (s !== "ok") return s;
    return (totals.value.cur?.sessions ?? 0) === 0 ? "empty" : "ok";
  });

  const chartInterval = computed(() =>
    range.value ? bucketInterval(range.value.startUs, range.value.endUs) : null,
  );
  const chartQuery = computed(() =>
    chartInterval.value ? chartSql(ctx(), chartInterval.value) : null,
  );

  const pages = computed(() => mapPages(rows(ID.pages).rows));
  const pagesStatus = computed<WidgetStatus>(() => {
    const s = statusOf([ID.pages]);
    if (s !== "ok") return s;
    return pages.value.length ? "ok" : "empty";
  });

  const segments = computed(() => {
    const c = ctx();
    const byDim = splitSegments(c, rows(ID.segments).rows);
    const out: Partial<Record<SegmentDim, SegmentRow[]>> = {};
    for (const d of segmentDims(c)) {
      out[d] = mapSegments(d, segmentColumns(c, d), byDim[d] ?? [], vitals.value?.views);
    }
    return out;
  });
  const segmentsStatus = computed<WidgetStatus>(() => {
    const dims = segmentDims(ctx());
    if (!dims.length) return "hidden";
    const s = statusOf([ID.segments]);
    if (s !== "ok") return s;
    return dims.some((d) => (segments.value[d] ?? []).length) ? "ok" : "empty";
  });
  const difference = computed(() => biggestDifference(segments.value));

  const bucketSpan = computed(() => {
    const pts = series.value;
    return pts.length > 1 ? pts[1].ts - pts[0].ts : 0;
  });

  const release = computed(() => {
    const [cur, prev] = releaseRows();
    if (!cur || !prev || !range.value) return null;
    const vit = new Map(rows(ID.relVitals).rows.map((r) => [String(r.ver), r]));
    const shape = (r: Row) => ({
      version: String(r.version),
      firstSeen: toNum(r.first_seen),
      predates: versionPredatesRange(
        toNum(r.first_seen),
        range.value!.startUs,
        range.value!.endUs,
        series.value[0]?.ts ?? null,
        bucketSpan.value,
      ),
      sessions: toNum(r.sessions),
      errorFree: toNum(r.sessions)
        ? ((toNum(r.sessions) - toNum(r.err_sessions)) / toNum(r.sessions)) * 100
        : null,
      lcp: vit.get(String(r.version))?.lcp ?? null,
      inp: vit.get(String(r.version))?.inp ?? null,
    });
    const newRow = rows(ID.relNew).rows[0];
    return {
      cur: shape(cur),
      prev: shape(prev),
      newErrors: newRow ? toNum(newRow.new_errors) : null,
    };
  });
  const releaseStatus = computed<WidgetStatus>(() => {
    if (!schema.value?.has("version")) return "hidden";
    const first = statusOf([releaseSource()]);
    if (first !== "ok") return first;
    if (releaseRows().length < 2) return "empty";
    const second = statusOf([ID.relVitals]);
    return second === "ok" ? "ok" : second;
  });

  const releaseMarker = computed(() => {
    const cur = release.value?.cur;
    return cur && !cur.predates ? { version: cur.version, ts: cur.firstSeen } : null;
  });

  const frustration = computed(() => {
    const shape = (r?: Row) => (r ? { rage: toNum(r.rage), dead: toNum(r.dead) } : null);
    return { cur: shape(windowOf(ID.kpi, 1)), prev: shape(windowOf(ID.kpi, 0)) };
  });
  const frustrationStatus = computed<WidgetStatus>(() => {
    if (!schema.value?.has("action_frustration_type")) return "hidden";
    return statusOf([ID.kpi]);
  });

  const filterOptions = computed(() => {
    const out: Record<keyof OverviewFilters, string[]> = { service: [], env: [], version: [] };
    for (const r of rows(ID.options).rows) {
      for (const k of Object.keys(out) as (keyof OverviewFilters)[]) {
        const v = r[k];
        if (v && !out[k].includes(String(v))) out[k].push(String(v));
      }
    }
    return out;
  });

  const status = computed<Record<WidgetGroup, WidgetStatus>>(() => ({
    verdict: verdictStatus.value,
    kpis: kpiStatus.value,
    chart: chartStatus.value,
    pages: pagesStatus.value,
    segments: segmentsStatus.value,
    release: releaseStatus.value,
    frustration: frustrationStatus.value,
  }));

  const busy = computed<Record<WidgetGroup, boolean>>(() => {
    const any = (ids: string[]) => ids.some(pending);
    return {
      verdict: any([ID.vitals]),
      kpis: any([ID.kpi, ID.series]),
      chart: any([ID.series]),
      pages: any([ID.pages]) && !pagesDue.value,
      segments: any([ID.segments]),
      release: any([releaseSource(), ID.relVitals]),
      frustration: any([ID.kpi]),
    };
  });

  // One page-level state beats a wall of identical per-panel ones; pages not yet requested do not count.
  const pageState = computed<"error" | "forbidden" | "empty" | "ok">(() => {
    const shown = (Object.entries(status.value) as [WidgetGroup, WidgetStatus][])
      .filter(([g, x]) => x !== "hidden" && !(g === "pages" && pagesDue.value))
      .map(([, x]) => x);
    if (shown.length && shown.every((x) => x === "error")) return "error";
    if (shown.length && shown.every((x) => x === "forbidden")) return "forbidden";
    const { verdict, kpis } = status.value;
    return verdict === "empty" && kpis === "empty" ? "empty" : "ok";
  });

  return {
    pageState,
    chartInterval,
    chartQuery,
    filters,
    filterOptions,
    range,
    status,
    vitals,
    vitalsPrev,
    totals,
    series,
    pages,
    segments,
    difference,
    release,
    releaseMarker,
    frustration,
    chartHits,
    busy,
    loadAll,
    retry,
    markPagesVisible,
    abortAll,
  };
}
