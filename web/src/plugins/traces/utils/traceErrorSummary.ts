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

type RawSpan = Record<string, unknown>;

export interface ErrorSpanSummary {
  spanId: string;
  serviceName: string;
  operationName: string;
  message: string;
}

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

const exceptionMessage = (rawEvents: unknown): string => {
  let events: unknown = rawEvents;
  if (typeof rawEvents === "string") {
    try {
      events = JSON.parse(rawEvents);
    } catch {
      return "";
    }
  }
  if (!Array.isArray(events)) return "";
  for (const event of events) {
    const message = text((event as RawSpan | null)?.["exception.message"]);
    if (message) return message;
  }
  return "";
};

const httpErrorCode = (span: RawSpan): string => {
  for (const field of ["http_status_code", "http_response_status_code"]) {
    const code = parseInt(String(span[field] ?? ""), 10);
    if (code >= 400) return String(code);
  }
  return "";
};

export interface SpanErrorText {
  /** First non-empty of status_message, exception.message, error_type; "" when none. */
  message: string;
  /** HTTP error code (4xx/5xx), or "" when the span has none. */
  code: string;
}

/** The error text sources of one span, shared by the Spans list and the trace detail. */
export const spanErrorText = (span: RawSpan): SpanErrorText => ({
  message: text(span.status_message) || exceptionMessage(span.events) || text(span.error_type),
  code: httpErrorCode(span),
});

/** The span's error message, else its HTTP error code. */
export const spanErrorMessage = (span: RawSpan): string => {
  const { message, code } = spanErrorText(span);
  return message || code;
};

const depthOf = (spanId: string, parentOf: Map<string, string>, cache: Map<string, number>) => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = spanId;
  let base = -1;
  while (current !== undefined && parentOf.has(current)) {
    const cached = cache.get(current);
    if (cached !== undefined) {
      base = cached;
      break;
    }
    // A parent cycle has no root; count it as one from where it closes.
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    current = parentOf.get(current);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    base += 1;
    cache.set(chain[i], base);
  }
  return cache.get(spanId) ?? 0;
};

/** Error spans ordered by span-tree depth, deepest first; ties go to the earliest start. */
export const errorSpansDeepestFirst = (spans: RawSpan[]): ErrorSpanSummary[] => {
  const parentOf = new Map<string, string>();
  for (const span of spans) {
    const id = text(span.span_id);
    if (id) parentOf.set(id, text(span.reference_parent_span_id));
  }
  const cache = new Map<string, number>();

  return spans
    .filter((span) => span.span_status === "ERROR")
    .map((span) => ({
      span,
      depth: depthOf(text(span.span_id), parentOf, cache),
      start: Number(span.start_time) || 0,
    }))
    .sort((a, b) => b.depth - a.depth || a.start - b.start)
    .map(({ span }) => ({
      spanId: text(span.span_id),
      serviceName: text(span.service_name),
      operationName: text(span.operation_name),
      message: spanErrorMessage(span),
    }));
};
