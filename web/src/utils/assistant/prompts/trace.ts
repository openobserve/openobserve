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
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";

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
