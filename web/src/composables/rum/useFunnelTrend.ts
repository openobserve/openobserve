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

import { computed, ref, type ComputedRef, type Ref } from "vue";
import type useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type useProductAnalytics from "@/composables/rum/useProductAnalytics";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { formatWindow, previousWindow, type UsWindow } from "@/utils/rum/funnelCompare";
import {
  alignPrevious,
  foldTrend,
  pairParam,
  previousTrendPeriods,
  resolveInterval,
  resolvePair,
  trendPeriods,
  type TrendContext,
  type TrendPeriods,
  type TrendPreviousView,
  type TrendSeries,
} from "@/utils/rum/funnelTrend";
import {
  BREAKDOWN_TOP,
  autoGranularity,
  granularityOptions,
  type NamedEvent,
  type Period,
} from "@/utils/rum/productAnalyticsModel";
import {
  WINDOW_MS,
  funnelTrendSql,
  type FunnelDef,
  type FunnelPair,
  type Granularity,
  type IdentitySql,
} from "@/utils/rum/productAnalyticsQueries";

interface TrendDeps {
  pa: ReturnType<typeof useProductAnalytics>;
  runner: ReturnType<typeof useAnalyticsSearch>;
  t: TranslateFn;
  def: ComputedRef<FunnelDef>;
  usersMode: ComputedRef<boolean>;
  identitySql: Readonly<Ref<IdentitySql | null>>;
  events: ComputedRef<NamedEvent[]>;
  timezone: ComputedRef<string>;
  funnelKey: ComputedRef<string>;
  compareActive: ComputedRef<boolean>;
}

const WAITING: PanelState<unknown> = {
  status: "loading",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
};

