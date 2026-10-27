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

import {
  resolveLogSeverity,
  resolveSeverityFieldValue,
  SEVERITY_MESSAGE_FIELDS,
  SEVERITY_TIER1_FIELDS,
  type LogSeverityLevel,
} from "@/utils/logs/statusParser";
import { timestampToTimezoneDate } from "@/utils/timezone";

export const LOGS_ORDERS = ["newest", "oldest"] as const;
export type LogsOrder = (typeof LOGS_ORDERS)[number];

/** One rendered log line; `source` is the row exactly as the query returned it. */
export interface LogsPanelRow {
  key: string;
  time: number | null;
  timeText: string;
  level: LogSeverityLevel;
  message: string;
  source: Record<string, unknown>;
}

export interface LogsPanelFields {
  time: string | null;
  level: string | null;
  message: string | null;
}

export interface LogsPanelData {
  rows: LogsPanelRow[];
  fields: LogsPanelFields;
}

const setField = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const firstPresent = (rows: Record<string, unknown>[], names: readonly string[]): string | null => {
  const sample = rows.slice(0, 50);
  for (const name of names) {
    if (sample.some((row) => row?.[name] !== undefined && row?.[name] !== null)) return name;
  }
  return null;
};

/** Epoch numbers in s, ms, µs or ns and date strings, as milliseconds. */
export const toEpochMillis = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric > 1e17) return numeric / 1e6;
    if (numeric > 1e14) return numeric / 1e3;
    if (numeric > 1e11) return numeric;
    return numeric * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value.includes("T") || value.endsWith("Z") ? value : `${value}Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** The time, level and message columns: the configured ones, else the first well-known name the rows carry. */
export const resolveLogsFields = (
  config: any,
  rows: Record<string, unknown>[],
  timestampColumn: string,
): LogsPanelFields => ({
  time: setField(config?.logs_time_field) ?? firstPresent(rows, [timestampColumn, "timestamp"]),
  level: setField(config?.logs_level_field) ?? firstPresent(rows, SEVERITY_TIER1_FIELDS),
  message: setField(config?.logs_message_field) ?? firstPresent(rows, SEVERITY_MESSAGE_FIELDS),
});

const levelOf = (row: Record<string, unknown>, field: string | null): LogSeverityLevel => {
  if (!field) return resolveLogSeverity(row).level;
  const value = row?.[field];
  if (value === null || value === undefined || value === "") return "unknown";
  // A configured column of any name is read as a level column, so `lvl` = "warn" still colours.
  return (
    resolveSeverityFieldValue("level", value)?.level ??
    resolveSeverityFieldValue(field, value)?.level ??
    "unknown"
  );
};

const messageOf = (row: Record<string, unknown>, fields: LogsPanelFields): string => {
  if (fields.message) return toText(row?.[fields.message]);
  const rest = { ...row };
  if (fields.time) delete rest[fields.time];
  return JSON.stringify(rest);
};

/** Log lines from the first visible query's rows, ordered by time per `logs_order`. */
export const convertLogsPanelData = (panelSchema: any, data: any, store: any): LogsPanelData => {
  const queryIndex = (panelSchema?.queries ?? []).findIndex((query: any) => !query?.config?.hide);
  const raw = Array.isArray(data?.[Math.max(queryIndex, 0)]) ? data[Math.max(queryIndex, 0)] : [];
  const source = raw.filter((row: unknown) => row && typeof row === "object");
  const timestampColumn = store?.state?.zoConfig?.timestamp_column || "_timestamp";
  const fields = resolveLogsFields(panelSchema?.config, source, timestampColumn);
  const timezone = store?.state?.timezone || "UTC";
  const rows: LogsPanelRow[] = source.map((row: Record<string, unknown>, index: number) => {
    const time = fields.time ? toEpochMillis(row[fields.time]) : null;
    return {
      key: String(index),
      time,
      timeText: time === null ? "" : timestampToTimezoneDate(time, timezone),
      level: levelOf(row, fields.level),
      message: messageOf(row, fields),
      source: row,
    };
  });
  const order: LogsOrder = panelSchema?.config?.logs_order === "oldest" ? "oldest" : "newest";
  const direction = order === "newest" ? -1 : 1;
  rows.sort((a, b) => {
    if (a.time === null || b.time === null) return a.time === null ? (b.time === null ? 0 : 1) : -1;
    return (a.time - b.time) * direction;
  });
  return { rows, fields };
};

const parseJsonText = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!(text.startsWith("{") || text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
};

/** A row as JSON: indented with JSON-string columns expanded when prettified, else one line as stored. */
export const logRowJson = (row: Record<string, unknown>, prettify: boolean): string => {
  if (!prettify) return JSON.stringify(row);
  const expanded = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, parseJsonText(value)]),
  );
  return JSON.stringify(expanded, null, 2);
};
