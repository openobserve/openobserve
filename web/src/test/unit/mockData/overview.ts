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

// ---------------------------------------------------------------------------
// Fixtures for the Overview tab (views/OverviewTab.vue).
//
// OverviewTab filters most payloads against its own time window (default: the
// last 15 minutes, in µs). Fixtures whose rows must survive that filter are
// exposed as builders taking `now` (ms) rather than frozen constants, so they
// always land inside the window the component computes at mount.
// ---------------------------------------------------------------------------

/** `alertsService.getHistory` response — feeds the "Recent Events" section. */
export const buildAlertHistory = (now: number = Date.now()) => ({
  hits: [
    {
      id: "alert-history-1",
      status: "firing",
      stream_name: "k8s_logs",
      alert_name: "High error rate",
      timestamp: (now - 30_000) * 1000,
    },
    {
      id: "alert-history-2",
      status: "error",
      stream_name: "default",
      alert_name: "Ingestion stalled",
      timestamp: (now - 120_000) * 1000,
    },
  ],
});

/** Empty `alertsService.getHistory` response. */
export const emptyAlertHistory = { hits: [] };

/** `anomalyService.list` response — anomaly detection configs. */
export const anomalyConfigs = [
  {
    id: "anomaly-cfg-1",
    name: "Checkout latency anomaly",
    stream_name: "checkout_traces",
  },
];

/** `anomalyService.getAllHistory` response — bulk history keyed by config. */
export const buildAnomalyHistory = (now: number = Date.now()) => ({
  configs: [
    {
      cfg: anomalyConfigs[0],
      hits: [
        {
          id: "anomaly-hit-1",
          timestamp: (now - 60_000) * 1000,
          anomaly_count: 3,
        },
      ],
    },
  ],
});

/** `incidentsService.list` response — feeds the "Active Incidents" section. */
export const buildIncidentList = (now: number = Date.now()) => ({
  incidents: [
    {
      id: "incident-1",
      title: "Checkout service degraded",
      severity: "P1",
      alert_count: 4,
      first_alert_at: (now - 300_000) * 1000,
      group_values: { "k8s-namespace": "prod" },
    },
  ],
  total: 1,
});

/** Empty `incidentsService.list` response. */
export const emptyIncidentList = { incidents: [], total: 0 };

/** `serviceGraphService.getCurrentTopology` response — feeds "Services". */
export const serviceGraphTopology = {
  nodes: [
    {
      id: "checkout",
      label: "checkout",
      error_rate: 6.2,
      requests: 1420,
      stream_name: "default",
    },
    {
      id: "payments",
      label: "payments",
      error_rate: 0,
      requests: 310,
      stream_name: "default",
    },
  ],
  edges: [
    {
      from: "checkout",
      to: "payments",
      p99_latency_ns: 900_000_000,
      baseline_p99_latency_ns: 300_000_000,
    },
  ],
};

/** Empty `serviceGraphService.getCurrentTopology` response. */
export const emptyServiceGraphTopology = { nodes: [], edges: [] };

export default {
  buildAlertHistory,
  emptyAlertHistory,
  anomalyConfigs,
  buildAnomalyHistory,
  buildIncidentList,
  emptyIncidentList,
  serviceGraphTopology,
  emptyServiceGraphTopology,
};