/** The funnel's Trend view: its runs, folds and select options; runs start only while Trend is shown. */
export default function useFunnelTrend(deps: TrendDeps) {
  const { pa, runner, t, def, timezone } = deps;
  const panel = runner.panel<Record<string, unknown>>("funnel-trend");
  const prevPanel = runner.panel<Record<string, unknown>>("funnel-trend-prev");
  // Fixed per run, so which bucket is still converting does not shift between renders.
  const nowUs = ref(Date.now() * 1000);

  const shown = computed(() => pa.funnelView.value === "trend" && def.value.steps.length > 1);
  const pair = computed<FunnelPair>(() => resolvePair(pa.funnelPair.value, def.value.steps.length));
  const interval = computed<Period | null>(() => {
    const r = pa.range.value;
    return r
      ? resolveInterval(r, timezone.value, pa.dataStartUs.value, pa.funnelInterval.value)
      : null;
  });
  const periodsResult = computed(() => {
    const r = pa.range.value;
    return r ? trendPeriods(r, timezone.value, nowUs.value, interval.value) : null;
  });
  const periods = computed<TrendPeriods | null>(() => {
    const p = periodsResult.value;
    return p && "boundariesUs" in p ? p : null;
  });
  const issue = computed<"tooShort" | "tooMany" | null>(() => {
    const p = periodsResult.value;
    if (!p) return null;
    if ("tooShort" in p) return "tooShort";
    return "tooMany" in p ? "tooMany" : null;
  });
  const breakdown = computed(() => !!def.value.breakdown);
  // A breakdown's lines are its own comparison, so the previous period runs only without one.
  const comparing = computed(() => deps.compareActive.value && !breakdown.value);

  const key = computed(() => {
    const p = periods.value;
    return p
      ? `${deps.funnelKey.value}|trend|${pairParam(pair.value)}|${p.boundariesUs.join(",")}`
      : null;
  });

  const windowUs = computed(() => {
    const w = def.value.window;
    return deps.usersMode.value && w !== "session" ? WINDOW_MS[w] * 1000 : null;
  });

  const context = (range: UsWindow, dataThroughUs: number | null): TrendContext => ({
    range,
    nowUs: nowUs.value,
    dataStartUs: pa.dataStartUs.value,
    dataThroughUs,
    windowUs: windowUs.value,
  });

  const state = computed<PanelState<unknown>>(() =>
    panel.value.key === key.value && key.value !== null ? panel.value : WAITING,
  );

  const series = computed<TrendSeries[]>(() => {
    const p = periods.value;
    const r = pa.range.value;
    if (!p || !r || state.value.status !== "ok") return [];
    const ctx = context(r, pa.summary.value?.dataThroughUs ?? null);
    return foldTrend(panel.value.rows, p, ctx, breakdown.value);
  });

  const previous = computed<TrendPreviousView | null>(() => {
    const r = pa.range.value;
    const p = periods.value;
    if (!comparing.value || !r || !p) return null;
    const prev = previousWindow(r);
    const pp = previousTrendPeriods(prev, timezone.value, nowUs.value, p.granularity);
    const range = formatWindow(prev, timezone.value);
    const k = prevPanel.value;
    if (!pp || k.key !== `${key.value}|prev`) return { status: "loading", buckets: [], range };
    if (k.status === "error" || k.status === "forbidden")
      return { status: "failed", buckets: [], range };
    if (k.status !== "ok" || !series.value[0]) return { status: "loading", buckets: [], range };
    const before = foldTrend(k.rows, pp, context(prev, null), false)[0] ?? null;
    return { status: "ok", buckets: alignPrevious(series.value[0], before), range };
  });

  const pairOptions = computed(() => {
    const n = def.value.steps.length;
    return Array.from({ length: n }, (_, i) => i + 1).flatMap((a) =>
      Array.from({ length: n - a }, (_, j) => a + j + 1).map((b) => ({
        label: t("rum.analytics.funnel.trendPairOption", { a, b }),
        value: pairParam({ a, b }),
      })),
    );
  });

  const pairLabel = computed<I18nText>(() =>
    t("rum.analytics.funnel.trendPairOption", { a: pair.value.a, b: pair.value.b }),
  );

  const intervalName = (g: Period): I18nText =>
    g === "week"
      ? t("rum.analytics.funnel.intervalNameWeek")
      : g === "month"
        ? t("rum.analytics.funnel.intervalNameMonth")
        : t("rum.analytics.funnel.intervalNameDay");

  const reasonText = (reason: string | null): I18nText | null => {
    if (!reason) return null;
    if (reason.startsWith("dataDays:"))
      return t("rum.analytics.retention.onlyDays", { n: Number(reason.slice(9)) });
    return reason === "tooMany"
      ? t("rum.analytics.retention.reasonTooMany")
      : t("rum.analytics.retention.reasonTooFew");
  };

  const intervalOptions = computed(() => {
    const r = pa.range.value;
    if (!r) return [];
    const auto = autoGranularity(r.startUs, r.endUs, pa.dataStartUs.value);
    const labels: Record<Granularity, I18nText> = {
      auto: auto
        ? t("rum.analytics.funnel.intervalAutoResolved", { interval: intervalName(auto) })
        : t("rum.analytics.funnel.intervalAuto"),
      day: t("rum.analytics.funnel.intervalDay"),
      week: t("rum.analytics.funnel.intervalWeek"),
      month: t("rum.analytics.funnel.intervalMonth"),
    };
    return granularityOptions(r.startUs, r.endUs, timezone.value, pa.dataStartUs.value).map((o) => {
      const why = reasonText(o.reason);
      return {
        label: why
          ? t("rum.analytics.retention.perDisabled", { label: labels[o.value], reason: why })
          : labels[o.value],
        value: o.value,
        disabled: o.disabled,
      };
    });
  });

  const setPair = (v: unknown) => {
    const [a, b] = String(v).split("-").map(Number);
    const n = def.value.steps.length;
    pa.funnelPair.value = a === 1 && b === n ? null : { a, b };
  };

  const setInterval = (v: unknown) => {
    pa.funnelInterval.value = v === "day" || v === "week" || v === "month" ? v : "auto";
  };

  const hold = () => {
    runner.hold("funnel-trend", "idle");
    runner.hold("funnel-trend-prev", "idle");
  };

  const runPrevious = (d: FunnelDef, k: string, cur: UsWindow, g: Period) => {
    const prev = previousWindow(cur);
    const pp = previousTrendPeriods(prev, timezone.value, nowUs.value, g);
    if (!pp) return runner.hold("funnel-trend-prev", "idle");
    const s = pa.scope.value;
    const scope =
      s.newSince === undefined ? s : { ...s, newSince: Math.trunc(prev.startUs / 1000) };
    void runner.run(
      "funnel-trend-prev",
      {
        sql: funnelTrendSql(scope, deps.identitySql.value, d, pp.boundariesUs, pair.value, {
          events: deps.events.value,
          sample: 1,
        }),
        ...pa.newUsersRange(prev, d.unit === "users" && !!deps.identitySql.value),
        limit: pp.boundariesUs.length,
        sampled: 1,
      },
      `${k}|prev`,
    );
  };

  /** Runs the trend for the funnel on screen; an answered or running key is left alone unless forced. */
  const run = async (d: FunnelDef, force = false) => {
    if (!shown.value) return hold();
    await pa.loadDataStart();
    const k = key.value;
    const p = periods.value;
    const cur = pa.range.value;
    if (!shown.value || !k || !p || !cur) return hold();
    const done = (s: PanelState<unknown>, id: string) =>
      s.key === id && (s.status === "ok" || s.status === "loading");
    if (!done(panel.value, k) || force) {
      void runner.run(
        "funnel-trend",
        {
          sql: funnelTrendSql(
            pa.scope.value,
            deps.identitySql.value,
            d,
            p.boundariesUs,
            pair.value,
            {
              events: deps.events.value,
              sample: 1,
            },
          ),
          ...pa.newUsersRange(cur, d.unit === "users" && !!deps.identitySql.value),
          limit: p.boundariesUs.length * (d.breakdown ? BREAKDOWN_TOP + 1 : 1),
          sampled: 1,
        },
        k,
      );
    }
    if (!comparing.value) runner.hold("funnel-trend-prev", "idle");
    else if (!done(prevPanel.value, `${k}|prev`) || force) runPrevious(d, k, cur, p.granularity);
  };

  /** A new run reads the clock again, so the still-converting bucket follows the day. */
  const tick = () => {
    nowUs.value = Date.now() * 1000;
  };

  const rangeText = computed(() => {
    const r = pa.range.value;
    return r ? formatWindow(r, timezone.value) : "";
  });

  return {
    shown,
    key,
    pair,
    pairLabel,
    pairValue: computed(() => pairParam(pair.value)),
    interval,
    periods,
    issue,
    state,
    series,
    previous,
    breakdown,
    pairOptions,
    intervalOptions,
    rangeText,
    setPair,
    setInterval,
    hold,
    run,
    tick,
  };
}
