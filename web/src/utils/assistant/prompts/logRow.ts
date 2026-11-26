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

import type { RouteTarget } from "@/composables/assistant";
import { gt, raw, type TranslateFn } from "@/types/i18n";

import {
  doorChip,
  finish,
  ident,
  inline,
  promptClock,
  promptRange,
  queryChip,
  rowTimeMs,
  type PromptBuild,
  type PromptRange,
} from "./format";

/** What the Logs page knows about a row when a door fires. */
export interface LogRowInput {
  org: string;
  stream: string;
  streamType?: string;
  row: Record<string, unknown>;
  /** `zoConfig.timestamp_column`; `_timestamp` when the org never changed it. */
  timestampField?: string;
  range: PromptRange;
  timeZone: string;
  /** The query as the user wrote it; attached as a Query block, never written into the prompt. */
  query?: string;
  mode: "sql" | "filter";
  route?: RouteTarget;
  /** The function-test and pipeline-preview variants name what produced the row. */
  source?: { kind: "function" | "pipeline"; name: string };
}

/** "SQL mode" or "filter mode": the prompt says which, so the answer edits the right thing. */
export function modeText(mode: "sql" | "filter"): string {
  return mode === "sql" ? "SQL mode" : "filter mode";
}

/** The row's chip: "Log row · {stream} · {HH:mm:ss}", the row as its data. */
export function logRowChip(input: LogRowInput, t: TranslateFn = gt): PromptBuild["chips"][number] {
  const at = rowTimeMs(input.row[input.timestampField ?? "_timestamp"]);
  const time = at === null ? null : promptClock(at, input.timeZone);
  const stream = inline(input.stream, 60);
  const label = time
    ? t("assistant.context.chip.logRow", { name: raw(stream), time: raw(time) })
    : t("assistant.entry.chip.logRow", { name: raw(stream) });
  return doorChip({
    kind: "log_row",
    key: `${input.org}|${input.stream}|${JSON.stringify(input.row)}`,
    label,
    short: raw(stream),
    ref: {
      type: "log_row",
      org: input.org,
      stream: input.stream,
      streamType: input.streamType ?? "logs",
      from: input.range.from,
      to: input.range.to,
      ...(input.route && { route: input.route }),
    },
    data: input.source ? { ...input.row, _source: input.source } : input.row,
    sent: "serialized",
  });
}

/** Explain this log row: only fixed copy, identifiers and numbers in the text; the row and query are chips. */
export function buildLogRowPrompt(input: LogRowInput, t: TranslateFn = gt): PromptBuild {
  const row = logRowChip(input, t);
  const query = input.query?.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.query,
          language: input.mode === "sql" ? "SQL" : "filter",
          stream: input.stream,
          range: input.range,
        },
        t,
      )
    : null;
  const stream = ident(input.stream);
  const type = ident(input.streamType ?? "logs") ?? "logs";
  const text = finish([
    stream
      ? `Explain this log row from stream \`${stream}\` (${type}).`
      : `Explain this log row (${type}); its stream is named in the attached Log row block.`,
    input.source && sourceSentence(input.source),
    `Time range: ${promptRange(input.range, input.timeZone)}.`,
    query && `The active query is in the attached Query block (${modeText(input.mode)}).`,
    "What happened, what is unusual about it, and what should I look at next?",
  ]);
  return { text, chips: query ? [row, query] : [row], title: row.label };
}

function sourceSentence(source: NonNullable<LogRowInput["source"]>): string {
  const name = ident(source.name);
  if (source.kind === "function")
    return name
      ? `This row is a test event for function \`${name}\`.`
      : "This row is a test event for the function named in the attached Log row block.";
  return name
    ? `This row is a preview row of pipeline \`${name}\`.`
    : "This row is a preview row of the pipeline named in the attached Log row block.";
}
