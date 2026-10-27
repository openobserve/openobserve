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

import type { PageContext, PageTimeRange } from "@/composables/contextProviders/types";
import { gt, raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatBytes, formatOrgRange, uiIntlLocale } from "@/utils/formatters";

import type { ComposerState } from "../assistantStore.types";
import { periodText } from "../useAssistantStarters";
import type { ChipKind, ContextChip } from "./types";

/** The agent's whitelist (`ai:src/server/context/o2ai_context.py:37-87`); every other field is not read. */
export const WHITELIST_FIELDS = [
  "org_id",
  "organization_identifier",
  "currentPage",
  "selectedStreams",
  "streamType",
  "timeRange",
  "currentSQLQuery",
  "currentVRLQuery",
  "dashboardId",
  "panelId",
  "alertId",
  "pipelineId",
  "request_timestamp",
  "user_timezone",
] as const;

/** 20 rows or 32 KB of attached data per message (CT §0.3). */
export const MAX_ATTACHED_ROWS = 20;

export const MAX_ATTACHED_BYTES = 32 * 1024;

/** The page time the tray assumes when a page has no picker (CT-01 AC 2). */
export const DEFAULT_PERIOD = "15m";

/** Row fields shown greyed and dropped from the wire while "Hide internal fields" is on (CT-03 AC 1–2). */
export const INTERNAL_FIELDS: ReadonlySet<string> = new Set(["_o2_id", "_original"]);

/** Persisted English block names (constraint 22): never translated, so old and new prompts stay stable. */
export const SERIALIZED_KINDS: Readonly<Partial<Record<ChipKind, string>>> = {
  log_row: "Log row",
  cell: "Cell",
  field: "Field",
  span: "Span",
  query_error: "Query error",
  report: "Report",
};

/** Door chips of these kinds carry observed values the prompt text must not hold, so they are serialised too; page chips of the same kinds are not. */
export const DOOR_SERIALIZED_KINDS: Readonly<Partial<Record<ChipKind, string>>> = {
  panel: "Panel",
  alert: "Alert",
  query: "Query",
};

/** The block name a chip is serialised under, or `undefined` when it never reaches the message body. */
export function serializedNameOf(chip: ContextChip): string | undefined {
  return (
    SERIALIZED_KINDS[chip.kind] ??
    (chip.provenance === "door" ? DOOR_SERIALIZED_KINDS[chip.kind] : undefined)
  );
}

/** Kinds that count as rows against the 20-row cap. */
export const ROW_KINDS: ReadonlySet<ChipKind> = new Set(["log_row", "cell", "span"]);

/** Kinds whose label reads "Kind · {name}": below md the icon shows the kind, so only the name is shown (CT-01 AC 9). */
export const NAMED_KINDS: ReadonlySet<ChipKind> = new Set([
  "stream",
  "query",
  "panel",
  "alert",
  "pipeline_node",
  "incident",
  "field",
  "span",
  "query_error",
]);

// Provider fields that route or label a page and are never context the assistant could read.
const HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "pageTitle",
  "routeName",
  "routePath",
  "routeFullPath",
  "routeParams",
  "routeQuery",
  "timestamp",
  "error",
  "agent_type",
  "alertName",
  "pipelineName",
  "dashboardName",
  "panelName",
  "incident_title",
]);

const WHITELIST: ReadonlySet<string> = new Set(WHITELIST_FIELDS);

/** The look of a chip; the `assistantContext` badge group maps each to a variant (`40` §2.2). */
export type ChipState =
  "sent" | "not_read" | "custom" | "truncated" | "ghost" | "in_chat" | "used" | "hidden";

/** One provider field (or field pair) → its chip, its "What the assistant sees" row and its wire field. */
export interface ContextFieldRow {
  /** Provider fields the row reads; the first is the key in `removedPageKeys`. */
  fields: readonly string[];
  /** `null` when the field is listed but never becomes a tray chip (org, page, timezone). */
  chip: ChipKind | null;
  sent: "whitelist" | "not_read";
  labelKey: I18nKey;
}

