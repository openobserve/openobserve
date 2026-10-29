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

import type { Router } from "vue-router";
import type { Store } from "vuex";

import type { OpenAssistantArgs } from "@/composables/assistant/pure";
import type { LogRowInput } from "@/utils/assistant/prompts";

/** What every Logs door prompt reads from the page; built at click time, never at render. */
export type LogsDoorBase = Omit<LogRowInput, "row" | "source">;

type Payload = OpenAssistantArgs["payload"];

// A regex is written from one value; the test input takes this much of it.
const REGEX_SAMPLE_CHARS = 2_000;

interface LogsSearchShape {
  organizationIdentifier?: string;
  meta?: { sqlMode?: boolean };
  data?: {
    query?: unknown;
    editorValue?: unknown;
    stream?: { selectedStream?: string[]; streamType?: string };
    datetime?: { startTime?: number; endTime?: number };
  };
}

interface StoreShape {
  selectedOrganization?: { identifier?: string };
  timezone?: string;
  zoConfig?: { timestamp_column?: string };
}

/** The Logs page's stream, absolute window (µs → ms), zone, query and mode for a door's prompt. */
export function logsDoorBase(
  searchObj: LogsSearchShape,
  state: StoreShape,
  row?: Record<string, unknown>,
): LogsDoorBase {
  const sqlMode = !!searchObj.meta?.sqlMode;
  const data = searchObj.data ?? {};
  const query = String(
    (sqlMode ? data.editorValue || data.query : data.query || data.editorValue) ?? "",
  );
  const rowStream = typeof row?._stream_name === "string" ? row._stream_name : "";
  const now = Date.now();
  return {
    // The org the results were loaded under, so a page left over from another org is refused.
    org: searchObj.organizationIdentifier || state.selectedOrganization?.identifier || "",
    stream: rowStream || data.stream?.selectedStream?.[0] || "",
    streamType: data.stream?.streamType || "logs",
    range: {
      from: Math.round(Number(data.datetime?.startTime ?? 0) / 1000) || now - 15 * 60_000,
      to: Math.round(Number(data.datetime?.endTime ?? 0) / 1000) || now,
    },
    timeZone: state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    query,
    mode: sqlMode ? "sql" : "filter",
    timestampField: state.zoConfig?.timestamp_column || "_timestamp",
  };
}

/** Explain / Add to chat on one row; the builders load only when a door is used. */
export function logRowBuild(base: () => LogsDoorBase, row: Record<string, unknown>) {
  return async (): Promise<Payload> =>
    (await import("@/utils/assistant/prompts")).buildLogRowPrompt({ ...base(), row });
}

/** Explain these {n} rows: one chip, the reproducing query in the text. */
export function logRowsBuild(base: () => LogsDoorBase, rows: () => Record<string, unknown>[]) {
  return async (): Promise<Payload> =>
    (await import("@/utils/assistant/prompts")).buildLogRowsPrompt({ ...base(), rows: rows() });
}

/** Explain this field / Add field to chat: `{field, value}` with its row for the time and id. */
export function logFieldBuild(
  base: () => LogsDoorBase,
  field: string,
  value: unknown,
  row?: Record<string, unknown>,
) {
  return async (): Promise<Payload> =>
    (await import("@/utils/assistant/prompts")).buildLogFieldPrompt({
      ...base(),
      field,
      value,
      row,
    });
}

/** Create regex pattern from a value: the prompt waits for the regex drawer's dock, never the sidebar. */
export async function regexFieldHandoff(
  base: LogsDoorBase,
  field: string,
  sample: unknown,
  go: (handoff: { prompt: string; sample: string }) => void,
): Promise<void> {
  const [{ buildRegexFieldPrompt, fieldValueOf }, { queueDockStage }] = await Promise.all([
    import("@/utils/assistant/prompts"),
    import("@/composables/assistant"),
  ]);
  // A secret-named field's value is redacted here too, since the drawer's test value reaches the model's context.
  const value = fieldValueOf(field, sample);
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const build = buildRegexFieldPrompt({
    org: base.org,
    stream: base.stream,
    streamType: base.streamType,
    field,
    sample: text.slice(0, REGEX_SAMPLE_CHARS),
    range: base.range,
  });
  queueDockStage(
    "regex",
    { chips: build.chips, text: build.text },
    { entryKind: "object_verb", objectKind: "log_field" },
  );
  go({ prompt: build.text, sample: text.slice(0, REGEX_SAMPLE_CHARS) });
}

/** The regex hand-off's navigation: the drawer closes, the patterns page opens with the prompt and sample waiting. */
export function regexPatternsOpener(
  store: Store<any>,
  router: Router,
  close: () => void,
): (handoff: { prompt: string; sample: string }) => void {
  return (handoff) => {
    close();
    store.commit("setRegexPatternHandoff", { prompt: handoff.prompt, testValue: handoff.sample });
    void router.push({
      path: "/settings/regex_patterns",
      query: { org_identifier: store.state.selectedOrganization.identifier, from: "logs" },
    });
  };
}

/** Troubleshoot empty results: every selected stream, the absolute range, the mode. */
export function emptyResultBuild(base: () => LogsDoorBase, streams: () => string[]) {
  return async (): Promise<Payload> => {
    const page = base();
    return (await import("@/utils/assistant/prompts")).buildEmptyResultPrompt({
      org: page.org,
      streams: streams(),
      mode: page.mode,
      query: page.query ?? "",
      range: page.range,
      timeZone: page.timeZone,
    });
  };
}

/** Troubleshoot this query: the error as plain text in a chip, the query and range in the text. */
export function queryErrorBuild(
  base: () => LogsDoorBase,
  streams: () => string[],
  error: () => string,
) {
  return async (): Promise<Payload> => {
    const page = base();
    return (await import("@/utils/assistant/prompts")).buildQueryErrorPrompt({
      org: page.org,
      streams: streams(),
      streamType: page.streamType,
      language: page.mode === "sql" ? "SQL" : "filter",
      query: page.query ?? "",
      error: error(),
      range: page.range,
      timeZone: page.timeZone,
    });
  };
}

/** Help me set up ingestion: the org and the stream type, never the fix-my-filter prompt. */
export function noStreamBuild(org: () => string, streamType: () => string) {
  return async (): Promise<Payload> =>
    (await import("@/utils/assistant/prompts")).buildNoStreamPrompt({
      org: org(),
      streamType: streamType(),
    });
}

/** A cheap, stable key for the object behind an Add door, so its "In chat" tick never outlives it. */
export function rowKeyOf(row: Record<string, unknown>, timestampField = "_timestamp"): string {
  return String(
    row._o2_id ?? `${String(row._stream_name ?? "")}:${String(row[timestampField] ?? "")}`,
  );
}
