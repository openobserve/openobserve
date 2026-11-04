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

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  buildSpanAiPayload,
  buildTraceAiPayload,
  SPAN_AI_ATTRIBUTE_LIMIT,
  SPAN_AI_EVENT_LIMIT,
  TRACE_AI_CRITICAL_LIMIT,
  TRACE_AI_ERROR_LIMIT,
} from "./traceAiPayload";

const t = i18n.global.t as unknown as TranslateFn;

const baseSpan = {
  span_id: "s1",
  trace_id: "tr1",
  service_name: "querier",
  operation_name: "service:search:grpc:flight::enter",
  duration: 2050,
  span_status: "UNSET",
  status_message: "",
  start_time: 1_000_000_000,
  end_time: 1_002_050_000,
  events: "[]",
  http_method: "GET",
};

const spanInput = (overrides: Record<string, unknown> = {}, extra = {}) => ({
  span: { ...baseSpan, ...overrides },
  stream: "default",
  traceStartTime: 100,
  traceEndTime: 200,
  operationP50Us: null as number | null,
  hasError: false,
  ...extra,
});

describe("buildSpanAiPayload", () => {
  it("sends the heatmap hand-off envelope with the span context", () => {
    const p = buildSpanAiPayload(t, spanInput({}, { operationP50Us: 900 }));
    expect(p.chipName).toBe("Span · service:search:grpc:flight::enter");
    expect(p.newChat).toBe(true);
    expect(p.autoSend).toBe(false);
    expect(p.context).toMatchObject({
      currentPage: "traces",
      streamType: "traces",
      selectedStreams: ["default"],
      traceId: "tr1",
      traceStartTime: 100,
      traceEndTime: 200,
      span: {
        span_id: "s1",
        service_name: "querier",
        operation_name: "service:search:grpc:flight::enter",
        duration_us: 2050,
        operation_p50_us: 900,
        span_status: "UNSET",
        status_message: "",
      },
    });
  });

  it("asks why a span slower than its operation p50 took that long, in ms", () => {
    const p = buildSpanAiPayload(t, spanInput({}, { operationP50Us: 900 }));
    expect(p.query).toBe("Why did this span take 2.05 ms? Its operation's p50 is 0.9 ms.");
  });

  it("asks why an error span failed, quoting its error message", () => {
    const p = buildSpanAiPayload(
      t,
      spanInput(
        { span_status: "ERROR", status_message: "deadline exceeded" },
        {
          operationP50Us: 900,
          hasError: true,
        },
      ),
    );
    expect(p.query).toBe('Why did this span fail with "deadline exceeded"?');
  });

  it("asks why an error span failed when it has no message", () => {
    const p = buildSpanAiPayload(t, spanInput({ span_status: "ERROR" }, { hasError: true }));
    expect(p.query).toBe("Why did this span fail?");
  });

  it.each([
    ["no p50", null],
    ["a span at or below p50", 2050],
    ["a span below p50", 5000],
  ])("asks a neutral question for %s", (_label, p50) => {
    const p = buildSpanAiPayload(t, spanInput({}, { operationP50Us: p50 }));
    expect(p.query).toBe("What does this span do, and does anything about it look unusual?");
    expect(p.context.span).toMatchObject({ operation_p50_us: p50 });
  });

  it("keeps the first 20 events and parses them from the stored JSON string", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ name: `e${i}` }));
    const p = buildSpanAiPayload(t, spanInput({ events: JSON.stringify(events) }));
    const sent = (p.context.span as { events: { name: string }[] }).events;
    expect(SPAN_AI_EVENT_LIMIT).toBe(20);
    expect(sent).toHaveLength(20);
    expect(sent[0].name).toBe("e0");
    expect(sent[19].name).toBe("e19");
  });

  it("sends no events for malformed event JSON", () => {
    const p = buildSpanAiPayload(t, spanInput({ events: "{not json" }));
    expect((p.context.span as { events: unknown[] }).events).toEqual([]);
  });

  it("keeps the first 50 attribute keys and leaves out the fields sent on their own", () => {
    const attrs = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`attr_${i}`, i]));
    const p = buildSpanAiPayload(t, spanInput(attrs));
    const sent = (p.context.span as { attributes: Record<string, unknown> }).attributes;
    expect(SPAN_AI_ATTRIBUTE_LIMIT).toBe(50);
    expect(Object.keys(sent)).toHaveLength(50);
    expect(sent.http_method).toBe("GET");
    for (const key of ["span_id", "operation_name", "duration", "events", "span_status"]) {
      expect(sent).not.toHaveProperty(key);
    }
  });

  it("sends no stream when the span has none", () => {
    const p = buildSpanAiPayload(t, spanInput({}, { stream: "" }));
    expect(p.context.selectedStreams).toEqual([]);
  });
});