/** The one table (`40` decision 1): tray chips, sees rows and wire fields all come from it. */
export const CONTEXT_FIELDS: readonly ContextFieldRow[] = [
  {
    fields: ["org_id", "organization_identifier"],
    chip: null,
    sent: "whitelist",
    labelKey: "assistant.context.field.org",
  },
  {
    fields: ["currentPage"],
    chip: null,
    sent: "whitelist",
    labelKey: "assistant.context.field.page",
  },
  {
    fields: ["timeRange"],
    chip: "time",
    sent: "whitelist",
    labelKey: "assistant.context.field.timeRange",
  },
  {
    fields: ["selectedStreams", "streamType"],
    chip: "stream",
    sent: "whitelist",
    labelKey: "assistant.context.field.streams",
  },
  {
    fields: ["currentSQLQuery"],
    chip: "query",
    sent: "whitelist",
    labelKey: "assistant.context.field.sql",
  },
  {
    fields: ["currentVRLQuery"],
    chip: "query",
    sent: "whitelist",
    labelKey: "assistant.context.field.vrl",
  },
  {
    fields: ["currentQuery"],
    chip: "query",
    sent: "not_read",
    labelKey: "assistant.context.field.traceQuery",
  },
  {
    fields: ["dashboardId", "panelId"],
    chip: "panel",
    sent: "whitelist",
    labelKey: "assistant.context.field.dashboard",
  },
  {
    fields: ["alertId"],
    chip: "alert",
    sent: "whitelist",
    labelKey: "assistant.context.field.alert",
  },
  {
    fields: ["pipelineId"],
    chip: "pipeline_node",
    sent: "whitelist",
    labelKey: "assistant.context.field.pipeline",
  },
  {
    fields: ["incident_id"],
    chip: "incident",
    sent: "not_read",
    labelKey: "assistant.context.field.incident",
  },
  {
    fields: ["request_timestamp"],
    chip: null,
    sent: "whitelist",
    labelKey: "assistant.context.field.requestTime",
  },
  {
    fields: ["user_timezone"],
    chip: null,
    sent: "whitelist",
    labelKey: "assistant.context.field.timezone",
  },
  {
    fields: ["quickMode"],
    chip: null,
    sent: "not_read",
    labelKey: "assistant.context.field.quickMode",
  },
  {
    fields: ["interestingFields"],
    chip: null,
    sent: "not_read",
    labelKey: "assistant.context.field.interestingFields",
  },
  {
    fields: ["sqlMode"],
    chip: null,
    sent: "not_read",
    labelKey: "assistant.context.field.sqlMode",
  },
];

/** A "What the assistant sees" row; `fields` are the `context` keys it stands for (CT-04 AC 10). */
export interface SeesRow {
  id: string;
  group: "sent" | "not_read";
  label: I18nText;
  value: I18nText;
  fields: string[];
}

/** The time chip's window in ms; `period` is set for relative windows. */
export interface TimeWindow {
  from: number;
  to: number;
  period?: string;
  source: "page" | "default" | "custom";
}

// A page chip's texts; `short` is the name alone, for the phone tray.
interface ChipLabel {
  label: I18nText;
  short?: I18nText;
  secondary?: I18nText;
}

/** Whether the agent reads a provider field today. */
export function isWhitelisted(field: string): boolean {
  return WHITELIST.has(field);
}

export function fieldRowOf(field: string): ContextFieldRow | undefined {
  return CONTEXT_FIELDS.find((row) => row.fields.includes(field));
}

/** The page chip a provider field produces, or `null` when it produces none (empty, not a chip field). */
export function contextChipFor(
  field: keyof PageContext,
  value: unknown,
  page: PageContext = { currentPage: "" },
  t: TranslateFn = gt,
): ContextChip | null {
  const row = fieldRowOf(String(field));
  if (!row?.chip || row.fields[0] !== field || row.chip === "time") return null;
  const label = pageChipLabel(row, value, page, t);
  if (!label) return null;
  return {
    id: `page:${String(field)}`,
    kind: row.chip,
    label: label.label,
    ...(label.short && { short: label.short }),
    ...(label.secondary && { secondary: label.secondary }),
    ref: { type: String(field), org: orgOf(page), ...refExtra(row, value, page) },
    data: value,
    sizeBytes: byteSize(value),
    provenance: "page",
    sent: row.sent,
  };
}

