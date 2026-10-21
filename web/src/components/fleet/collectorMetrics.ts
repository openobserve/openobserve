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

import type { FleetFlowWindow } from "@/services/fleet";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import { buildDbmPromqlPanelSchema, promqlEscape } from "@/utils/dbm/metricsPanels";

export type CollectorMetricTile = "cpu" | "memory" | "uptime" | "received" | "sent" | "failed";

export type CollectorMetricValues = Record<CollectorMetricTile, number | null>;

export interface CollectorMetricChart {
  key: string;
  title: I18nText;
  wide: boolean;
  schemas: Record<string, any>[];
}

const SIGNALS = ["log_records", "metric_points", "spans"] as const;
type Signal = (typeof SIGNALS)[number];

export const WINDOW_SECONDS: Record<FleetFlowWindow, number> = {
  "5m": 300,
  "1h": 3600,
  "24h": 86_400,
};

// Points arrive every 60 s, so a rate needs at least two of them; a day-long chart samples coarser.
const CHART_RATE: Record<FleetFlowWindow, string> = { "5m": "2m", "1h": "2m", "24h": "10m" };

const sel = (id: string) => `{service_instance_id="${promqlEscape(id)}"}`;

const rate = (metric: string, id: string, range: string) =>
  `rate(otelcol_${metric}${sel(id)}[${range}])`;

// A signal the collector never handled has no stream, so `or` keeps the others from vanishing with it.
const sumAny = (metrics: string[], id: string, range: string) =>
  `sum(${metrics.map((m) => rate(m, id, range)).join(" or ")})`;

const perSignal = (prefix: string) => SIGNALS.map((s) => `${prefix}_${s}`);

const failedMetrics = () => [
  ...perSignal("exporter_send_failed"),
  ...perSignal("exporter_enqueue_failed"),
];

/** Instant queries behind the six tiles; throughput is the mean rate over the window. */
export function collectorTileQueries(
  id: string,
  window: FleetFlowWindow,
): Record<CollectorMetricTile, string> {
  return {
    cpu: `${rate("process_cpu_seconds", id, "2m")} * 100`,
    memory: `otelcol_process_memory_rss${sel(id)}`,
    uptime: `otelcol_process_uptime${sel(id)}`,
    received: sumAny(perSignal("receiver_accepted"), id, window),
    sent: sumAny(perSignal("exporter_sent"), id, window),
    failed: sumAny(failedMetrics(), id, window),
  };
}

function panel(
  key: string,
  unit: string | null,
  queries: { query: string; stream: string; legend: string }[],
) {
  return buildDbmPromqlPanelSchema({
    id: `fleet-collector-${key}`,
    chartType: "line",
    unit,
    queries,
  });
}

// The panel engine keeps per-query metadata in a sparse array, so a query that returns nothing breaks a multi-query panel.
const named = (query: string, legend: I18nText) =>
  `label_replace(${query}, "series", "${promqlEscape(legend)}", "", "")`;

const oneQuery = (series: string[], stream: string) => ({
  query: series.join(" or "),
  stream: `otelcol_${stream}`,
  legend: raw("{series}"),
});

function signalLegend(t: TranslateFn, kind: "received" | "sent", s: Signal): I18nText {
  const signal = {
    log_records: t("fleet.collectorMetrics.signalLogs"),
    metric_points: t("fleet.collectorMetrics.signalMetrics"),
    spans: t("fleet.collectorMetrics.signalSpans"),
  }[s];
  return kind === "received"
    ? t("fleet.collectorMetrics.legendReceived", { signal })
    : t("fleet.collectorMetrics.legendSent", { signal });
}

/** The four chart cards; CPU and memory share a card but not an axis. */
export function collectorCharts(
  t: TranslateFn,
  id: string,
  window: FleetFlowWindow,
): CollectorMetricChart[] {
  const r = CHART_RATE[window];
  const throughput = SIGNALS.flatMap((s) => [
    named(sumAny([`receiver_accepted_${s}`], id, r), signalLegend(t, "received", s)),
    named(sumAny([`exporter_sent_${s}`], id, r), signalLegend(t, "sent", s)),
  ]);
  const failures = [
    named(sumAny(failedMetrics(), id, r), t("fleet.collectorMetrics.legendFailed")),
    named(sumAny(perSignal("receiver_refused"), id, r), t("fleet.collectorMetrics.legendRefused")),
  ];
  // Each series carries its own start_time label, so the two sides only match once aggregated.
  const by = "sum by (exporter, data_type)";
  const queue = [
    {
      query: `${by}(otelcol_exporter_queue_size${sel(id)}) / ${by}(otelcol_exporter_queue_capacity${sel(id)})`,
      stream: "otelcol_exporter_queue_size",
      legend: raw("{exporter} {data_type}"),
    },
  ];
  return [
    {
      key: "throughput",
      wide: true,
      title: t("fleet.collectorMetrics.chartThroughput"),
      schemas: [
        panel("throughput", "default", [oneQuery(throughput, "receiver_accepted_log_records")]),
      ],
    },
    {
      key: "failures",
      wide: false,
      title: t("fleet.collectorMetrics.chartFailures"),
      schemas: [
        panel("failures", "default", [oneQuery(failures, "exporter_send_failed_log_records")]),
      ],
    },
    {
      key: "queue",
      wide: false,
      title: t("fleet.collectorMetrics.chartQueue"),
      schemas: [panel("queue", "percent-1", queue)],
    },
    {
      key: "resources",
      wide: true,
      title: t("fleet.collectorMetrics.chartResources"),
      schemas: [
        panel("cpu", "percent", [
          {
            query: `${rate("process_cpu_seconds", id, r)} * 100`,
            stream: "otelcol_process_cpu_seconds",
            legend: t("fleet.collectorMetrics.cpu"),
          },
        ]),
        panel("memory", "bytes", [
          {
            query: `otelcol_process_memory_rss${sel(id)}`,
            stream: "otelcol_process_memory_rss",
            legend: t("fleet.collectorMetrics.memory"),
          },
        ]),
      ],
    },
  ];
}
