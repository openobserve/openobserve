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