/** Every page chip of a context in table order, skipping the fields the user removed for this chat. */
export function pageChipsOf(
  page: PageContext | null,
  removed: readonly string[] = [],
  t: TranslateFn = gt,
): ContextChip[] {
  if (!page) return [];
  return CONTEXT_FIELDS.flatMap((row) => {
    const field = row.fields[0];
    if (removed.includes(field)) return [];
    const chip = contextChipFor(field, page[field], page, t);
    return chip ? [chip] : [];
  });
}

/** The ghost "Add back" chips of the removed page fields still on this page (CT-01 AC 7). */
export function ghostChipsOf(
  page: PageContext | null,
  removed: readonly string[],
  t: TranslateFn = gt,
): ContextChip[] {
  if (!page) return [];
  return removed.flatMap((field) => {
    const chip = contextChipFor(field, page[field], page, t);
    return chip ? [{ ...chip, id: `ghost:${field}` }] : [];
  });
}

/** The window the next message gets: the user's override, else the page's, else the default 15 min. */
export function timeWindowOf(
  page: PageContext | null,
  override: ComposerState["timeOverride"],
  now: number = Date.now(),
): TimeWindow {
  // A picked relative window ends at send time, so it never goes stale on the wire.
  if (override?.period)
    return {
      from: now - periodMs(override.period),
      to: now,
      period: override.period,
      source: "custom",
    };
  if (override) return { ...override, source: "custom" };
  const range = page?.timeRange;
  const relative = range?.type === "relative" ? range.relativeTimePeriod : undefined;
  const from = microsToMs(range?.startTime);
  const to = microsToMs(range?.endTime);
  if (relative && from !== undefined && to !== undefined)
    return { from, to, period: relative, source: "page" };
  if (from !== undefined && to !== undefined) return { from, to, source: "page" };
  return {
    from: now - periodMs(DEFAULT_PERIOD),
    to: now,
    period: DEFAULT_PERIOD,
    source: "default",
  };
}

/** "last 15 min" for a relative window, "13:43–13:58 IST" (org zone, minute precision) otherwise (CT-01 AC 3). */
export function timeRangeText(window: TimeWindow, t: TranslateFn = gt): I18nText {
  const period = window.period ? periodText(window.period, uiIntlLocale()) : null;
  if (period) return t("assistant.welcome.lastRange", { period: raw(period) });
  return raw(formatOrgRange(window.from, window.to));
}

/** The phone form of the range: "15 min", or the clock times without the zone (`40` §2.8). */
export function timeRangeShortText(window: TimeWindow): I18nText {
  const period = window.period ? periodText(window.period, uiIntlLocale()) : null;
  return raw(period ?? formatOrgRange(window.from, window.to).replace(/\s\S+$/, ""));
}

/** Chip 0: always present, never removable (CT-01 AC 1–2). */
export function timeChipOf(window: TimeWindow, org: string, t: TranslateFn = gt): ContextChip {
  const range = timeRangeText(window, t);
  const isDefault = window.source === "default";
  return {
    id: "page:timeRange",
    kind: "time",
    label: isDefault
      ? t("assistant.context.time.default")
      : t("assistant.context.time.page", { range }),
    ...(!isDefault && {
      secondary:
        window.source === "custom"
          ? t("assistant.context.time.custom")
          : t("assistant.context.time.fromPage"),
    }),
    ref: { type: "time", org, from: window.from, to: window.to },
    sizeBytes: 0,
    provenance: window.source === "custom" ? "picker" : "page",
    sent: "whitelist",
  };
}

/** The `PageTimeRange` the agent reads for a window (microseconds). */
export function wireTimeRange(window: TimeWindow): PageTimeRange {
  const startTime = Math.round(window.from * 1000);
  const endTime = Math.round(window.to * 1000);
  return window.period
    ? { type: "relative", relativeTimePeriod: window.period, startTime, endTime }
    : { type: "absolute", startTime, endTime };
}

