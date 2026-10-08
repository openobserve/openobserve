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

import {
  freeTextRanges,
  phrasePlan,
  planFilter,
  quoteFreeTextPhrase,
  renderPlan,
  streamTextTarget,
  suggestRecovery,
  tokenLimitsFromConfig,
  type FilterPlan,
  type FreeTextContext,
  type FreeTextScanEntry,
  type RecoveryCards,
  type SchemaField,
  type StreamWithSchema,
  type TextRange,
  type TextSearchTarget,
} from "@/utils/query/freeTextFilter";

// Schemas older than this are re-read before text is rewritten, so a new field is never searched as a word.
export const FREE_TEXT_SCHEMA_MAX_AGE_MS = 10 * 60 * 1000;

const BLOCKED_TARGET: TextSearchTarget = { mode: "blocked", candidates: [] };

const freshSchemas = new Map<string, { at: number; stream: StreamWithSchema }>();
const failedSchemas = new Set<string>();

export interface FilterResolveContext extends FreeTextContext {
  /** Names the SQL-filter quoting loop double-quotes: the selected streams' sidebar fields. */
  knownFields: ReadonlySet<string>;
  /** False while a schema is missing or its refresh failed; the filter is then sent unchanged. */
  textEnabled?: boolean;
}

export interface FreeTextBlocked {
  streams: string[];
  plan: FilterPlan;
}

export interface FreeTextDecorations {
  ranges: TextRange[];
  hover: string;
}

export interface NoFtsStream {
  name: string;
  hasTextFields: boolean;
}

/** The slice of the logs search object these helpers read and write. */
export interface FreeTextSearchObj {
  organizationIdentifier?: string;
  meta: { sqlMode?: boolean; freeTextScan?: Record<string, FreeTextScanEntry> | null };
  data: {
    query: string;
    stream: {
      selectedStream: string[];
      selectedStreamFields: { name: string }[];
      streamType?: string;
    };
    streamResults?: { list?: StreamWithSchema[] } | null;
    freeTextBlocked?: FreeTextBlocked | null;
  };
}

export interface FreeTextZoConfig {
  default_fts_keys?: string[];
  inverted_index_min_token_length?: unknown;
  inverted_index_max_token_length?: unknown;
}

function schemaKey(searchObj: FreeTextSearchObj, stream: string): string {
  const type = searchObj.data.stream.streamType || "logs";
  return `${searchObj.organizationIdentifier ?? ""}/${type}/${stream}`;
}

function targetModeOf(targets: TextSearchTarget[]): TextSearchTarget["mode"] {
  if (targets.some((target) => target.mode === "fts")) return "fts";
  if (targets.some((target) => target.mode === "scan")) return "scan";
  return "blocked";
}

function streamEntry(searchObj: FreeTextSearchObj, name: string): StreamWithSchema | undefined {
  const fresh = freshSchemas.get(schemaKey(searchObj, name));
  if (fresh) return fresh.stream;
  return (searchObj.data.streamResults?.list ?? []).find((stream) => stream?.name === name);
}

/** Classifier and renderer inputs for the selected streams, from their full cached schemas. */
export function buildFilterContext(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
  options: { ignoreFailures?: boolean } = {},
): FilterResolveContext {
  const selected = searchObj.data.stream.selectedStream ?? [];
  const fieldNames = new Set<string>(selected);
  const targets: Record<string, TextSearchTarget> = {};
  let textEnabled = selected.length > 0;
  for (const name of selected) {
    const entry = streamEntry(searchObj, name);
    const failed = !options.ignoreFailures && failedSchemas.has(schemaKey(searchObj, name));
    if (!Array.isArray(entry?.schema) || failed) {
      textEnabled = false;
      continue;
    }
    for (const field of [...entry.schema, ...(entry.removedSchemaFields ?? [])]) {
      if (field?.name) fieldNames.add(field.name);
    }
    // Scan consent is recorded only by the scan card, which stays off until spike S1 sets its guard.
    targets[name] = streamTextTarget(entry, zoConfig?.default_fts_keys ?? [], undefined);
  }
  return {
    fieldNames,
    targets,
    tokenLimits: tokenLimitsFromConfig(zoConfig),
    freeTextScan: searchObj.meta.freeTextScan ?? {},
    knownFields: new Set(
      (searchObj.data.stream.selectedStreamFields ?? []).map((field) => field.name),
    ),
    textEnabled,
  };
}

