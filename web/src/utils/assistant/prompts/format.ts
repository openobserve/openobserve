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
  MAX_ATTACHED_BYTES,
  byteSize,
  truncateChip,
  type ChipKind,
  type ContextChip,
} from "@/composables/assistant";
import { gt, type I18nText, type TranslateFn } from "@/types/i18n";

import { ident } from "./ident";
import { redactSecrets, redactText } from "./redact";

export { IDENT, ident } from "./ident";

/** A builder's output: the visible prompt, the typed chips and the thread title. */
export interface PromptBuild {
  text: string;
  chips: ContextChip[];
  title: I18nText;
}

export interface PromptRange {
  from: number;
  to: number;
}

/** Every prompt stays under this many words. */
export const MAX_PROMPT_WORDS = 200;

// A chip label shows at most this much of a value; the chip's data carries all of it.
const INLINE_CHARS = 160;

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "2026-10-14 13:57:46" in the org zone: model input is English and unambiguous, never the UI locale. */
export function promptTime(ts: number, timeZone: string): string {
  const parts = zoneParts(ts, zoneOf(timeZone));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function promptClock(ts: number, timeZone: string): string {
  const parts = zoneParts(ts, zoneOf(timeZone));
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

/** "2026-10-14 13:42:00–13:57:00 UTC", or both dates when the window crosses midnight; never "15m". */
export function promptRange(range: PromptRange, timeZone: string): string {
  const from = promptTime(range.from, timeZone);
  const to = promptTime(range.to, timeZone);
  const sameDay = from.slice(0, 10) === to.slice(0, 10);
  return `${from}–${sameDay ? to.slice(11) : to} ${zoneOf(timeZone)}`;
}

/** The zone a prompt names: a valid IANA identifier, else UTC, so the text never carries a free string. */
export function zoneOf(timeZone: string): string {
  if (!ident(timeZone)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The prompt sentences joined, then redacted once more as the last step. */
export function finish(parts: readonly (string | null | undefined | false)[]): string {
  return redactText(sentences(parts));
}

/** A label-safe version of a value: secrets redacted, no backtick, one line, capped; never for prompt text. */
export function inline(value: unknown, max: number = INLINE_CHARS): string {
  const text = redactText(String(value ?? ""))
    .replace(/`/g, "'")
    // eslint-disable-next-line no-control-regex -- control characters are what this strips
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function num(value: number): string {
  return NUMBER.format(value);
}

export function count(value: number): string {
  return WHOLE.format(value);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The present sentences joined by one space; an absent fact leaves no gap. */
export function sentences(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => !!part && part.trim() !== "").join(" ");
}

/** Short stable hash (FNV-1a, base 36) so the same object always gets the same chip id. */
export function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A row timestamp in ms: rows carry microseconds, a value that cannot be a date gives `null`. */
export function rowTimeMs(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? Math.round(n / 1000) : n;
}

/** A door chip: data redacted and capped at 32 KB, the id stable for the same object. */
export function doorChip(chip: {
  kind: ChipKind;
  key: string;
  label: I18nText;
  short?: I18nText;
  secondary?: I18nText;
  ref: NonNullable<ContextChip["ref"]>;
  data?: unknown;
  count?: number;
  sent: ContextChip["sent"];
}): ContextChip {
  const data = chip.data === undefined ? undefined : redactSecrets(chip.data);
  const id = `door:${chip.kind}:${hashOf(chip.key)}`;
  const built: ContextChip = {
    id,
    kind: chip.kind,
    label: chip.label,
    ...(chip.short && { short: chip.short }),
    ...(chip.secondary && { secondary: chip.secondary }),
    ref: { ...chip.ref, id: chip.ref.id ?? id },
    ...(data !== undefined && { data }),
    sizeBytes: byteSize(data),
    provenance: "door",
    ...(chip.count !== undefined && { count: chip.count }),
    sent: chip.sent,
  };
  return truncateChip(built, MAX_ATTACHED_BYTES);
}

/** The query a door attaches: serialised as a Query block, never written into the prompt. */
export function queryChip(
  input: {
    org: string;
    query: string;
    language: string;
    stream?: string;
    range?: PromptRange;
  },
  t: TranslateFn = gt,
): ContextChip {
  const lines = input.query.trim().split("\n").length;
  return doorChip({
    kind: "query",
    key: `${input.org}|query|${input.language}|${input.query}`,
    label: t("assistant.entry.chip.query", { count: lines }, lines),
    ref: {
      type: "query",
      org: input.org,
      ...(input.stream && { stream: input.stream }),
      ...(input.range && { from: input.range.from, to: input.range.to }),
    },
    data: { language: input.language, query: input.query },
    sent: "serialized",
  });
}

function zoneParts(ts: number, timeZone: string): Record<string, string> {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = zoneFormatter(timeZone);
  } catch {
    formatter = zoneFormatter("UTC");
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(ts)).map((part) => [part.type, part.value]),
  );
  // Some engines print midnight as "24" under `hourCycle: h23` with `hour12: false`.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}