export function chipStateOf(chip: ContextChip, opts: { ghost?: boolean } = {}): ChipState {
  if (opts.ghost) return "ghost";
  if (chip.kind === "time" && chip.provenance === "picker") return "custom";
  if (chip.sent === "not_read") return "not_read";
  if (chip.truncated?.length) return "truncated";
  return "sent";
}

/** The compact text of a chip whose label carries `name`; never an id or a field value, and always inside the label. */
export function shortLabelFor(
  kind: ChipKind,
  name: string | null | undefined,
): I18nText | undefined {
  return name && NAMED_KINDS.has(kind) ? raw(name) : undefined;
}

/** The secondary line a chip shows: the honest "not read yet" and "truncated" win over provenance. */
export function chipSecondaryOf(chip: ContextChip, t: TranslateFn = gt): I18nText | undefined {
  if (chip.sent === "not_read") return t("assistant.context.notReadYet");
  if (chip.truncated?.length)
    return t("assistant.context.truncated", { size: raw(formatBytes(MAX_ATTACHED_BYTES)) });
  return chip.secondary;
}

/** "What the assistant sees" for one page context, after removals and the time override (`40` §3). */
export function seesRowsOf(
  page: PageContext | null,
  opts: {
    removed?: readonly string[];
    window: TimeWindow;
    timezone: string;
    pageLabel?: (page: PageContext) => I18nText;
    t?: TranslateFn;
  },
): SeesRow[] {
  const t = opts.t ?? gt;
  const removed = new Set(opts.removed ?? []);
  const source: PageContext = page ?? { currentPage: "" };
  const rows: SeesRow[] = [];
  for (const row of CONTEXT_FIELDS) {
    if (removed.has(row.fields[0])) continue;
    const seen = seenRow(row, source, opts, t);
    if (seen) rows.push(seen);
  }
  for (const field of Object.keys(source)) {
    if (fieldRowOf(field) || HIDDEN_FIELDS.has(field) || WHITELIST.has(field)) continue;
    if (!isPresent(source[field])) continue;
    rows.push({
      id: field,
      group: "not_read",
      label: raw(humanize(field)),
      value: plainValue(source[field], t),
      fields: [field],
    });
  }
  return rows;
}