const traceSpan = (i: number, overrides: Record<string, unknown> = {}) => ({
  span_id: `s${i}`,
  trace_id: "tr1",
  service_name: `svc${i}`,
  operation_name: `op${i}`,
  duration: i * 10,
  span_status: "UNSET",
  status_message: "",
  start_time: i,
  reference_parent_span_id: i === 0 ? "" : "s0",
  ...overrides,
});

const traceInput = (spans: Record<string, unknown>[], criticalPathSpanIds: string[]) => ({
  spans,
  criticalPathSpanIds,
  rootOperation: "GET /api/search",
  traceId: "tr1",
  stream: "default",
  traceStartTime: 100,
  traceEndTime: 900,
});

type Summary = {
  critical_path: { span_id: string; duration_us: number }[];
  error_spans: { span_id: string; message: string }[];
  total_spans: number;
  error_span_count: number;
};

describe("buildTraceAiPayload", () => {
  it("sends the hand-off envelope with the trace context", () => {
    const spans = [traceSpan(0), traceSpan(1)];
    const p = buildTraceAiPayload(t, traceInput(spans, ["s0"]));
    expect(p.chipName).toBe("Trace · GET /api/search");
    expect(p.newChat).toBe(true);
    expect(p.autoSend).toBe(false);
    expect(p.context).toMatchObject({
      currentPage: "traces",
      streamType: "traces",
      selectedStreams: ["default"],
      traceId: "tr1",
      traceStartTime: 100,
      traceEndTime: 900,
    });
    expect(p.query).toBe("Where does this trace spend its time, and what makes it slow?");
  });

  it("keeps only the 20 slowest critical-path spans, slowest first", () => {
    const spans = Array.from({ length: 40 }, (_, i) => traceSpan(i));
    const critical = spans.filter((_, i) => i % 2 === 0).map((s) => s.span_id);
    const summary = buildTraceAiPayload(t, traceInput(spans, critical)).context
      .trace_summary as Summary;
    expect(TRACE_AI_CRITICAL_LIMIT).toBe(20);
    expect(summary.critical_path).toHaveLength(20);
    expect(summary.critical_path[0]).toMatchObject({ span_id: "s38", duration_us: 380 });
    expect(summary.critical_path.every((s) => critical.includes(s.span_id))).toBe(true);
    expect(summary.total_spans).toBe(40);
  });

  it("counts a critical-path span once even when it has several sections", () => {
    const spans = [traceSpan(0), traceSpan(1)];
    const summary = buildTraceAiPayload(t, traceInput(spans, ["s0", "s1", "s0"])).context
      .trace_summary as Summary;
    expect(summary.critical_path.map((s) => s.span_id)).toEqual(["s1", "s0"]);
  });

  it("sends every error span up to 50 with its message, and asks why the trace failed", () => {
    const spans = [
      traceSpan(0),
      ...Array.from({ length: 60 }, (_, i) =>
        traceSpan(i + 1, { span_status: "ERROR", status_message: `boom ${i + 1}` }),
      ),
    ];
    const p = buildTraceAiPayload(t, traceInput(spans, ["s0"]));
    const summary = p.context.trace_summary as Summary;
    expect(TRACE_AI_ERROR_LIMIT).toBe(50);
    expect(summary.error_spans).toHaveLength(50);
    expect(summary.error_span_count).toBe(60);
    expect(summary.error_spans[0]).toMatchObject({ span_id: "s1", message: "boom 1" });
    expect(p.query).toBe("Why did this trace fail, and where does its time go?");
  });
});
