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

import { gt, raw, type TranslateFn } from "@/types/i18n";

import {
  count,
  doorChip,
  finish,
  ident,
  inline,
  num,
  promptClock,
  promptRange,
  queryChip,
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { errorPlainText } from "./logs";
import { withoutSecretKeys } from "./redact";

/** A span selected in the trace waterfall. */
export interface SpanInput {
  org: string;
  traceId: string;
  spanId: string;
  service: string;
  operation: string;
  durationMs?: number;
  status?: string;
  parentOperation?: string;
  /** The span's error message, when it has one. */
  error?: string;
  attributes?: Record<string, unknown>;
  /** The trace's window. */
  range: PromptRange;
  timeZone: string;
}

/** At most this many attributes travel with a span. */
export const MAX_SPAN_ATTRIBUTES = 20;

/** True when the span failed: an error status or an error attribute, so Troubleshoot comes first. */
export function spanHasError(input: Pick<SpanInput, "status" | "error" | "attributes">): boolean {
  if (input.error) return true;
  if (/^(error|2)$/i.test(String(input.status ?? ""))) return true;
  const attributes = input.attributes ?? {};
  return Object.keys(attributes).some(
    (key) => /^(error|exception)(\.|$)/i.test(key) && !!attributes[key],
  );
}

/** Explain or Troubleshoot this span; attributes and the error are observed data, so they are only in the chip. */
export function buildSpanPrompt(
  input: SpanInput,
  verb: "explain" | "troubleshoot",
  t: TranslateFn = gt,
): PromptBuild {
  const duration = input.durationMs === undefined ? null : `${num(input.durationMs)} ms`;
  const attributes = Object.fromEntries(
    Object.entries(withoutSecretKeys(input.attributes ?? {})).slice(0, MAX_SPAN_ATTRIBUTES),
  );
  const operation = ident(input.operation);
  const service = ident(input.service);
  const parent = input.parentOperation ? ident(input.parentOperation) : null;
  const status = input.status ? ident(input.status) : null;
  const facts = [
    duration,
    status ? `status ${status}` : null,
    parent ? `parent \`${parent}\`` : null,
  ].filter(Boolean);
  // Names that are not plain identifiers travel only in the chip, and the text says so.
  const attached = [
    !operation || !service || (input.parentOperation && !parent) ? "its names" : null,
    input.error ? "the error" : null,
    Object.keys(attributes).length ? "its attributes" : null,
  ].filter(Boolean);
  const name = [inline(input.service, 40), inline(input.operation, 60), duration]
    .filter(Boolean)
    .join(" · ");
  const chip = doorChip({
    kind: "span",
    key: `${input.org}|span|${input.traceId}|${input.spanId}`,
    label: t("assistant.context.chip.span", { name: raw(name) }),
    short: raw(inline(input.operation, 60)),
    ref: {
      type: "span",
      id: `${input.traceId}:${input.spanId}`,
      org: input.org,
      streamType: "traces",
      from: input.range.from,
      to: input.range.to,
    },
    data: {
      trace_id: input.traceId,
      span_id: input.spanId,
      service: input.service,
      operation: input.operation,
      ...(input.durationMs !== undefined && { duration_ms: input.durationMs }),
      ...(input.status && { status: input.status }),
      ...(input.parentOperation && { parent_operation: input.parentOperation }),
      ...(input.error && { error: input.error }),
      ...(Object.keys(attributes).length && { attributes }),
    },
    sent: "serialized",
  });
  const ids = [ident(input.traceId), ident(input.spanId)];
  const subject = [
    operation ? `span \`${operation}\`` : "this span",
    service ? `in service \`${service}\`` : null,
    ids[0] && ids[1] ? `(trace \`${ids[0]}\`, span \`${ids[1]}\`)` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const text = finish([
    `${verb === "troubleshoot" ? "Troubleshoot" : "Explain"} ${subject}${facts.length ? `: ${facts.join(", ")}` : ""}.`,
    attached.length
      ? `${capitalise(attached.join(" and "))} ${attached.length === 1 && attached[0] === "the error" ? "is" : "are"} in the attached Span block.`
      : null,
    `Window ${promptRange(input.range, input.timeZone)}.`,
    verb === "troubleshoot"
      ? "Why did it fail and what should I check next?"
      : "Why is it slow and what should I check next?",
  ]);
  return {
    text,
    chips: [chip],
    title: t("assistant.entry.chip.trace", { name: raw(inline(input.service, 60)) }),
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A row of the Traces result list. */
export interface TraceInput {
  org: string;
  traceId: string;
  service: string;
  spanCount?: number;
  durationMs?: number;
  /** "OK", "ERROR" or "UNSET" as the list shows it. */
  status?: string;
  startedAt?: number;
  timeZone: string;
  range: PromptRange;
}

export function buildTracePrompt(input: TraceInput, t: TranslateFn = gt): PromptBuild {
  const service = ident(input.service);
  const traceId = ident(input.traceId);
  const status = input.status ? ident(input.status) : null;
  const duration = input.durationMs === undefined ? null : `${num(input.durationMs)} ms`;
  const facts = [
    input.spanCount === undefined ? null : `${count(input.spanCount)} spans`,
    duration,
    status ? `status ${status}` : null,
    input.startedAt === undefined
      ? null
      : `started ${promptClock(input.startedAt, input.timeZone)} ${zoneOf(input.timeZone)}`,
  ].filter(Boolean);
  const label = inline(input.service, 60);
  const chipName = duration ? `${label} · ${duration}` : label;
  const chip = doorChip({
    kind: "span",
    key: `${input.org}|trace|${input.traceId}`,
    label: t("assistant.entry.chip.trace", { name: raw(chipName) }),
    short: raw(label),
    ref: {
      type: "trace",
      id: input.traceId,
      org: input.org,
      streamType: "traces",
      from: input.range.from,
      to: input.range.to,
    },
    data: {
      trace_id: input.traceId,
      service: input.service,
      ...(input.spanCount !== undefined && { spans: input.spanCount }),
      ...(input.durationMs !== undefined && { duration_ms: input.durationMs }),
      ...(input.status && { status: input.status }),
    },
    sent: "serialized",
  });
  const subject = [
    traceId ? `trace \`${traceId}\`` : "this trace",
    service ? `from service \`${service}\`` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const text = finish([
    `Explain ${subject}${facts.length ? `: ${facts.join(", ")}` : ""}.`,
    (!traceId || !service) && "Its id and service are in the attached Span block.",
    "Where is the time spent and is anything failing?",
  ]);
  return {
    text,
    chips: [chip],
    title: t("assistant.entry.chip.trace", { name: raw(label) }),
  };
}

/** A Traces search that failed or found nothing. */
export interface TracingQueryInput {
  org: string;
  mode: "spans" | "traces";
  /** The editor text as written: a WHERE-clause filter, or full SQL in SQL mode; empty means none. */
  filter: string;
  sqlMode?: boolean;
  stream: string;
  range: PromptRange;
  timeZone: string;
  /** The server's error, possibly HTML; absent when the search found nothing. */
  error?: string;
}

// The error chip names the error by its first characters, as on Logs.
const LABEL_CHARS = 40;

export function buildTracingSetupPrompt(t: TranslateFn = gt): PromptBuild {
  return {
    text: "I don't have any trace streams in OpenObserve yet and want to start sending traces. How do I instrument my services to send traces (e.g. via OpenTelemetry / OTLP)?",
    chips: [],
    title: t("assistant.entry.title.setUpTracing"),
  };
}

export function buildTracingQueryPrompt(
  input: TracingQueryInput,
  t: TranslateFn = gt,
): PromptBuild {
  const error = input.error ? errorPlainText(input.error) : "";
  const language = input.sqlMode ? "sql" : "filter";
  const errorChips = error
    ? [
        doorChip({
          kind: "query_error",
          key: `${input.org}|${input.stream}|${input.filter}|${error}`,
          label: t("assistant.context.chip.queryError", { name: raw(inline(error, LABEL_CHARS)) }),
          ref: {
            type: "query_error",
            org: input.org,
            stream: input.stream,
            streamType: "traces",
            from: input.range.from,
            to: input.range.to,
          },
          data: { error, language },
          sent: "serialized",
        }),
      ]
    : [];
  const filter = input.filter.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.filter,
          language,
          stream: input.stream,
          range: input.range,
        },
        t,
      )
    : null;
  const chips = filter ? [...errorChips, filter] : errorChips;
  const stream = ident(input.stream);
  const text = finish([
    error
      ? "The traces query produced an error; it is in the attached Query error block."
      : "The traces query ran successfully but returned no results.",
    `I am searching ${input.mode}.`,
    queryLine(!!filter, !!input.sqlMode),
    `${stream ? `Stream: \`${stream}\`. ` : ""}Time range: ${promptRange(input.range, input.timeZone)}.`,
    `Can you help me adjust ${input.sqlMode ? "the query" : "the filter"} to get results?`,
  ]);
  const title =
    chips[0]?.label ?? t("assistant.entry.title.emptyResult", { name: raw(input.stream) });
  return { text, chips, title };
}

function queryLine(hasQuery: boolean, sqlMode: boolean): string {
  if (sqlMode)
    return hasQuery ? "The SQL query is in the attached Query block." : "No query is set.";
  return hasQuery
    ? "The filter expression is in the attached Query block. It is a WHERE-clause filter, not a full SQL query."
    : "No filter is set.";
}

/** A selected edge of a service map, or a node when `target` is absent. */
export interface ServiceEdgeInput {
  org: string;
  source: string;
  target?: string;
  requests?: number;
  /** A fraction from 0 to 1. */
  errorRate?: number;
  p95Ms?: number;
  /** Node form: calls into and out of `source`. */
  inbound?: number;
  outbound?: number;
  range: PromptRange;
  timeZone: string;
}

/** Explain this dependency: an edge with its numbers, or a node with its call counts. */
export function buildServiceEdgePrompt(input: ServiceEdgeInput, t: TranslateFn = gt): PromptBuild {
  const window = promptRange(input.range, input.timeZone);
  const name = input.target
    ? `${inline(input.source, 40)} → ${inline(input.target, 40)}`
    : inline(input.source, 60);
  const facts = input.target
    ? [
        input.requests === undefined ? null : `${count(input.requests)} requests`,
        input.errorRate === undefined ? null : `error rate ${num(input.errorRate * 100)} %`,
        input.p95Ms === undefined ? null : `p95 ${num(input.p95Ms)} ms`,
      ]
    : [
        input.inbound === undefined ? null : `${count(input.inbound)} inbound`,
        input.outbound === undefined ? null : `${count(input.outbound)} outbound calls`,
      ];
  const present = facts.filter(Boolean);
  const source = ident(input.source);
  const target = input.target ? ident(input.target) : null;
  const named = !!source && (!input.target || !!target);
  const subject = input.target
    ? named
      ? `the dependency \`${source}\` → \`${target}\``
      : "the dependency in the attached Report block"
    : named
      ? `service \`${source}\``
      : "the service in the attached Report block";
  const chip = doorChip({
    kind: "report",
    key: `${input.org}|service|${name}`,
    label: t("assistant.entry.chip.service", { name: raw(name) }),
    short: raw(name),
    ref: { type: "service_edge", org: input.org, from: input.range.from, to: input.range.to },
    data: {
      source: input.source,
      ...(input.target && { target: input.target }),
      ...(input.requests !== undefined && { requests: input.requests }),
      ...(input.errorRate !== undefined && { error_rate_pct: input.errorRate * 100 }),
      ...(input.p95Ms !== undefined && { p95_ms: input.p95Ms }),
      ...(input.inbound !== undefined && { inbound: input.inbound }),
      ...(input.outbound !== undefined && { outbound: input.outbound }),
    },
    sent: "serialized",
  });
  const text = finish([
    `Explain ${subject} over ${window}${present.length ? `: ${present.join(", ")}` : ""}.`,
    "Is it healthy and what should I check?",
  ]);
  return {
    text,
    chips: [chip],
    title: t("assistant.entry.title.dependency", { name: raw(name) }),
  };
}