/** The plan shared by every selected stream; the token gate applies when any of them has FTS. */
export function planStreamsFilter(
  raw: string,
  streams: string[],
  ctx: FilterResolveContext,
): FilterPlan {
  const targets = streams.map((stream) => ctx.targets[stream]);
  if (ctx.textEnabled === false || targets.length === 0 || targets.some((target) => !target)) {
    return { kind: "sql", filter: raw };
  }
  return planFilter(raw, ctx.fieldNames, {
    targetMode: targetModeOf(targets),
    tokenLimits: ctx.tokenLimits,
    allTargetsFts: targets.every((target) => target.mode === "fts"),
  });
}

/** True when a run would send something other than the typed filter: pure text or a rewritten mix. */
function rewritesInput(plan: FilterPlan, raw: string): boolean {
  return plan.kind === "freeText" || (plan.kind === "sql" && plan.filter !== raw);
}

export function markFreeTextBlocked(
  searchObj: FreeTextSearchObj,
  streams: string[],
  plan: FilterPlan,
): void {
  searchObj.data.freeTextBlocked = { streams: [...streams], plan };
}

/** Highlight source for a pure-text filter: its rendering for the first stream that can search text. */
export function freeTextHighlight(
  searchObj: FreeTextSearchObj,
  ctx: FilterResolveContext,
): string | null {
  if (searchObj.meta.sqlMode) return null;
  const streams = searchObj.data.stream.selectedStream ?? [];
  const plan = planStreamsFilter((searchObj.data.query ?? "").trim(), streams, ctx);
  if (plan.kind !== "freeText") return null;
  for (const stream of streams) {
    const rendered = renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields);
    if (rendered !== null) return rendered;
  }
  return null;
}

/** The filter a run sends when the planner rewrote the typed text; null when it is sent as typed. */
export function rewrittenFilter(
  searchObj: FreeTextSearchObj,
  ctx: FilterResolveContext,
): string | null {
  if (searchObj.meta.sqlMode) return null;
  const raw = (searchObj.data.query ?? "").trim();
  const streams = searchObj.data.stream.selectedStream ?? [];
  const plan = planStreamsFilter(raw, streams, ctx);
  if (plan.kind === "freeText") {
    const rendered = streams.map((stream) =>
      renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields),
    );
    // Text that renders per stream (a no-FTS arm is skipped) keeps that meaning only as typed.
    const [first] = rendered;
    return first != null && rendered.every((where) => where === first) ? first : null;
  }
  if (plan.kind !== "sql" || plan.filter === raw) return null;
  return renderPlan(plan, BLOCKED_TARGET, ctx.knownFields);
}

/** Per-stream WHERE for side requests such as field values; null unless the filter is pure text. */
export function freeTextWhereByStream(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): Map<string, string> | null {
  if (searchObj.meta.sqlMode) return null;
  const ctx = buildFilterContext(searchObj, zoConfig);
  const streams = searchObj.data.stream.selectedStream ?? [];
  const plan = planStreamsFilter((searchObj.data.query ?? "").trim(), streams, ctx);
  if (plan.kind !== "freeText") return null;
  // A stream that cannot search text keeps only the SQL nodes, which a pure-text filter has none of.
  return new Map(
    streams.map((stream) => [
      stream,
      renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields) ?? "",
    ]),
  );
}

/** The filter as parseable SQL: pure text becomes match_all, so a word never reads as a column. */
export function filterForParsing(raw: string, fieldNames: ReadonlySet<string>): string {
  const plan = planFilter(raw, fieldNames);
  if (plan.kind !== "freeText") return plan.filter;
  return renderPlan(plan, { mode: "fts", fields: ["_"] }, new Set()) ?? raw;
}

