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

import type { I18nText, TranslateFn } from "@/types/i18n";
import { errorSpansDeepestFirst, spanErrorMessage } from "./traceErrorSummary";

type RawSpan = Record<string, unknown>;

export const SPAN_AI_EVENT_LIMIT = 20;
export const SPAN_AI_ATTRIBUTE_LIMIT = 50;
export const TRACE_AI_CRITICAL_LIMIT = 20;
export const TRACE_AI_ERROR_LIMIT = 50;

const SPAN_OWN_FIELDS = new Set([
  "span_id",
  "trace_id",
  "service_name",
  "operation_name",
  "duration",
  "span_status",
  "status_message",
  "events",
  "start_time",
  "end_time",
  "_start_time_ns",
  "_end_time_ns",
  "_timestamp",
]);

export interface AiChatHandoff {
  query: string;
  chipName: I18nText;
  newChat: true;
  autoSend: false;
  context: Record<string, unknown>;
}

export interface SpanAiInput {
  span: RawSpan;
  stream: string;
  traceStartTime: number;
  traceEndTime: number;
  operationP50Us: number | null;
  hasError: boolean;
}

export interface TraceAiInput {
  spans: RawSpan[];
  criticalPathSpanIds: Iterable<string>;
  rootOperation: string;
  traceId: string;
  stream: string;
  traceStartTime: number;
  traceEndTime: number;
}

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const formatMs = (us: number): string => String(Number((us / 1000).toFixed(2)));

const parseEvents = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(text(raw) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const spanSummary = (span: RawSpan) => ({
  span_id: text(span.span_id),
  service_name: text(span.service_name),
  operation_name: text(span.operation_name),
  duration_us: Number(span.duration) || 0,
  span_status: text(span.span_status),
  status_message: text(span.status_message),
});

const envelope = (
  query: string,
  chipName: I18nText,
  input: { traceId: string; stream: string; traceStartTime: number; traceEndTime: number },
  extra: Record<string, unknown>,
): AiChatHandoff => ({
  query,
  chipName,
  newChat: true,
  autoSend: false,
  context: {
    currentPage: "traces",
    streamType: "traces",
    selectedStreams: input.stream ? [input.stream] : [],
    traceId: input.traceId,
    traceStartTime: input.traceStartTime,
    traceEndTime: input.traceEndTime,
    ...extra,
  },
});

// Questions are model input, not screen copy: kept English, like the traces heatmap's Ask AI prompt.
const spanQuestion = (span: RawSpan, p50Us: number | null, hasError: boolean): string => {
  if (hasError) {
    const message = spanErrorMessage(span);
    return message ? `Why did this span fail with "${message}"?` : "Why did this span fail?";
  }
  const durationUs = Number(span.duration);
  if (p50Us !== null && p50Us > 0 && durationUs > p50Us) {
    return `Why did this span take ${formatMs(durationUs)} ms? Its operation's p50 is ${formatMs(p50Us)} ms.`;
  }
  return "What does this span do, and does anything about it look unusual?";
};

/** Ask AI hand-off for one span, matching the object the latency heatmap sends. */
export function buildSpanAiPayload(t: TranslateFn, input: SpanAiInput): AiChatHandoff {
  const { span, operationP50Us, hasError } = input;
  const attributes = Object.fromEntries(
    Object.entries(span)
      .filter(([key]) => !SPAN_OWN_FIELDS.has(key))
      .slice(0, SPAN_AI_ATTRIBUTE_LIMIT),
  );
  return envelope(
    spanQuestion(span, operationP50Us, hasError),
    t("traces.askAi.spanChip", { operation: text(span.operation_name) }),
    { ...input, traceId: text(span.trace_id) },
    {
      span: {
        ...spanSummary(span),
        operation_p50_us: operationP50Us,
        events: parseEvents(span.events).slice(0, SPAN_AI_EVENT_LIMIT),
        attributes,
      },
    },
  );
}

/** "Explain trace" hand-off: the slowest critical-path spans plus the error spans. */
export function buildTraceAiPayload(t: TranslateFn, input: TraceAiInput): AiChatHandoff {
  const byId = new Map(input.spans.map((span) => [text(span.span_id), span]));
  const criticalPath = [...new Set(input.criticalPathSpanIds)]
    .map((id) => byId.get(id))
    .filter((span): span is RawSpan => !!span)
    .map(spanSummary)
    .sort((a, b) => b.duration_us - a.duration_us)
    .slice(0, TRACE_AI_CRITICAL_LIMIT);
  const errors = errorSpansDeepestFirst(input.spans);
  const errorSpans = errors.slice(0, TRACE_AI_ERROR_LIMIT).map((error) => ({
    ...spanSummary(byId.get(error.spanId) ?? {}),
    message: error.message,
  }));
  const query = errors.length
    ? "Why did this trace fail, and where does its time go?"
    : "Where does this trace spend its time, and what makes it slow?";
  return envelope(query, t("traces.askAi.traceChip", { operation: input.rootOperation }), input, {
    trace_summary: {
      total_spans: input.spans.length,
      error_span_count: errors.length,
      critical_path: criticalPath,
      error_spans: errorSpans,
    },
  });
}
