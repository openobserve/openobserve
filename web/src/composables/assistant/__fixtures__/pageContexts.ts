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

import type { PageContext } from "@/composables/contextProviders/types";

const NOW_US = 1_768_400_000_000_000;

const RELATIVE_15M = {
  type: "relative",
  relativeTimePeriod: "15m",
  startTime: NOW_US - 900_000_000,
  endTime: NOW_US,
};

/** What each page provider returns today (`composables/contextProviders/*Provider.ts`), one fixture per provider. */
export const PAGE_CONTEXTS: Record<string, PageContext> = {
  default: {
    currentPage: "Billing",
    routeName: "billing",
    routePath: "/billing",
    routeFullPath: "/billing?org_identifier=acme-prod",
    routeParams: {},
    routeQuery: { org_identifier: "acme-prod" },
    organization_identifier: "acme-prod",
    request_timestamp: NOW_US,
  },
  logs: {
    currentPage: "logs",
    currentSQLQuery: 'SELECT * FROM "default"',
    sqlMode: true,
    currentVRLQuery: "",
    selectedStreams: ["default"],
    streamType: "logs",
    interestingFields: { default: ["level", "service_name"] },
    timeRange: RELATIVE_15M,
    organization_identifier: "acme-prod",
    quickMode: true,
    request_timestamp: NOW_US,
  },
  traces: {
    currentPage: "traces",
    selectedStreams: ["default"],
    streamType: "traces",
    currentQuery: "service_name='cart'",
    searchMode: "traces",
    timeRange: RELATIVE_15M,
    organization_identifier: "acme-prod",
    request_timestamp: NOW_US,
  },
  dashboards: {
    currentPage: "Dashboards",
    dashboardId: "7231",
    organization_identifier: "acme-prod",
    request_timestamp: NOW_US,
  },
  alerts: {
    currentPage: "Alerts",
    alertId: "a-17",
    alertName: "checkout-latency",
    isRealTime: false,
    organization_identifier: "acme-prod",
    user_intent: "edit existing alert",
    request_timestamp: NOW_US,
    selectedStreams: ["default"],
    streamType: "logs",
  },
  pipelines: {
    currentPage: "Pipelines",
    pipelineId: "p-4",
    pipelineName: "ingest-k8s",
    organization_identifier: "acme-prod",
    user_intent: "edit query node",
    request_timestamp: NOW_US,
    selectedStreams: ["default"],
    streamType: "logs",
    queryType: "sql",
    pipelineNodeType: "query",
  },
  incidents: {
    currentPage: "incidents",
    agent_type: "sre",
    org_id: "acme-prod",
    incident_id: "INC-142",
    incident_title: "Checkout 5xx",
    incident_status: "open",
    incident_severity: "P1",
    alert_count: 3,
    request_timestamp: NOW_US,
  },
  dbm: {
    currentPage: "dbm_queries",
    org_id: "acme-prod",
    time_range: { start_time: 1, end_time: 2, period: "1h" },
    db_system: "postgresql",
    db_instance: "pg-1",
    request_timestamp: NOW_US,
  },
};
