//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { reactive, ref } from "vue";
import type { LocationQuery, LocationQueryRaw, Router } from "vue-router";
import { b64DecodeUnicodeSafe, b64EncodeUnicode } from "@/utils/formatters";
import { decodeFtScan } from "@/utils/logs/freeTextScan";
import type {
  ExecutedRecordedEvent,
  PersistSurface,
  TimeSelection,
} from "@/composables/useLogs/useAutoRun";

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export const DEFAULT_ROWS_PER_PAGE = 50;

export const MAX_SHARED_PAGE = 1000;

export const LINE_LINK_PARAMS = ["log_stream", "log_ts", "log_id", "log_fp"];

/** C7b "view state" and "surface mode" rows: a write that changes only these replaces the history entry. */
export const VIEW_STATE_PARAMS = new Set([
  "refresh",
  "show_histogram",
  "columns",
  "rows",
  "page",
  "timezone",
  "visualization_data",
  "build_data",
  "logs_visualize_toggle",
  "cmp_pin",
  ...LINE_LINK_PARAMS,
]);

// `type` is transient: updateUrlQueryParams deletes it before writing.
const IGNORED_PARAMS = new Set(["type"]);

const SURFACES: PersistSurface[] = ["logs", "patterns", "visualize", "build"];

export const shownSearch = reactive<Record<PersistSurface, ShownEntry | null>>({
  logs: null,
  patterns: null,
  visualize: null,
  build: null,
});

/** `page` from the opened link, waiting for the first run to settle (C7 "Go to page N"). */
export const sharedPage = ref<number | null>(null);

export const sharedPageNotice = ref<{ page: number; lastPage: number | null } | null>(null);

let boundRouter: Router | null = null;

let historyStateProvider: () => LogsHistoryState = () => ({
  zoomStack: [],
  returnPreset: null,
  stackId: null,
  level: 0,
});

export type LogsUrlMode = "push" | "replace";

/** The executed-input rows of the C7b registry, as one run saw them. */
export interface ShownInputs {
  streams: string[];
  streamType: string;
  query: string;
  sqlMode: boolean;
  functionContent: string | null;
  quickMode: boolean;
  regions: string[];
  clusters: string[];
  definedSchemas: string;
  freeTextScan: Record<string, unknown> | undefined;
}

export interface ShownEntry {
  generation: number | null;
  inputs: ShownInputs;
  period: TimeSelection;
  bounds: { start_time: number; end_time: number } | null;
  page: number;
  rows: number | null;
}

/** Live values a record does not carry: the stream order on screen and the window a non-grid run resolved. */
export interface ShownLiveContext {
  selectedStreams?: string[];
  resolvedWindow?: { startTime: number; endTime: number } | null;
}

export interface LogsHistoryState {
  zoomStack: unknown[];
  returnPreset: string | null;
  stackId: string | null;
  level: number;
}

export function bindLogsUrlRouter(router: Router | null | undefined): void {
  if (router) boundRouter = router;
}

/** Item 4b replaces the provider with its zoom history; until then the state is neutral. */
export function setLogsHistoryStateProvider(provider: () => LogsHistoryState): void {
  historyStateProvider = provider;
}

export function resetShownSearch(): void {
  for (const surface of SURFACES) shownSearch[surface] = null;
}

/** The record a surface's URL and share link name; a surface that never ran falls back to the grid's. */
export function shownEntryFor(surface: PersistSurface): ShownEntry | null {
  return shownSearch[surface] ?? shownSearch.logs;
}

/** Displayed page and page size from the recorded hits request; a request asking one extra row (page count) is size + 1. */
export function pageFromRequest(req: unknown): { page: number; rows: number | null } {
  const query = (req as { query?: { from?: unknown; size?: unknown } } | null)?.query;
  const size = numberOr(query?.size, null);
  const from = numberOr(query?.from, 0) ?? 0;
  if (size === null || size <= 0) return { page: 1, rows: null };
  let rows: number | null = null;
  if (ROWS_PER_PAGE_OPTIONS.includes(size)) rows = size;
  else if (ROWS_PER_PAGE_OPTIONS.includes(size - 1)) rows = size - 1;
  return { page: rows === null ? 1 : Math.floor(from / rows) + 1, rows };
}

