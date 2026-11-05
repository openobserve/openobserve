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
  promptRange,
  type PromptBuild,
  type PromptRange,
} from "./format";

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
