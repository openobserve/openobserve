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

import type { ContentBlock } from "@/ts/interfaces/chat";
import type { TranslateFn } from "@/types/i18n";

// `response` is stamped onto blocks by the stream handler but is not part
// of the shared ContentBlock interface.
export type ToolCallBlock = ContentBlock & { response?: Record<string, any> };

export function truncateQuery(query: string) {
  if (!query) return "";
  const maxLength = 100;
  if (query.length <= maxLength) return query;
  return query.substring(0, maxLength) + "...";
}

export function formatContextKey(key: string) {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatContextValue(value: any) {
  if (typeof value === "string") {
    if (value.length > 30) return value.substring(0, 30) + "...";
    return value;
  }
  return String(value);
}

// Extract display fields from tool call context (handles different tool schemas)
export function getToolCallDisplayData(context: any) {
  if (!context) return null;

  const data: Record<string, any> = {};

  // Handle nested request_body.query structure (SearchSQL, ExtractPatterns)
  if (context.request_body?.query) {
    const q = context.request_body.query;
    if (q.sql) data.query = q.sql;
    if (q.start_time) data.start_time = q.start_time;
    if (q.end_time) data.end_time = q.end_time;
    if (q.from !== undefined) data.from = q.from;
    if (q.size !== undefined) data.size = q.size;
    if (q.query_type) data.query_type = q.query_type;
    if (q.vrl) data.vrl = q.vrl;
  }

  // Handle testFunction context (VRL validation)
  if (context.vrl) data.vrl = context.vrl;
  if (context.request_body?.function) data.vrl = context.request_body.function;

  // Handle flat SQL from SearchSQL enriched context
  if (context.sql) data.query = context.sql;

  // Handle flat structure (StreamSchema, etc.)
  if (context.stream_name) data.stream = context.stream_name;
  if (context.type) data.type = context.type;

  // CLI tools: surface the command string
  if (context.command) data.command = context.command;

  return Object.keys(data).length > 0 ? data : null;
}

export function hasToolCallDetails(block: ToolCallBlock) {
  if (block.success === false) return true;
  if (block.summary) return true;
  if (block.response) return true;
  return getToolCallDisplayData(block.context) !== null;
}

// Splits an already-interpolated sentence around the value that renders bold,
// so the header stays ONE translatable sentence instead of two fragments.
export function splitAroundHighlight(full: string, highlight: string) {
  const at = full.indexOf(highlight);
  if (at < 0) return { text: full, highlight: null as string | null, suffix: "" };
  return {
    text: full.slice(0, at),
    highlight: highlight as string | null,
    suffix: full.slice(at + highlight.length),
  };
}

export function formatTimestamp(timestamp: number, t: TranslateFn) {
  if (!timestamp || timestamp === 0) return t("aiAssistant.aiChat.notSpecified");
  // Timestamp is in microseconds, convert to milliseconds
  const ms = timestamp > 1e15 ? timestamp / 1000 : timestamp;
  const date = new Date(ms);
  return date.toLocaleString();
}

export function formatToolCallMessage(block: ToolCallBlock, t: TranslateFn) {
  if (block.tool === "testFunction") {
    if (block.success === false) {
      return {
        text: t("aiAssistant.aiChat.toolVrlValidationFailed"),
        highlight: null,
        suffix: "",
      };
    }
    return { text: t("aiAssistant.aiChat.toolVrlValidated"), highlight: null, suffix: "" };
  }
  if (block.tool === "SearchSQL") {
    if (block.success === false) {
      return {
        text: t("aiAssistant.aiChat.toolQueryFailed"),
        highlight: null,
        suffix: "",
      };
    }
    if (block.response?.total !== undefined) {
      const streamType = block.context?.type || "logs";
      return {
        text: t("aiAssistant.aiChat.toolQueriedStream", { type: streamType }),
        highlight: t("aiAssistant.aiChat.toolResultsCount", {
          count: block.response.total,
        }),
        suffix: "",
      };
    }
  }
  if (block.tool === "StreamSchema" && block.context?.stream_name) {
    const streamName = block.context.stream_name;
    return splitAroundHighlight(
      t("aiAssistant.aiChat.toolStreamSchema", { name: streamName }),
      streamName,
    );
  }
  if (block.tool === "GetIncident" && block.context?.incident_id) {
    const incidentId = block.context.incident_id;
    return splitAroundHighlight(t("aiAssistant.aiChat.toolGetIncident", { id: incidentId }), incidentId);
  }
  if (block.tool === "GetAlert" && block.context?.alert_id) {
    const alertId = block.context.alert_id;
    return splitAroundHighlight(t("aiAssistant.aiChat.toolGetAlert", { id: alertId }), alertId);
  }
  if (block.tool === "GetDashboard" && block.context?.dashboard_id) {
    const dashboardId = block.context.dashboard_id;
    return splitAroundHighlight(
      t("aiAssistant.aiChat.toolGetDashboard", { id: dashboardId }),
      dashboardId,
    );
  }
  // List tools: show count from normalized { total, items } response
  if (block.response?.total !== undefined && block.success !== false) {
    const base = block.message || block.tool || t("aiAssistant.aiChat.toolListedFallback");
    return {
      text: base + " ",
      highlight: t("aiAssistant.aiChat.toolFoundCount", { count: block.response.total }),
      suffix: "",
    };
  }
  if (block.success === false && block.resultMessage) {
    const msg =
      block.resultMessage.length > 60
        ? block.resultMessage.substring(0, 60) + "..."
        : block.resultMessage;
    return { text: msg, highlight: null, suffix: "" };
  }
  if (block.success !== false && block.summary?.count !== undefined) {
    const base = block.message || block.tool || t("aiAssistant.aiChat.toolFallback");
    return {
      text: base + " ",
      highlight: t("aiAssistant.aiChat.toolResultsCount", { count: block.summary.count }),
      suffix: "",
    };
  }
  return { text: block.message, highlight: null, suffix: "" };
}
