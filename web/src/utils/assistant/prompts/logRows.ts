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
  promptRange,
  rowTimeMs,
  type PromptBuild,
} from "./format";
import { modeText, type LogRowInput } from "./logRow";

export { MAX_EXPLAIN_BYTES, MAX_EXPLAIN_ROWS, rowsOverCap } from "./caps";

export type LogRowsInput = Omit<LogRowInput, "row" | "source"> & {
  rows: Record<string, unknown>[];
};

/** The query that brings these rows back: the stream bounded by the rows' own timestamps in `WHERE`. */
export function reproducingQuery(input: LogRowsInput): string {
  const field = input.timestampField ?? "_timestamp";
  const times = input.rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === "number" && rowTimeMs(value) !== null);
  const where = [
    input.mode === "filter" && input.query?.trim() ? `(${input.query.trim()})` : null,
    times.length ? `${field} >= ${Math.min(...times)} AND ${field} <= ${Math.max(...times)}` : null,
  ].filter(Boolean);
  const from = `SELECT * FROM "${input.stream.replace(/"/g, '""')}"`;
  return where.length ? `${from} WHERE ${where.join(" AND ")}` : from;
}

/** Explain these {n} rows: one `log_row` chip holding the rows, the query and the reproducing query; `n` counts the rows that fit. */
export function buildLogRowsPrompt(input: LogRowsInput, t: TranslateFn = gt): PromptBuild {
  const stream = inline(input.stream, 60);
  const chip = doorChip({
    kind: "log_row",
    key: `${input.org}|${input.stream}|${JSON.stringify(input.rows)}`,
    label: raw(""),
    short: raw(stream),
    secondary: raw(promptRange(input.range, input.timeZone)),
    ref: {
      type: "log_rows",
      org: input.org,
      stream: input.stream,
      streamType: input.streamType ?? "logs",
      from: input.range.from,
      to: input.range.to,
      ...(input.route && { route: input.route }),
    },
    data: input.rows,
    count: input.rows.length,
    sent: "serialized",
  });
  const n = Array.isArray(chip.data) ? chip.data.length : 1;
  const label = t("assistant.context.chip.logRows", { count: n, name: raw(stream) }, n);
  const query = doorChip({
    kind: "query",
    key: `${chip.id}|reproduce`,
    label: t("assistant.entry.chip.reproduce"),
    ref: {
      type: "log_rows_query",
      org: input.org,
      stream: input.stream,
      from: input.range.from,
      to: input.range.to,
    },
    data: {
      language: input.mode === "sql" ? "SQL" : "filter",
      ...(input.query?.trim() && { query: input.query }),
      reproduce: reproducingQuery(input),
    },
    sent: "serialized",
  });
  const name = ident(input.stream);
  const text = finish([
    name
      ? `Explain these ${n} log rows from \`${name}\`.`
      : `Explain these ${n} log rows; their stream is named in the attached Log row block.`,
    `They were selected over ${promptRange(input.range, input.timeZone)} (${modeText(input.mode)}).`,
    "The query that selected them and a query that reproduces them are in the attached Query block.",
    "What do they have in common, what differs, and what is the likely cause?",
  ]);
  return { text, chips: [{ ...chip, label }, query], title: label };
}