/** UTF-8 size of a value as its block body carries it: JSON-encoded, so quotes and escapes count (S5). */
export function byteSize(value: unknown): number {
  if (value === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

/** A value worth sending: not empty, blank, `[]` or `{}`; one rule for the wire and the sees rows (S11). */
export function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/** The browser's IANA zone, `UTC` when the platform cannot say. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** Fits the data in `cap`: drops trailing rows, then cuts the longest values first; the cut names go in `truncated` (CT-02 AC 8). */
export function truncateChip(chip: ContextChip, cap: number = MAX_ATTACHED_BYTES): ContextChip {
  if (chip.data === undefined || byteSize(chip.data) <= cap) return chip;
  if (Array.isArray(chip.data)) {
    const rows = [...chip.data];
    while (rows.length > 1 && byteSize(rows) > cap) rows.pop();
    const cut = rows.length < chip.data.length ? ["rows"] : [];
    if (byteSize(rows) > cap) {
      const fitted = fitValue(rows[0], cap - 2);
      rows[0] = fitted.value;
      cut.push(...fitted.cut);
    }
    return { ...chip, data: rows, count: rows.length, sizeBytes: byteSize(rows), truncated: cut };
  }
  const fitted = fitValue(chip.data, cap);
  return { ...chip, data: fitted.value, sizeBytes: byteSize(fitted.value), truncated: fitted.cut };
}

/** The data the wire gets: internal fields dropped from every row unless the user turned the trim off. */
export function wireDataOf(chip: ContextChip): unknown {
  const data = chip.data;
  if (chip.includeInternal) return data;
  return Array.isArray(data) ? data.map(withoutInternal) : withoutInternal(data);
}

/** The sees row value for the attached chips: "2 attachments · 3 KB". */
export function attachmentSummary(chips: readonly ContextChip[], t: TranslateFn = gt): I18nText {
  const bytes = chips.reduce((sum, chip) => sum + chip.sizeBytes, 0);
  return t(
    "assistant.context.attachmentsValue",
    { count: chips.length, size: raw(formatBytes(bytes)) },
    chips.length,
  );
}

/** `1h` → 3 600 000; an unknown period is 15 min. */
export function periodMs(period: string): number {
  const match = /^(\d+)([smhdwM])$/.exec(period);
  const unit: Record<string, number> = {
    s: 1e3,
    m: 6e4,
    h: 36e5,
    d: 864e5,
    w: 6048e5,
    M: 2592e6,
  };
  return match ? Number(match[1]) * unit[match[2]] : 15 * 6e4;
}

function seenRow(
  row: ContextFieldRow,
  page: PageContext,
  opts: { window: TimeWindow; timezone: string; pageLabel?: (page: PageContext) => I18nText },
  t: TranslateFn,
): SeesRow | null {
  const base = {
    id: row.fields[0],
    group: row.sent === "whitelist" ? ("sent" as const) : ("not_read" as const),
    label: t(row.labelKey),
  };
  const field = row.fields[0];
  if (field === "timeRange")
    return { ...base, value: timeRangeText(opts.window, t), fields: ["timeRange"] };
  if (field === "user_timezone")
    return { ...base, value: raw(opts.timezone), fields: ["user_timezone"] };
  if (field === "request_timestamp")
    return { ...base, value: t("assistant.context.atSend"), fields: ["request_timestamp"] };
  if (field === "currentPage")
    return {
      ...base,
      value: opts.pageLabel ? opts.pageLabel(page) : raw(page.currentPage),
      fields: ["currentPage"],
    };
  if (field === "org_id") {
    const org = orgOf(page);
    return org ? { ...base, value: raw(org), fields: ["org_id"] } : null;
  }
  const value = rowValue(row, page, t);
  if (value === null) return null;
  const fields = row.fields.filter((name) => isPresent(page[name]));
  return { ...base, value, fields };
}

function rowValue(row: ContextFieldRow, page: PageContext, t: TranslateFn): I18nText | null {
  const field = row.fields[0];
  const value = page[field];
  if (!isPresent(value)) return null;
  if (field === "selectedStreams") {
    const names = (value as string[]).join(", ");
    return t("assistant.context.streamsValue", {
      names: raw(names),
      type: raw(page.streamType ?? "logs"),
    });
  }
  if (
    typeof value === "string" &&
    (field === "currentSQLQuery" || field === "currentVRLQuery" || field === "currentQuery")
  )
    return t("assistant.context.lines", { count: lineCount(value) }, lineCount(value));
  return plainValue(value, t);
}

// A row's value as one line: on/off, the text, a list of plain items, else a dash for a structure.
function plainValue(value: unknown, t: TranslateFn): I18nText {
  if (typeof value === "boolean")
    return value ? t("assistant.context.valueOn") : t("assistant.context.valueOff");
  if (typeof value === "string" || typeof value === "number") return raw(String(value));
  if (Array.isArray(value) && value.every((item) => typeof item !== "object"))
    return raw(value.join(", "));
  return raw("—");
}

function pageChipLabel(
  row: ContextFieldRow,
  value: unknown,
  page: PageContext,
  t: TranslateFn,
): ChipLabel | null {
  if (!isPresent(value)) return null;
  const field = row.fields[0];
  const stream = firstStream(page);
  if (field === "selectedStreams") {
    const streams = value as string[];
    const label =
      streams.length === 1
        ? t("assistant.context.chip.stream", { name: raw(streams[0]) })
        : t("assistant.context.chip.streams", { count: streams.length }, streams.length);
    const short = streams.length === 1 ? shortLabelFor("stream", streams[0]) : undefined;
    return { label, ...(short && { short }), secondary: raw(page.streamType ?? "logs") };
  }
  if (field === "currentSQLQuery")
    return {
      ...(stream && { short: shortLabelFor(row.chip ?? "query", stream) }),
      label: stream
        ? t("assistant.context.chip.sql", { name: raw(stream) })
        : t(
            "assistant.context.chip.sqlLines",
            { count: lineCount(String(value)) },
            lineCount(String(value)),
          ),
    };
  if (field === "currentVRLQuery")
    return {
      label: t(
        "assistant.context.chip.vrl",
        { count: lineCount(String(value)) },
        lineCount(String(value)),
      ),
    };
  if (field === "currentQuery") return { label: t("assistant.context.chip.traceQuery") };
  return objectChipLabel(field, value, page, t);
}

function objectChipLabel(
  field: string,
  value: unknown,
  page: PageContext,
  t: TranslateFn,
): ChipLabel | null {
  // An object without its name is labelled by its id; the id never becomes the short text.
  const named = (key: I18nKey, kind: ChipKind, nameKey: string, fallback: unknown): ChipLabel => {
    const name = isPresent(page[nameKey]) ? String(page[nameKey]) : null;
    return {
      label: t(key, { name: raw(name ?? String(fallback)) }),
      short: shortLabelFor(kind, name),
    };
  };
  if (field === "dashboardId") {
    const dashboard = named("assistant.context.chip.dashboard", "panel", "dashboardName", value);
    if (isPresent(page.panelId))
      return {
        ...named("assistant.context.chip.panel", "panel", "panelName", page.panelId),
        secondary: dashboard.label,
      };
    return dashboard;
  }
  if (field === "alertId")
    return named("assistant.context.chip.alert", "alert", "alertName", value);
  if (field === "pipelineId")
    return named("assistant.context.chip.pipeline", "pipeline_node", "pipelineName", value);
  if (field === "incident_id")
    return named("assistant.context.chip.incident", "incident", "incident_title", value);
  return null;
}

function refExtra(
  row: ContextFieldRow,
  value: unknown,
  page: PageContext,
): Partial<NonNullable<ContextChip["ref"]>> {
  if (row.chip === "stream") {
    const stream = firstStream(page);
    return {
      ...(stream && { stream, id: stream }),
      ...(page.streamType && { streamType: page.streamType }),
    };
  }
  return typeof value === "string" && value ? { id: value } : {};
}

function orgOf(page: PageContext): string {
  return String(page.org_id || page.organization_identifier || "");
}

function firstStream(page: PageContext): string | null {
  const streams = page.selectedStreams;
  return Array.isArray(streams) && typeof streams[0] === "string" && streams[0] ? streams[0] : null;
}

function lineCount(text: string): number {
  return text.trim() ? text.trim().split("\n").length : 0;
}

function microsToMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value / 1000)
    : undefined;
}

