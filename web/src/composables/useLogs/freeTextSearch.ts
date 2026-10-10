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

import type { I18nText } from "@/types/i18n";

import {
  freeTextRanges,
  phrasePlan,
  preserveFilterComments,
  type PlanNode,
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

export const FREE_TEXT_SCHEMA_MAX_AGE_MS = 10 * 60 * 1000;

const BLOCKED_TARGET: TextSearchTarget = { mode: "blocked", candidates: [] };

const freshSchemas = new Map<string, { at: number; stream: StreamWithSchema }>();
const failedSchemas = new Set<string>();

export interface FilterResolveContext extends FreeTextContext {
  knownFields: ReadonlySet<string>;
  textEnabled?: boolean;
}

export interface FreeTextBlocked {
  streams: string[];
  plan: FilterPlan;
}

export interface FreeTextDecorations {
  ranges: TextRange[];
  hover: I18nText;
}

export interface NoFtsStream {
  name: string;
  hasTextFields: boolean;
}

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
  quick_mode_num_fields?: number;
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
    targets[name] = streamTextTarget(
      entry,
      zoConfig?.default_fts_keys ?? [],
      undefined,
      undefined,
      zoConfig?.quick_mode_num_fields,
    );
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
    const [first] = rendered;
    return first !== null && first !== undefined && rendered.every((where) => where === first)
      ? preserveFilterComments(raw, first)
      : null;
  }
  if (plan.kind !== "sql" || plan.filter === raw) return null;
  const rendered = renderPlan(plan, BLOCKED_TARGET, ctx.knownFields);
  return rendered === null ? null : preserveFilterComments(raw, rendered);
}

export function freeTextWhereByStream(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): Map<string, string> | null {
  if (searchObj.meta.sqlMode) return null;
  const ctx = buildFilterContext(searchObj, zoConfig);
  const streams = searchObj.data.stream.selectedStream ?? [];
  const plan = planStreamsFilter((searchObj.data.query ?? "").trim(), streams, ctx);
  if (plan.kind !== "freeText") return null;
  return new Map(
    streams.map((stream) => [
      stream,
      renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields) ?? "FALSE",
    ]),
  );
}

export function filterForParsing(raw: string, fieldNames: ReadonlySet<string>): string {
  const plan = planFilter(raw, fieldNames);
  if (plan.kind !== "freeText") return plan.filter;
  return renderPlan(plan, { mode: "fts", fields: ["_"] }, new Set()) ?? raw;
}

export function freeTextDecorations(
  searchObj: FreeTextSearchObj,
  ctx: FilterResolveContext,
  t: (key: string, params?: Record<string, unknown>) => I18nText,
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
  const hover = t("search.freeTextPreview", { fields: fields.join(", "), sql: rendered });
  return ranges.length ? { ranges, hover } : null;
}

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

export function noFtsRecoveryTerm(
  searchObj: FreeTextSearchObj,
  zoConfig: FreeTextZoConfig | null | undefined,
): string {
  const plan = planFilter(searchObj.data.query.trim(), new Set(), {
    targetMode: "blocked",
    allTargetsFts: false,
    tokenLimits: tokenLimitsFromConfig(zoConfig),
  });
  if (plan.kind !== "freeText") return "";
  function firstPositive(node: PlanNode, excluded = false): string | null {
    if (node.k === "text") return excluded ? null : node.value;
    if (node.k === "sql") return null;
    if (node.k === "not") return firstPositive(node.child, !excluded);
    if (node.k === "group") return firstPositive(node.child, excluded);
    for (const child of node.children) {
      const value = firstPositive(child, excluded);
      if (value !== null) return value;
    }
    return null;
  }
  return firstPositive(plan.root) ?? "";
}

export function noFtsRecoveryStreams(
  searchObj: FreeTextSearchObj,
  names: string[] = searchObj.data.freeTextBlocked?.streams ?? [],
  zoConfig?: FreeTextZoConfig | null,
): { name: string; schema: SchemaField[]; recoveryRoot?: PlanNode }[] {
  const plan = planFilter(searchObj.data.query.trim(), new Set(), {
    targetMode: "blocked",
    allTargetsFts: false,
    tokenLimits: tokenLimitsFromConfig(zoConfig),
  });
  return names.map((name) => {
    const entry = streamEntry(searchObj, name);
    const defined = entry?.settings?.defined_schema_fields;
    const restricted =
      Array.isArray(defined) &&
      defined.length > 0 &&
      defined.length <= (zoConfig?.quick_mode_num_fields ?? 500);
    const schema = (entry?.schema ?? []).filter(
      (field) => !restricted || defined.includes(field.name) || field.name === "_timestamp",
    );
    return { name, schema, recoveryRoot: plan.kind === "freeText" ? plan.root : undefined };
  });
}

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

export function resetFreeTextSchemasForTests(): void {
  freshSchemas.clear();
  failedSchemas.clear();
}