/** Sets `shownSearch[surface]` from item 2's record; true when it patches the entry already shown (same run). */
export function recordShownSearch(
  event: ExecutedRecordedEvent,
  live: ShownLiveContext = {},
): boolean {
  const surface = event.surface;
  const previous = shownSearch[surface];
  const signature = event.signature;
  const liveStreams = live.selectedStreams ?? [];
  const isGrid = surface === "logs";
  const fromReq = isGrid ? pageFromRequest(event.req) : { page: 1, rows: null };
  shownSearch[surface] = {
    generation: event.generation,
    inputs: {
      streams: sameMembers(liveStreams, signature.streams) ? [...liveStreams] : signature.streams,
      streamType: signature.streamType,
      query: signature.query,
      sqlMode: signature.sqlMode,
      functionContent: signature.transform,
      quickMode: signature.quickMode,
      regions: [...signature.regions],
      clusters: [...signature.clusters],
      definedSchemas: signature.definedSchemas,
      freeTextScan: signature.freeTextScan,
    },
    period: JSON.parse(JSON.stringify(signature.time)),
    bounds:
      (isGrid ? boundsFromRequest(event.req) : null) ??
      boundsFromTime(signature.time, live.resolvedWindow),
    page: fromReq.page,
    rows: fromReq.rows,
  };
  return previous !== null && event.generation !== null && previous.generation === event.generation;
}

/** Controlled fallback: before anything has run, the URL names the link the user opened. */
export function initShownSearchFromUrl(query: LocationQuery | Record<string, unknown>): void {
  resetShownSearch();
  const stream = firstString(query.stream);
  if (!stream && firstString(query.sql_mode) !== "true") return;
  const period = firstString(query.period);
  const from = numberOr(firstString(query.from), null);
  const to = numberOr(firstString(query.to), null);
  const time: TimeSelection = period
    ? { type: "relative", period }
    : { type: "absolute", startUs: from ?? 0, endUs: to ?? 0 };
  const encodedQuery = firstString(query.query);
  const fn = firstString(query.functionContent);
  const page = parseSharedPage(query.page);
  shownSearch.logs = {
    generation: null,
    inputs: {
      streams: stream ? stream.split(",") : [],
      streamType: firstString(query.stream_type) || "logs",
      query: encodedQuery ? b64DecodeUnicodeSafe(encodedQuery, "").trim() : "",
      sqlMode: firstString(query.sql_mode) === "true",
      functionContent: fn ? b64DecodeUnicodeSafe(fn, "") || null : null,
      quickMode: firstString(query.quick_mode) !== "false",
      regions: (firstString(query.regions) ?? "").split(",").filter(Boolean),
      clusters: (firstString(query.clusters) ?? "").split(",").filter(Boolean),
      definedSchemas: firstString(query.defined_schemas) ?? "",
      freeTextScan: (() => {
        const scan = decodeFtScan(firstString(query.ft_scan));
        return Object.keys(scan).length ? scan : undefined;
      })(),
    },
    period: time,
    bounds: from !== null && to !== null ? { start_time: from, end_time: to } : null,
    page: page ?? 1,
    rows: parseRowsParam(query.rows),
  };
}

/** `page` param: an integer 1–1000, else null. */
export function parseSharedPage(value: unknown): number | null {
  const raw = firstString(value);
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 && page <= MAX_SHARED_PAGE ? page : null;
}

/** `rows` param: one of the paginator's page sizes, else null. */
export function parseRowsParam(value: unknown): number | null {
  const raw = firstString(value);
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  const rows = Number(raw);
  return ROWS_PER_PAGE_OPTIONS.includes(rows) ? rows : null;
}

