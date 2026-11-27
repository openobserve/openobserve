/**
 * Core interfaces for the AI Context Provider System
 *
 * Example Usage:
 * ```typescript
 * const logsContext: PageContext = {
 *   currentPage: 'logs',
 *   currentSQLQuery: 'SELECT * FROM "default"',
 *   timeRange: { type: 'relative', relativeTimePeriod: '15m', startTime: 1, endTime: 2 }
 * };
 * ```
 */

/** The time range as the agent reads it (`o2ai_context.py`): microseconds, relative or absolute. */
export type OverviewRowKind = "incident" | "service" | "anomaly" | "alert";

export type OverviewBucket = "critical" | "degraded" | "anomaly" | "recovered";

export type ServiceSignal = "errors" | "latency" | "normal" | "low_traffic";

export type AlertCoverage = "covered" | "none" | "unknown";

/** One row of the Overview "Now" list; `key` is `${kind}:${id}` and times are microseconds. */
export type OverviewNowRow = OverviewRowBase &
  (
    | {
        kind: "incident";
        title: string;
        severity: "P1" | "P2" | "P3" | "P4";
        status: string;
        alertCount: number;
      }
    | {
        kind: "service";
        service: string;
        errorRate: number;
        requests: number;
        p99Ms: number | null;
        p99Ratio: number | null;
        baselineErrorRate: number | null;
        baselineHours: number | null;
        signal: ServiceSignal;
        coverage: AlertCoverage;
        partial: boolean;
      }
    | {
        kind: "anomaly";
        configId: string;
        name: string;
        stream: string;
        anomalyCount: number;
        at: number;
      }
    | {
        kind: "alert";
        alertId: string;
        name: string;
        state: "firing" | "recovered";
        count: number;
        lastAt: number;
      }
  );

interface OverviewRowBase {
  key: string;
  id: string;
  bucket: OverviewBucket;
  changedAt: number;
}

/** What the Overview shows, shared by its list, the Home context provider and the starters; times in microseconds. */
export interface OverviewNowSnapshot {
  rows: OverviewNowRow[];
  selectedKey: string | null;
  window: { start: number; end: number };
  /** `window` is the trend's effective window, which can end before the page range. */
  services: {
    available: boolean;
    partial: boolean;
    dataUntil: number | null;
    window: { start: number; end: number } | null;
    allRegions: boolean;
  };
  /** The first-data layout (HomeNoDataState) is showing instead of the Overview. */
  noData: boolean;
}

export interface PageTimeRange {
  type?: "relative" | "absolute" | "unknown" | (string & {});
  relativeTimePeriod?: string;
  startTime?: number;
  endTime?: number;
  [extra: string]: unknown;
}

/** The provider contract, typed from the agent whitelist (`00` §6.1); extras are kept and marked "not read". */
export interface PageContext {
  /** Route name for the default provider; a page id ("logs", "Alerts") for the others. */
  currentPage: string;
  org_id?: string;
  organization_identifier?: string;
  /** Localised page title; never on the wire. */
  pageTitle?: string;
  /** The router's route name, set by the default provider (B-13). */
  routeName?: string;
  selectedStreams?: string[];
  streamType?: string | null;
  timeRange?: PageTimeRange;
  currentSQLQuery?: string;
  currentVRLQuery?: string;
  currentQuery?: string;
  dashboardId?: string;
  panelId?: string;
  alertId?: string;
  pipelineId?: string;
  incident_id?: string;
  /** Microseconds; the agent's "now". */
  request_timestamp?: number;
  user_timezone?: string;
  /** Set only by the Home provider while the Overview is mounted; o2-ai reads `page` before `currentPage`. */
  page?: "home_overview";
  overviewIncidents?: {
    id: string;
    title: string;
    severity: "P1" | "P2" | "P3" | "P4";
    status: string;
    alert_count: number;
  }[];
  overviewServices?: {
    service: string;
    error_rate: number;
    requests: number;
    p99_ms: number | null;
    p99_ratio: number | null;
    baseline_error_rate: number | null;
    baseline_hours: number | null;
    signal: ServiceSignal;
    alert_coverage: AlertCoverage;
  }[];
  overviewServicesMeta?: {
    all_regions: boolean;
    partial: boolean;
    data_until: number | null;
    window_start: number | null;
    window_end: number | null;
  };
  overviewAnomalies?: {
    config_id: string;
    name: string;
    stream: string;
    anomaly_count: number;
    at: number;
  }[];
  overviewAlerts?: {
    alert_id: string;
    name: string;
    state: "firing" | "recovered";
    count: number;
    last_at: number;
  }[];
  /** The row an Investigate hands off. */
  overviewSelected?: { kind: OverviewRowKind; id: string };
  [extra: string]: unknown;
}

/**
 * Context provider interface that each page must implement
 *
 * Example Implementation:
 * ```typescript
 * const logsProvider: ContextProvider = {
 *   getContext: async () => ({
 *     currentPage: 'logs',
 *     currentSQLQuery: searchObj.data.query,
 *   })
 * };
 * ```
 */
export interface ContextProvider {
  getContext(): PageContext | Promise<PageContext>;
}
