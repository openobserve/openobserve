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

import { type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import searchService from "@/services/search";
import { SPAN_KIND_CLIENT, SPAN_KIND_UNSPECIFIED } from "@/utils/traces/constants";

const ACTION_PROXIMITY_MS = 10_000; // ±10s — actions beyond this are collapsed

export default function useRumSpanBuilder(logStreams: Ref<string[]>, searchObj: any) {
  const store = useStore();
  const router = useRouter();
  const { getStream } = useStreams();

  const sanitizeTraceId = (id: string): string => String(id).replace(/['"\\]/g, "");

  const getOrgId = () =>
    (router.currentRoute.value.query?.org_identifier as string) ||
    store.state.selectedOrganization.identifier;

  // ±60s buffer around the trace time window for all RUM event queries,
  // ensuring we capture RUM events that may have been ingested slightly
  // before or after the backend trace spans.
  const RUM_TIME_BUFFER_US = 60_000_000;

  /**
   * Fetch view events (type = 'view') for the given view IDs.
   */
  const fetchViewEvents = async (
    viewIds: string[],
    startTime: number,
    endTime: number,
  ): Promise<any[]> => {
    try {
      const orgId = getOrgId();
      const res = await searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: {
              sql: `SELECT * FROM "_rumdata" WHERE view_id IN ('${viewIds.join("','")}') AND type = 'view' ORDER BY ${store.state.zoConfig.timestamp_column} ASC`,
              // +/- 60s around trace window to capture RUM events that may have
              // been ingested slightly before or after the backend trace spans
              start_time: startTime - RUM_TIME_BUFFER_US,
              end_time: endTime + RUM_TIME_BUFFER_US,
              from: 0,
              size: 10,
            },
          },
          page_type: "logs",
        },
        "RUM",
      );
      return res.data?.hits || [];
    } catch (error) {
      console.error("Error fetching view events:", error);
      return [];
    }
  };

  /**
   * Fetch action events for the given action ID.
   */
  const fetchActionEvents = async (
    actionId: string[],
    startTime: number,
    endTime: number,
  ): Promise<any[]> => {
    try {
      const orgId = getOrgId();
      const res = await searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: {
              sql: `SELECT * FROM "_rumdata" WHERE action_id IN (${actionId.map((id) => `'${sanitizeTraceId(id)}'`).join(",")}) and type='action' ORDER BY ${store.state.zoConfig.timestamp_column} ASC`,
              // +/- 60s around trace window to capture RUM action events that may
              // have been ingested slightly before or after the backend trace spans
              start_time: startTime - RUM_TIME_BUFFER_US,
              end_time: endTime + RUM_TIME_BUFFER_US,
              from: 0,
              size: 250,
            },
          },
          page_type: "logs",
        },
        "RUM",
      );
      return res.data?.hits || [];
    } catch (error) {
      console.error("Error fetching action events:", error);
      return [];
    }
  };

  /**
   * Fetch all leaf events (resource, error, long_task, action) for the given view IDs.
   */
  const fetchAllViewEvents = async (
    viewIds: string[],
    startTime: number,
    endTime: number,
  ): Promise<any[]> => {
    try {
      const orgId = getOrgId();
      const res = await searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: {
              sql: `SELECT * FROM "_rumdata" WHERE view_id IN ('${viewIds.join("','")}') AND (type = 'error' OR type = 'resource' OR type = 'long_task' OR type = 'action') ORDER BY ${store.state.zoConfig.timestamp_column} ASC`,
              // +/- 60s around trace window to capture RUM leaf events (resource,
              // error, long_task) that may have been ingested slightly before or
              // after the backend trace spans
              start_time: startTime - RUM_TIME_BUFFER_US,
              end_time: endTime + RUM_TIME_BUFFER_US,
              from: 0,
              size: 250,
            },
          },
          page_type: "logs",
        },
        "RUM",
      );
      return res.data?.hits || [];
    } catch (error) {
      console.error("Error fetching view events:", error);
      return [];
    }
  };

  /**
   * Fetch RUM events that have the matching trace_id, plus the full view context.
   * Returns structured data for building the Session→View→Action→Resource hierarchy.
   */
  const fetchRumEventsForTrace = async (traceId: string, startTime: number, endTime: number) => {
    const empty = {
      tracedResources: [] as any[],
      viewEvents: [] as any[],
      actionEvents: [] as any[],
      allViewEvents: [] as any[],
    };

    try {
      if (!logStreams.value.includes("_rumdata") || !traceId) {
        return empty;
      }

      const rumStream = await getStream("_rumdata", "logs", true);
      const hasTraceIdField = rumStream?.schema?.some(
        (field: any) => field.name === "_oo_trace_id",
      );
      if (!hasTraceIdField) return empty;

      const orgId = getOrgId();

      // Query 1: Find the traced resource(s) by _oo_trace_id
      const tracedRes = await searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: {
              sql: `SELECT * FROM "_rumdata" WHERE _oo_trace_id = '${sanitizeTraceId(traceId)}' ORDER BY ${store.state.zoConfig.timestamp_column} ASC`,
              // +/- 60s around trace window to capture the RUM resource that bridges
              // the trace to the RUM session (view/action hierarchy)
              start_time: startTime - RUM_TIME_BUFFER_US,
              end_time: endTime + RUM_TIME_BUFFER_US,
              from: 0,
              size: 10,
            },
          },
          page_type: "logs",
        },
        "RUM",
      );

      const tracedResources: any[] = tracedRes.data?.hits || [];
      if (!tracedResources.length) return empty;

      const viewIds = [...new Set(tracedResources.map((r: any) => r.view_id).filter(Boolean))];

      // Parse action_id from traced resource (stringified JSON array)
      let parsedActionIds: string[] = [];
      try {
        parsedActionIds = JSON.parse(tracedResources[0]?.action_id || "[]");
      } catch {
        parsedActionIds = [];
      }
      const primaryActionId = parsedActionIds || "";

      // Run all 3 queries in parallel
      const [viewEvents, actionEvents, allViewEvents] = await Promise.all([
        fetchViewEvents(viewIds, startTime, endTime),
        primaryActionId
          ? fetchActionEvents(primaryActionId, startTime, endTime)
          : Promise.resolve([]),
        fetchAllViewEvents(viewIds, startTime, endTime),
      ]);

      return { tracedResources, viewEvents, actionEvents, allViewEvents };
    } catch (error) {
      console.error("Error fetching RUM events for trace:", error);
      return empty;
    }
  };

  const tsCol = () => store.state.zoConfig.timestamp_column;

  const resolveParentSpanId = (event: any, actionEvents: any[] = []): string => {
    // Build a lookup of action IDs that were actually fetched and have a span in the tree.
    const fetchedActionIds = new Set(actionEvents.map((a: any) => String(a.action_id)));

    let actionIds: string[] = [];
    try {
      const parsed = JSON.parse(event.action_id || "[]");
      actionIds = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      // Not a JSON array — treat as a plain string ID.
      if (event.action_id) actionIds = [String(event.action_id)];
    }

    // Use the first action ID that has a real fetched span.
    // If none match, fall through to view_id — a ghost action reference
    // would leave the span orphaned at the root level.
    for (const id of actionIds) {
      if (fetchedActionIds.has(id)) return `rum_action_${id}`;
    }

    if (event.view_id) return `rum_view_${event.view_id}`;
    return "";
  };

  const createLeafSpan = (event: any, parentSpanId: string) => {
    const eventDate = event.date || 0;
    const duration =
      event.resource_duration / 1000000 || event[`${event.type}_duration`] / 1000000 || 0;
    const isTraced = !!event._oo_trace_id;

    let operationName = "Unknown RUM Event";
    if (event.type === "resource") {
      operationName = `${event.resource_method || "GET"} ${event.resource_url || "Unknown URL"}`;
    } else if (event.type === "error") {
      operationName = `Error: ${event.error_message || event.error_type || "Unknown Error"}`;
    } else if (event.type === "long_task") {
      operationName = `Long Task: ${event.long_task_duration / 1000 || duration}ms`;
    }

    return {
      [tsCol()]: eventDate,
      start_time: eventDate * 1_000_000,
      end_time: (eventDate + duration) * 1_000_000,
      duration: duration * 1000,
      span_id: isTraced
        ? String(event._oo_span_id)
        : `rum_${event.type}_${event[`${event.type}_id`] || event.date}`,
      reference_parent_span_id: parentSpanId,
      trace_id: event._oo_trace_id || undefined,
      operation_name: operationName,
      service_name: event.service || "Frontend",
      span_status:
        event.type === "error" || (event.type === "resource" && event.resource_status_code >= 400)
          ? "ERROR"
          : "OK",
      span_kind: event.type === "resource" ? SPAN_KIND_CLIENT : SPAN_KIND_UNSPECIFIED,
      rum_event_type: event.type,
      rum_session_id: event.session_id,
      _is_trace_bridge: isTraced,
    };
  };

  const makeCollapsedSpan = (
    label: string,
    events: any[],
    viewId: string,
    sessionId: string,
    traceId: string,
    overrides: Record<string, any> = {},
  ) => {
    const dates = events.map((e: any) => e.date || 0).filter((d: number) => d > 0);
    return {
      [tsCol()]: dates.length ? Math.min(...dates) : 0,
      start_time: (dates.length ? Math.min(...dates) : 0) * 1_000_000,
      end_time: (dates.length ? Math.max(...dates) : 0) * 1_000_000,
      duration: 0,
      span_id: `rum_collapsed_${label}_${viewId || "unknown"}`,
      reference_parent_span_id: viewId ? `rum_view_${viewId}` : "",
      trace_id: traceId || undefined,
      operation_name: label,
      service_name: "Frontend",
      span_status: "OK",
      span_kind: SPAN_KIND_UNSPECIFIED,
      rum_event_type: `collapsed_${label}`,
      _is_collapsed_group: true,
      ...overrides,
    };
  };

  const buildViewSpans = (viewEvents: any[], traceId: string): any[] => {
    const dedupedViews = new Map<string, any>();
    for (const view of viewEvents) {
      const existing = dedupedViews.get(view.view_id);
      if (!existing || (view.view_time_spent > 0 && !existing.view_time_spent)) {
        dedupedViews.set(view.view_id, view);
      }
    }

    return [...dedupedViews.values()].map((view) => {
      const viewDuration = view.view_time_spent || view.view_loading_time;
      return {
        [tsCol()]: view.date,
        start_time: (view.date || 0) * 1_000_000,
        end_time: ((view.date || 0) + viewDuration / 1000000) * 1_000_000,
        duration: viewDuration / 1000,
        span_id: `rum_view_${view.view_id}`,
        reference_parent_span_id: "",
        trace_id: traceId || undefined,
        operation_name: `View: ${view.view_url || view.view_name || "Unknown Page"}`,
        service_name: view.service || "Frontend",
        span_status: "OK",
        span_kind: SPAN_KIND_UNSPECIFIED,
        rum_event_type: "view",
        rum_session_id: view.session_id,
      };
    });
  };

  const buildActionSpans = (
    actionEvents: any[],
    firstTracedResource: any,
    traceId: string,
    tracedTimestamp: number,
  ): any[] => {
    const spans: any[] = [];
    const tracedActionIds: string[] = (() => {
      try {
        return JSON.parse(firstTracedResource?.action_id || "[]");
      } catch {
        return [];
      }
    })();

    const actionsToShow: any[] = [];
    const actionsToCollapse: any[] = [];

    for (const action of actionEvents) {
      const distance = Math.abs((action.date || 0) - tracedTimestamp);
      const isParentAction = tracedActionIds.includes(String(action.action_id));
      if (distance <= ACTION_PROXIMITY_MS || isParentAction) {
        actionsToShow.push(action);
      } else {
        actionsToCollapse.push(action);
      }
    }

    for (const action of actionsToShow) {
      spans.push({
        [tsCol()]: action.date,
        start_time: (action.date || 0) * 1_000_000,
        end_time: ((action.date || 0) + (action.action_loading_time / 1000000 || 0)) * 1_000_000,
        duration: action.action_loading_time / 1000,
        span_id: `rum_action_${action.action_id}`,
        reference_parent_span_id: action.view_id ? `rum_view_${action.view_id}` : "",
        trace_id: traceId || undefined,
        operation_name: `Action: ${action.action_type || "Unknown"} on ${action.action_target_name || "Unknown"}`,
        service_name: action.service || "Frontend",
        span_status: "OK",
        span_kind: SPAN_KIND_UNSPECIFIED,
        rum_event_type: "action",
        rum_session_id: action.session_id,
      });
    }

    if (actionsToCollapse.length > 0) {
      spans.push(
        makeCollapsedSpan(
          `[${actionsToCollapse.length} other actions]`,
          actionsToCollapse,
          firstTracedResource?.view_id,
          firstTracedResource?.session_id,
          traceId,
          {
            rum_event_type: "collapsed_actions",
            rum_session_id: firstTracedResource?.session_id,
          },
        ),
      );
    }

    return spans;
  };

  const classifyLeafEvents = (allViewEvents: any[]) => {
    const staticAssets: any[] = [];
    const apiCalls: any[] = [];
    const errors: any[] = [];
    const longTasks: any[] = [];

    for (const event of allViewEvents) {
      if (event.type === "view" || event.type === "action") continue;
      if (event.type === "error") {
        errors.push(event);
      } else if (event.type === "long_task") {
        longTasks.push(event);
      } else if (
        event.type === "resource" &&
        event.resource_type &&
        ["js", "css", "image", "font", "media"].includes(event.resource_type)
      ) {
        staticAssets.push(event);
      } else {
        apiCalls.push(event);
      }
    }

    return { staticAssets, apiCalls, errors, longTasks };
  };

  const buildResourceSpans = (apiCalls: any[], actionEvents: any[]): any[] =>
    apiCalls.map((event) => createLeafSpan(event, resolveParentSpanId(event, actionEvents)));

  const buildErrorSpans = (
    errors: any[],
    firstTracedResource: any,
    traceId: string,
    actionEvents: any[] = [],
  ): any[] => {
    if (!errors.length) return [];
    const spans: any[] = [];

    for (const event of errors.slice(0, 3)) {
      spans.push(createLeafSpan(event, resolveParentSpanId(event, actionEvents)));
    }

    if (errors.length > 3) {
      spans.push(
        makeCollapsedSpan(
          `[${errors.length - 3} more errors]`,
          errors.slice(3),
          firstTracedResource?.view_id,
          firstTracedResource?.session_id,
          traceId,
          { span_status: "ERROR" },
        ),
      );
    }

    return spans;
  };

  const buildStaticAssetSpans = (
    staticAssets: any[],
    firstTracedResource: any,
    traceId: string,
  ): any[] => {
    if (!staticAssets.length) return [];

    if (staticAssets.length <= 5) {
      return staticAssets.map((event) =>
        createLeafSpan(event, event.view_id ? `rum_view_${event.view_id}` : ""),
      );
    }

    const spans: any[] = [];
    for (const event of staticAssets.slice(0, 3)) {
      spans.push(createLeafSpan(event, event.view_id ? `rum_view_${event.view_id}` : ""));
    }

    const remaining = staticAssets.length - 3;
    spans.push(
      makeCollapsedSpan(
        `[${remaining} static assets]`,
        staticAssets.slice(3),
        firstTracedResource?.view_id,
        firstTracedResource?.session_id,
        traceId,
      ),
    );

    return spans;
  };

  const buildLongTaskSpans = (
    longTasks: any[],
    firstTracedResource: any,
    traceId: string,
  ): any[] => {
    if (!longTasks.length) return [];

    if (longTasks.length <= 2) {
      return longTasks.map((event) =>
        createLeafSpan(event, event.view_id ? `rum_view_${event.view_id}` : ""),
      );
    }

    return [
      makeCollapsedSpan(
        `[${longTasks.length} long tasks]`,
        longTasks,
        firstTracedResource?.view_id,
        firstTracedResource?.session_id,
        traceId,
      ),
    ];
  };

  const registerServiceColors = (spans: any[]) => {
    const traceObj = searchObj.data.traceDetails.selectedTrace as any;
    if (!traceObj?.service_name) return;

    const uniqueServices = new Set(spans.map((s: any) => s.service_name).filter(Boolean));
    for (const svc of uniqueServices) {
      if (!traceObj.service_name.find((s: any) => s.service_name === svc)) {
        traceObj.service_name.push({ service_name: svc, count: 1 });
      }
    }
  };

  /**
   * Format RUM events as trace spans with full parent-child hierarchy.
   * Builds Session → View → Action → Resource/Error/LongTask → Backend spans.
   */
  const formatRumEventsAsSpans = (
    tracedResources: any[],
    viewEvents: any[],
    actionEvents: any[],
    allViewEvents: any[],
  ) => {
    if (!allViewEvents.length) return [];

    const firstTracedResource = tracedResources[0];
    const traceId = firstTracedResource?._oo_trace_id || "";
    const tracedTimestamp = firstTracedResource?.date || 0;

    const { staticAssets, apiCalls, errors, longTasks } = classifyLeafEvents(allViewEvents);

    const spans: any[] = [
      ...buildViewSpans(viewEvents, traceId),
      ...buildActionSpans(actionEvents, firstTracedResource, traceId, tracedTimestamp),
      ...buildResourceSpans(apiCalls, actionEvents),
      ...buildErrorSpans(errors, firstTracedResource, traceId, actionEvents),
      ...buildStaticAssetSpans(staticAssets, firstTracedResource, traceId),
      ...buildLongTaskSpans(longTasks, firstTracedResource, traceId),
    ];

    spans.sort((a: any, b: any) => (a[tsCol()] || 0) - (b[tsCol()] || 0));

    registerServiceColors(spans);

    return spans;
  };

  return {
    fetchRumEventsForTrace,
    formatRumEventsAsSpans,
  };
}
