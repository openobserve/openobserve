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
  promptClock,
  rowTimeMs,
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { REDACTED, isSecretKey } from "./redact";

/** One field of a log row, from a cell, `JsonPreview`, `DetailTable` or a dashboard cell drawer. */
export interface LogFieldInput {
  org: string;
  stream: string;
  streamType?: string;
  field: string;
  value: unknown;
  /** The row the field belongs to; only its id and time are read. */
  row?: Record<string, unknown>;
  timestampField?: string;
  range: PromptRange;
  timeZone: string;
  /** Set by the dashboard cell explorer: the panel the value came from goes in the chip. */
  panelTitle?: string;
}

// The chip label shows this much of the value; the chip's data carries all of it.
const LABEL_VALUE_CHARS = 40;

/** The value as a door may show and send it: a secret-named field's value is never kept. */
export function fieldValueOf(field: string, value: unknown): unknown {
  const shaped =
    value !== null &&
    value !== undefined &&
    value !== "" &&
    typeof value !== "number" &&
    typeof value !== "boolean";
  return isSecretKey(field) && shaped ? REDACTED : value;
}

/** The field chip "Field · {field} = {value}" (`kind: "field"`; the name always travels with the value). */
export function logFieldChip(
  input: LogFieldInput,
  t: TranslateFn = gt,
): PromptBuild["chips"][number] {
  const rowId = input.row ? String(input.row._o2_id ?? JSON.stringify(input.row)) : "";
  const value = fieldValueOf(input.field, input.value);
  const shown = inline(value, LABEL_VALUE_CHARS);
  return doorChip({
    kind: "field",
    key: `${input.org}|${input.stream}|${rowId}|${input.field}|${JSON.stringify(value)}`,
    label: t("assistant.context.chip.field", {
      name: raw(`${inline(input.field, 60)} = ${shown}`),
    }),
    short: raw(inline(input.field, 60)),
    ref: {
      type: "log_field",
      org: input.org,
      stream: input.stream,
      streamType: input.streamType ?? "logs",
      from: input.range.from,
      to: input.range.to,
    },
    data: {
      field: input.field,
      value,
      stream: input.stream,
      ...(input.panelTitle && { panel: input.panelTitle }),
    },
    sent: "serialized",
  });
}

/** Explain this field; the field's name and value, and any panel title, are only in the chip. */
export function buildLogFieldPrompt(input: LogFieldInput, t: TranslateFn = gt): PromptBuild {
  const chip = logFieldChip(input, t);
  const at = input.row ? rowTimeMs(input.row[input.timestampField ?? "_timestamp"]) : null;
  const when =
    at === null ? "" : ` at ${promptClock(at, input.timeZone)} ${zoneOf(input.timeZone)}`;
  const field = ident(input.field);
  const stream = ident(input.stream);
  const text = finish([
    field && stream
      ? `Explain the field \`${field}\` in this log row from \`${stream}\`${when}.`
      : `Explain the field in this log row${when}.`,
    input.panelTitle
      ? "Its name, value and the dashboard panel it came from are in the attached Field block."
      : "Its name and value are in the attached Field block.",
    "What does this value mean and is it expected?",
  ]);
  return { text, chips: [chip], title: chip.label };
}