/** Editor ranges of the searched words and the hover naming the fields they are searched in. */
export function freeTextDecorations(
  searchObj: FreeTextSearchObj,
  ctx: FilterResolveContext,
  t: (key: string, params?: Record<string, unknown>) => string,
): FreeTextDecorations | null {
  if (searchObj.meta.sqlMode) return null;
  const raw = searchObj.data.query ?? "";
  const streams = searchObj.data.stream.selectedStream ?? [];
  const plan = planStreamsFilter(raw.trim(), streams, ctx);
  if (plan.kind !== "freeText") return null;
  const targets = streams.map((stream) => ctx.targets[stream]);
  const fields = [
    ...new Set(targets.flatMap((target) => (target?.mode === "fts" ? target.fields : []))),
  ];
  const rendered = freeTextHighlight(searchObj, ctx);
  if (fields.length === 0 || rendered === null) return null;
  const ranges = freeTextRanges(raw, ctx.fieldNames, {
    targetMode: targetModeOf(targets as TextSearchTarget[]),
    tokenLimits: ctx.tokenLimits,
  });
  const hover = [
    t("search.freeTextSearchedFields", { fields: fields.join(", ") }),
    t("search.freeTextRunsAs", { sql: rendered }),
  ].join("\n\n");
  return ranges.length ? { ranges, hover } : null;
}

/** Streams shown in the no-FTS panel, each marked by whether it has any text field at all. */
export function noFtsStreams(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): NoFtsStream[] {
  const blocked = searchObj.data.freeTextBlocked?.streams ?? [];
  const ctx = buildFilterContext(searchObj, zoConfig, { ignoreFailures: true });
  return blocked.map((name) => {
    const target = ctx.targets[name];
    return { name, hasTextFields: target?.mode !== "blocked" || target.candidates.length > 0 };
  });
}

export function noFtsRecoveryStreams(
  searchObj: FreeTextSearchObj,
  names: string[] = searchObj.data.freeTextBlocked?.streams ?? [],
): { name: string; schema: SchemaField[] }[] {
  return names.map((name) => ({ name, schema: streamEntry(searchObj, name)?.schema ?? [] }));
}

/** Post-error cards for a filter-mode run: Run as, else Search text. */
export function recoveryCardsFor(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): RecoveryCards {
  const none: RecoveryCards = { runSuggestion: null, freeTextCandidate: null };
  const raw = searchObj.data.query ?? "";
  if (searchObj.meta.sqlMode || raw.trim() === "") return none;
  const ctx = buildFilterContext(searchObj, zoConfig, { ignoreFailures: true });
  const streams = searchObj.data.stream.selectedStream ?? [];
  const allFts =
    streams.length > 0 && streams.every((stream) => ctx.targets[stream]?.mode === "fts");
  return suggestRecovery(raw, ctx.fieldNames, allFts);
}

/** Search-text recovery: durable match_all SQL when every stream has FTS, else a quoted phrase. */
export function searchTextReplacement(
  text: string,
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): string {
  const ctx = buildFilterContext(searchObj, zoConfig, { ignoreFailures: true });
  const streams = searchObj.data.stream.selectedStream ?? [];
  const fts = streams.map((stream) => ctx.targets[stream]).filter((t) => t?.mode === "fts");
  if (streams.length === 0 || fts.length !== streams.length) return quoteFreeTextPhrase(text);
  return renderPlan(phrasePlan(text), fts[0], ctx.knownFields) ?? quoteFreeTextPhrase(text);
}

/** Re-reads stale schemas before a run that rewrites the filter; a failed read sends it unchanged. */
export async function refreshFreeTextSchemas(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
  fetchStream: (name: string) => Promise<StreamWithSchema | null | undefined>,
  now: number = Date.now(),
): Promise<void> {
  if (searchObj.meta.sqlMode) return;
  const streams = searchObj.data.stream.selectedStream ?? [];
  const ctx = buildFilterContext(searchObj, zoConfig, { ignoreFailures: true });
  const raw = (searchObj.data.query ?? "").trim();
  if (!rewritesInput(planStreamsFilter(raw, streams, ctx), raw)) return;
  const stale = streams.filter((name) => {
    const fresh = freshSchemas.get(schemaKey(searchObj, name));
    return !fresh || now - fresh.at > FREE_TEXT_SCHEMA_MAX_AGE_MS;
  });
  await Promise.all(
    stale.map(async (name) => {
      const key = schemaKey(searchObj, name);
      try {
        const stream = await fetchStream(name);
        if (!Array.isArray(stream?.schema)) throw new Error("schema missing");
        freshSchemas.set(key, { at: now, stream: { ...stream, name } });
        failedSchemas.delete(key);
      } catch {
        failedSchemas.add(key);
      }
    }),
  );
}

/** Test hook: forgets refreshed and failed schemas. */
export function resetFreeTextSchemasForTests(): void {
  freshSchemas.clear();
  failedSchemas.clear();
}
