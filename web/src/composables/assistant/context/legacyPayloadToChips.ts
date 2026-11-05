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
import { formatOrgTime } from "@/utils/formatters";

import type { OpenAssistantCall } from "../openAssistant";
import { byteSize, truncateChip } from "./contextChips";
import type { ContextChip } from "./types";

/** What a legacy `sendToAiChat` call stages: rows as chips, anything else as editable text (deleted in WP-15). */
export interface LegacyPayload {
  chips: ContextChip[];
  text?: string;
}

/** Maps a legacy payload (`string` or `{ query, autoSend }`) to chips and prompt text; a JSON row never lands in the text. */
export function legacyPayloadToChips(value: unknown, t: TranslateFn = gt): LegacyPayload {
  if (isWrapper(value)) return fromValue(value.query, t);
  return fromValue(value, t);
}

/** True for the object payload whose `autoSend` asked the legacy chat to send at once. */
export function legacyAutoSend(value: unknown, autoSend = false): boolean {
  if (isWrapper(value)) return value.autoSend === true;
  return autoSend;
}

/** The `openAssistant` call `MainLayout`'s v2 `sendToAiChat` forwards to; an auto-send still never sends over a draft. */
export function legacyRelayArgs(value: unknown, autoSend = false): OpenAssistantCall {
  const payload = legacyPayloadToChips(value);
  const base = {
    entryKind: "legacy_relay" as const,
    objectKind: payload.chips.length > 0 ? ("log_row" as const) : ("none" as const),
    payload,
    thread: "auto" as const,
  };
  return legacyAutoSend(value, autoSend)
    ? { ...base, intent: "send", entryVerb: "explain" }
    : { ...base, intent: "stage", entryVerb: "add_to_chat" };
}

// Only the top-level `{ query, autoSend }` wrapper is unwrapped; a row that merely has a `query` column stays a row (S2).
function isWrapper(value: unknown): value is { query: string; autoSend?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    typeof (value as { query?: unknown }).query === "string" &&
    keys.every((key) => key === "query" || key === "autoSend")
  );
}

function fromValue(value: unknown, t: TranslateFn): LegacyPayload {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (parsed === undefined) return value.trim() ? { chips: [], text: value } : { chips: [] };
    const rows = rowsOf(parsed);
    // A JSON value with no rows (`["a","b"]`) is kept as text rather than dropped.
    return rows.length > 0 ? { chips: [rowChip(rows, t)] } : { chips: [], text: value };
  }
  const rows = rowsOf(value);
  return rows.length > 0 ? { chips: [rowChip(rows, t)] } : { chips: [] };
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  const isRow = (row: unknown): row is Record<string, unknown> =>
    !!row && typeof row === "object" && !Array.isArray(row);
  if (Array.isArray(value)) return value.filter(isRow);
  return isRow(value) ? [value] : [];
}

function rowChip(rows: Record<string, unknown>[], t: TranslateFn): ContextChip {
  const first = rows[0];
  const stream = stringOf(first._stream_name ?? first.stream ?? first._stream);
  const at = timestampMs(first._timestamp);
  const time = at === null ? null : raw(formatOrgTime(at, { precision: "second" }));
  const data = rows.length === 1 ? first : rows;
  const cut = truncateChip({
    id: `legacy:${hash(JSON.stringify(data))}`,
    kind: "log_row",
    label: raw(""),
    ...(stream && { secondary: raw(stream) }),
    data,
    sizeBytes: byteSize(data),
    provenance: "door",
    ...(rows.length > 1 && { count: rows.length }),
    sent: "serialized",
  });
  // The label counts the rows that survive the cut, as the wire does (F10).
  const kept = Array.isArray(cut.data) ? cut.data.length : 1;
  return { ...cut, label: rowLabel(kept, stream, time, t) };
}

function rowLabel(
  count: number,
  stream: string | null,
  time: ReturnType<typeof raw> | null,
  t: TranslateFn,
) {
  if (count > 1)
    return stream
      ? t("assistant.context.chip.logRows", { count, name: raw(stream) }, count)
      : t("assistant.context.chip.logRowsPlain", { count }, count);
  if (stream && time) return t("assistant.context.chip.logRow", { name: raw(stream), time });
  if (time) return t("assistant.context.chip.logRowAt", { time });
  return t("assistant.context.chip.logRowPlain");
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// Row timestamps are microseconds; a value that cannot be a date gives no time in the label.
function timestampMs(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? Math.round(n / 1000) : n;
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