export function encodeColumns(fields: string[]): string {
  return b64EncodeUnicode(JSON.stringify(fields)) ?? "";
}

/** `columns` param: a b64 JSON array of field names (`[]` allowed), else null. */
export function decodeColumns(value: unknown): string[] | null {
  const raw = firstString(value);
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(b64DecodeUnicodeSafe(raw, "null"));
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return [...new Set(parsed as string[])];
  } catch {
    return null;
  }
}

/** Keys whose values differ between two URL queries, `type` ignored. */
export function changedParams(
  current: LocationQuery | Record<string, unknown>,
  next: LocationQueryRaw | Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  return [...keys].filter(
    (key) =>
      !IGNORED_PARAMS.has(key) &&
      normalized((current as Record<string, unknown>)[key]) !==
        normalized((next as Record<string, unknown>)[key]),
  );
}

/** The C7b rule: only view-state params changed → replace, else push. */
export function urlWriteMode(
  current: LocationQuery | Record<string, unknown>,
  next: LocationQueryRaw | Record<string, unknown>,
): LogsUrlMode {
  return changedParams(current, next).every((key) => VIEW_STATE_PARAMS.has(key))
    ? "replace"
    : "push";
}

/** The one logs URL writer (C7b, 4b R1): every write carries the history context; an identical query is not written. */
export function writeLogsUrl(mode: LogsUrlMode, query: LocationQueryRaw): Promise<unknown> {
  const router = boundRouter;
  if (!router) return Promise.resolve();
  if (changedParams(currentQuery(), query).length === 0) return Promise.resolve();
  const target = { query, state: { ...historyStateProvider() } as Record<string, any> };
  return mode === "replace" ? router.replace(target) : router.push(target);
}

/** Drops `log_*` from the address bar with a replace (permalink clear, Back hook). */
export function dropLineLinkParams(): Promise<unknown> {
  const query: LocationQueryRaw = { ...currentQuery() };
  let changed = false;
  for (const key of LINE_LINK_PARAMS) {
    if (key in query) {
      delete query[key];
      changed = true;
    }
  }
  return changed ? writeLogsUrl("replace", query) : Promise.resolve();
}

export function routeHasLineLink(query: LocationQuery | Record<string, unknown>): boolean {
  return LINE_LINK_PARAMS.some((key) => (query as Record<string, unknown>)[key] !== undefined);
}

/** Test hook: forgets the bound router and every recorded entry. */
export function resetLogsUrlForTests(): void {
  boundRouter = null;
  resetShownSearch();
  sharedPage.value = null;
  sharedPageNotice.value = null;
  historyStateProvider = () => ({ zoomStack: [], returnPreset: null, stackId: null, level: 0 });
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

function numberOr(value: unknown, fallback: number | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundsFromRequest(req: unknown): ShownEntry["bounds"] {
  const query = (req as { query?: { start_time?: unknown; end_time?: unknown } } | null)?.query;
  const start = numberOr(query?.start_time, null);
  const end = numberOr(query?.end_time, null);
  return start === null || end === null ? null : { start_time: start, end_time: end };
}

function boundsFromTime(
  time: TimeSelection,
  resolved: ShownLiveContext["resolvedWindow"],
): ShownEntry["bounds"] {
  if (time.type === "absolute") return { start_time: time.startUs, end_time: time.endUs };
  if (!resolved) return null;
  const start = numberOr(resolved.startTime, null);
  const end = numberOr(resolved.endTime, null);
  return start === null || end === null ? null : { start_time: start, end_time: end };
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === "string" ? value : undefined;
}

function normalized(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(",");
  return value === undefined || value === null ? "" : String(value);
}

function currentQuery(): LocationQuery {
  return boundRouter?.currentRoute.value?.query ?? {};
}
