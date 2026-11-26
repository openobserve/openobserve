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
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { REDACTED, isSecretKey } from "./redact";

export { MAX_EXPLAIN_BYTES, MAX_EXPLAIN_ROWS, rowsOverCap } from "./ident";

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

/** A log field the user wants a regex pattern for; the sample is one observed value. */
export interface RegexFieldInput {
  org: string;
  stream: string;
  streamType?: string;
  /** Empty for a selection, which belongs to no single field. */
  field: string;
  sample: string;
  range?: PromptRange;
}

// The chip label shows this much of the sample; the chip's data carries all of it.
const LABEL_SAMPLE_CHARS = 40;

/** The `Field · {field} = {sample}` chip the regex dock receives with the prompt. */
export function regexFieldChip(
  input: RegexFieldInput,
  t: TranslateFn = gt,
): PromptBuild["chips"][number] {
  const shown = inline(input.sample, LABEL_SAMPLE_CHARS);
  const name = input.field ? `${input.field} = ${shown}` : shown;
  return doorChip({
    kind: "field",
    key: `${input.org}|${input.stream}|regex|${input.field}|${input.sample}`,
    label: t("assistant.context.chip.field", { name: raw(name) }),
    short: raw(input.field || shown),
    ref: {
      type: "log_field",
      org: input.org,
      stream: input.stream,
      streamType: input.streamType ?? "logs",
      ...(input.range && { from: input.range.from, to: input.range.to }),
    },
    data: { field: input.field, value: input.sample },
    sent: "serialized",
  });
}

/** The regex hand-off's prompt; the sample is observed data, so it travels only in the chip, and the prompt ends in its one question. */
export function buildRegexFieldPrompt(input: RegexFieldInput, t: TranslateFn = gt): PromptBuild {
  const chip = regexFieldChip(input, t);
  const where = input.field ? `, in field \`${inline(input.field)}\`` : "";
  const text = `Which regex matches values like the sample in the attached Field block${where}?`;
  return { text, chips: [chip], title: chip.label };
}

/** A failed query on Logs (or any page with `QueryErrorState`). */
export interface QueryErrorInput {
  org: string;
  streams: string[];
  streamType?: string;
  /** "SQL", "filter", "PromQL", "VRL": the language the user wrote. */
  language: string;
  query: string;
  /** The server's error, which may be HTML; only its text is kept. */
  error: string;
  range: PromptRange;
  timeZone: string;
}

// The chip label names the error by its first characters.
const LABEL_CHARS = 40;

/** The error as plain text, parsed on a detached document so no markup ever runs or renders. */
export function errorPlainText(error: string): string {
  if (!/[<&]/.test(error)) return error.trim();
  const doc = new DOMParser().parseFromString(error, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  doc.querySelectorAll("br").forEach((el) => el.replaceWith(" "));
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Troubleshoot this query: the error and the query are server output and user text, so both are chips. */
export function buildQueryErrorPrompt(input: QueryErrorInput, t: TranslateFn = gt): PromptBuild {
  const error = errorPlainText(input.error);
  const label = t("assistant.context.chip.queryError", { name: raw(inline(error, LABEL_CHARS)) });
  const chip = doorChip({
    kind: "query_error",
    key: `${input.org}|${input.streams.join(",")}|${input.query}|${error}`,
    label,
    ref: {
      type: "query_error",
      org: input.org,
      ...(input.streams[0] && { stream: input.streams[0] }),
      streamType: input.streamType ?? "logs",
      from: input.range.from,
      to: input.range.to,
    },
    data: { error, language: input.language, streams: input.streams },
    sent: "serialized",
  });
  const query = input.query.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.query,
          language: input.language,
          ...(input.streams[0] && { stream: input.streams[0] }),
          range: input.range,
        },
        t,
      )
    : null;
  const language = ident(input.language);
  const streams = input.streams.map(ident);
  const named = streams.length > 0 && streams.every(Boolean);
  const text = finish([
    `This ${language ? `${language} ` : ""}query failed${named ? ` on ${streams.map((s) => `\`${s}\``).join(", ")}` : ""} over ${promptRange(input.range, input.timeZone)}.`,
    "The error is in the attached Query error block.",
    query && "The query is in the attached Query block.",
    "What should I change?",
  ]);
  return { text, chips: query ? [chip, query] : [chip], title: label };
}

/** A Logs search that returned zero events. */
export interface EmptyResultInput {
  org: string;
  /** Every selected stream, not just the first. */
  streams: string[];
  mode: "sql" | "filter";
  query: string;
  range: PromptRange;
  timeZone: string;
}

/** Troubleshoot empty results: absolute range, every stream, SQL wording in SQL mode; the query is a chip. */
export function buildEmptyResultPrompt(input: EmptyResultInput, t: TranslateFn = gt): PromptBuild {
  const streams = input.streams.map(ident);
  const named = streams.length > 0 && streams.every(Boolean);
  const from = named ? ` from ${streams.map((s) => `\`${s}\``).join(", ")}` : "";
  const query = input.query.trim()
    ? queryChip(
        {
          org: input.org,
          query: input.query,
          language: input.mode === "sql" ? "SQL" : "filter",
          ...(input.streams[0] && { stream: input.streams[0] }),
          range: input.range,
        },
        t,
      )
    : null;
  const text = finish([
    `This ${input.mode === "sql" ? "SQL" : "filter"} query returned no rows${from} over ${promptRange(input.range, input.timeZone)}.`,
    query && "The query is in the attached Query block.",
    input.mode === "sql"
      ? "What in this SQL excludes rows?"
      : "Which part of the filter is too narrow?",
    "Suggest a change and the range to try.",
  ]);
  const name = input.streams.length
    ? input.streams.map((s) => inline(s, 40)).join(", ")
    : input.mode;
  return {
    text,
    chips: query ? [query] : [],
    title: t("assistant.entry.title.emptyResult", { name: raw(name) }),
  };
}

/** An org with no stream of a type yet (`LogsNoDataState`). */
export interface NoStreamInput {
  org: string;
  /** "logs", "metrics", "traces". */
  streamType: string;
  /** The platform the user picked, when the page knows it. */
  platform?: string;
}

/** Help me set up ingestion: a real setup question, never the fix-my-filter prompt. */
export function buildNoStreamPrompt(input: NoStreamInput, t: TranslateFn = gt): PromptBuild {
  const type = ident(input.streamType) ?? "logs";
  const org = ident(input.org);
  const platform = input.platform ? ident(input.platform) : null;
  const text = finish([
    org
      ? `There are no ${type} streams in organization \`${org}\` yet.`
      : `There are no ${type} streams in this organization yet.`,
    `How do I send my first ${type} to OpenObserve?`,
    platform && `I'm on ${platform}.`,
  ]);
  return { text, chips: [], title: t("assistant.entry.title.setUpIngestion") };
}
