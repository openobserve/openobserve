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
  doorChip,
  finish,
  ident,
  inline,
  num,
  promptRange,
  type PromptBuild,
  type PromptRange,
} from "./format";
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
