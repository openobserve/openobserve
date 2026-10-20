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

import type { OpenAssistantArgs } from "@/composables/assistant/pure";
import type { PromptRange } from "@/utils/assistant/prompts";

type Payload = OpenAssistantArgs["payload"];

/** What a Traces door reads from the page; built at click time. */
export interface TracesDoorBase {
  org: string;
  stream: string;
  range: PromptRange;
  timeZone: string;
  filter: string;
  mode: "spans" | "traces";
}

interface TracesSearchShape {
  meta?: { searchMode?: string };
  data?: {
    editorValue?: unknown;
    stream?: { selectedStream?: { value?: string } };
    datetime?: { startTime?: number; endTime?: number };
  };
}

interface StoreShape {
  selectedOrganization?: { identifier?: string };
  timezone?: string;
}

/** The Traces page's stream, absolute window (µs → ms), zone, filter and mode. */
export function tracesDoorBase(searchObj: TracesSearchShape, state: StoreShape): TracesDoorBase {
  const data = searchObj.data ?? {};
  const now = Date.now();
  return {
    org: state.selectedOrganization?.identifier ?? "",
    stream: data.stream?.selectedStream?.value || "",
    range: {
      from: Math.round(Number(data.datetime?.startTime ?? 0) / 1000) || now - 15 * 60_000,
      to: Math.round(Number(data.datetime?.endTime ?? 0) / 1000) || now,
    },
    timeZone: state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    filter: String(data.editorValue ?? ""),
    mode: searchObj.meta?.searchMode === "spans" ? "spans" : "traces",
  };
}

/** Epoch ms from a trace timestamp in ns, µs or ms; `undefined` when it is not one. */
export function traceTimeMs(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n > 1e17) return Math.round(n / 1e6);
  return n > 1e14 ? Math.round(n / 1e3) : n;
}

export function traceRowBuild(base: () => TracesDoorBase, row: Record<string, unknown>) {
  return async (): Promise<Payload> => {
    const page = base();
    const errors = Number(row.errors ?? NaN);
    const status =
      typeof row.span_status === "string" && row.span_status
        ? row.span_status
        : Number.isFinite(errors)
          ? errors > 0
            ? "ERROR"
            : "OK"
          : undefined;
    const duration = Number(row.duration ?? NaN);
    const spans = Number(row.spans ?? NaN);
    return (await import("@/utils/assistant/prompts")).buildTracePrompt({
      org: page.org,
      traceId: String(row.trace_id ?? ""),
      service: String(row.service_name ?? ""),
      ...(Number.isFinite(spans) && { spanCount: spans }),
      ...(Number.isFinite(duration) && { durationMs: duration / 1000 }),
      ...(status && { status }),
      startedAt: traceTimeMs(row._start_time_ns ?? row.start_time ?? row._timestamp),
      timeZone: page.timeZone,
      range: page.range,
    });
  };
}

export function tracingSetupBuild() {
  return async (): Promise<Payload> =>
    (await import("@/utils/assistant/prompts")).buildTracingSetupPrompt();
}

/** Troubleshoot a Traces search that failed or found nothing; the error goes in a chip. */
export function tracingQueryBuild(base: () => TracesDoorBase, error: () => string) {
  return async (): Promise<Payload> => {
    const page = base();
    return (await import("@/utils/assistant/prompts")).buildTracingQueryPrompt({
      ...page,
      error: error() || undefined,
    });
  };
}

// Core span columns the prompt names on its own; everything else is an attribute.
const SPAN_CORE = new Set([
  "trace_id",
  "span_id",
  "service_name",
  "operation_name",
  "duration",
  "span_status",
  "status_message",
  "reference_parent_span_id",
  "start_time",
  "end_time",
  "events",
  "links",
]);

export function spanBuild(
  span: () => Record<string, unknown>,
  parentOperation: () => string | undefined,
  verb: "explain" | "troubleshoot",
  state: StoreShape,
) {
  return async (): Promise<Payload> => {
    const s = span();
    const from = traceTimeMs(s._start_time_ns ?? s.start_time) ?? Date.now() - 15 * 60_000;
    const to = traceTimeMs(s._end_time_ns ?? s.end_time) ?? from;
    const attributes = Object.fromEntries(
      Object.entries(s).filter(
        ([key, value]) =>
          !SPAN_CORE.has(key) &&
          !key.startsWith("_") &&
          value !== null &&
          value !== "" &&
          typeof value !== "object",
      ),
    );
    const duration = Number(s.duration ?? NaN);
    const error = String(s.status_message ?? "") || undefined;
    return (await import("@/utils/assistant/prompts")).buildSpanPrompt(
      {
        org: state.selectedOrganization?.identifier ?? "",
        traceId: String(s.trace_id ?? ""),
        spanId: String(s.span_id ?? ""),
        service: String(s.service_name ?? ""),
        operation: String(s.operation_name ?? ""),
        ...(Number.isFinite(duration) && { durationMs: duration / 1000 }),
        ...(typeof s.span_status === "string" && { status: s.span_status }),
        ...(parentOperation() && { parentOperation: parentOperation() }),
        ...(error && { error }),
        attributes,
        range: { from, to: Math.max(to, from) },
        timeZone: state.timezone || "UTC",
      },
      verb,
    );
  };
}