// Cuts the largest values first (a structure becomes its cut JSON text) until the encoded value fits `cap`.
function fitValue(value: unknown, cap: number): { value: unknown; cut: string[] } {
  if (typeof value === "string") return { value: fitString(value, cap), cut: ["value"] };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { value: fitString(JSON.stringify(value) ?? "", cap), cut: ["value"] };
  const data: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const cut: string[] = [];
  const largest = Object.keys(data).sort((a, b) => byteSize(data[b]) - byteSize(data[a]));
  for (const key of largest) {
    const over = byteSize(data) - cap;
    if (over <= 0) break;
    const text = typeof data[key] === "string" ? String(data[key]) : JSON.stringify(data[key]);
    data[key] = fitString(text ?? "", Math.max(0, byteSize(text) - over - 32));
    cut.push(key);
  }
  return { value: data, cut };
}

function withoutInternal(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).filter(([key]) => !INTERNAL_FIELDS.has(key)),
  );
}

// The longest prefix (plus "…") whose JSON encoding fits `cap`; escapes make the encoding longer than the text.
function fitString(text: string, cap: number): string {
  if (byteSize(text) <= cap) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteSize(cutChars(text, mid)) <= cap) low = mid;
    else high = mid - 1;
  }
  return cutChars(text, low);
}

// A prefix of `n` characters plus "…", never splitting a surrogate pair.
function cutChars(text: string, n: number): string {
  if (n >= text.length) return text;
  const code = text.charCodeAt(n - 1);
  const end = n > 0 && code >= 0xd800 && code <= 0xdbff ? n - 1 : n;
  return `${text.slice(0, Math.max(0, end))}…`;
}

function humanize(field: string): string {
  const words = field
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
