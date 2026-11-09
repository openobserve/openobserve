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
  approvalDiff,
  approvalDuration,
  approvalNotifies,
  approvalNoun,
  approvalUntil,
  approvalVerb,
  type ApprovalBlockData,
} from "@/composables/assistant/pure";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import type { ApprovalDiffRow } from "./approvals.types";

type NamedCard = Pick<ApprovalBlockData, "tool" | "targets" | "args">;

// o2-ai words a refused call as "Error {status}: {body}".
const HTTP_ERROR = /^\s*Error (\d{3}):\s*([\s\S]*)$/;

// A nested setting reads as its own rows down to this depth; deeper values stay as JSON.
const MAX_FLAT_DEPTH = 3;

// A field named `…_at` holds a time and `…_secs` a length of time; both read in words, never as raw numbers.
const TIME_FIELD = /_at$/;

const SECONDS_FIELD = /_secs$/;

// A pause card's duration already reads in its "Until …" line.
const PAUSE_TIME_FIELDS = new Set(["minutes", "ends_at"]);

interface LeafChange {
  path: string[];
  after: unknown;
  before?: unknown;
}

/** A heading as the tail of a sentence: "Pause alert x" reads "Denied: pause alert x". */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/** The card with its object named as the reader knows it: o2-ai names a create without a `name` after its tool, and a new panel after its dashboard's id. */
export function readableCard<T extends NamedCard>(card: T): T {
  const targets = card.targets ?? [];
  const first = targets[0];
  if (!first?.name || !placeholderName(card, first)) return card;
  const own = first.id && card.args?.[`${first.type}_id`] === first.id ? { id: first.id } : {};
  const named = { type: first.type, name: argTitle(card, first.type) ?? "", ...own };
  return { ...card, targets: [named, ...targets.slice(1)] };
}

/** The dashboard a panel change goes into, by the id its arguments carry. */
export function panelDashboardId(card: NamedCard): string | null {
  if (card.targets?.[0]?.type !== "panel") return null;
  const id = card.args?.dashboard_id;
  return typeof id === "string" && id ? id : null;
}

/** A refusal's reason in words: a known HTTP status gets short copy, anything else the server's own detail. */
export function readableReason(text: string, t: TranslateFn): I18nText {
  const match = HTTP_ERROR.exec(text);
  if (!match) return raw(text);
  const words = serverWords(match[2]);
  return (
    statusReason(Number(match[1]), t) ??
    (words ? raw(words) : t("assistant.approval.reason.status", { code: raw(match[1]) }))
  );
}

/** Short copy for an HTTP status the reader can act on; `null` for the rest. */
export function statusReason(code: number, t: TranslateFn): I18nText | null {
  if (code === 403) return t("assistant.approval.reason.forbidden");
  if (code === 404) return t("assistant.approval.reason.notFound");
  if (code === 409) return t("assistant.approval.reason.conflict");
  if (code === 429) return t("assistant.approval.reason.rateLimited");
  return code >= 500 && code < 600 ? t("assistant.approval.reason.server") : null;
}

// The `detail` or `message` of a JSON error body; plain text stays as it is.
function serverWords(body: string): string {
  const trimmed = body.trim();
  if (!/^[[{]/.test(trimmed)) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return wordsOf(parsed);
  } catch {
    return "";
  }
}

function wordsOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["detail", "message", "error"]) {
    const words = wordsOf(record[key]);
    if (words) return words;
  }
  return "";
}

// A name equal to the target's own id is still its name (a stream's id is its name); only the tool or another object's id is a stand-in.
function placeholderName(card: NamedCard, target: { type: string; name: string }): boolean {
  const name = compact(target.name);
  if ([card.tool, card.tool.replace(/^[^_]+_/, "")].some((id) => compact(id) === name)) return true;
  return Object.entries(card.args ?? {}).some(
    ([key, value]) => key.endsWith("_id") && key !== `${target.type}_id` && value === target.name,
  );
}

// `request_body.panel.title` for a panel, else the body's own title or name.
function argTitle(card: NamedCard, type: string): string | null {
  const body = recordOf(card.args?.request_body) ?? card.args ?? {};
  for (const source of [recordOf(body[type]), body])
    for (const key of ["title", "name"]) {
      const value = source?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  return null;
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function valueText(value: unknown, t: TranslateFn): string {
  if (value === undefined) return "—";
  if (typeof value === "boolean") return String(t(value ? "common.yes" : "common.no"));
  if (Array.isArray(value) && value.every((entry) => typeof entry !== "object" || entry === null))
    return value.map(String).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}

// A time, a duration or a list of `{ids}` (a downtime's targets) in the reader's words.
function leafText(
  field: string,
  value: unknown,
  card: Pick<ApprovalBlockData, "targets">,
  t: TranslateFn,
): string {
  if (typeof value === "number" && value > 0) {
    if (TIME_FIELD.test(field)) return formatOrgTime(epochMsOf(value));
    if (SECONDS_FIELD.test(field)) return String(approvalDuration(value * 1000, t));
  }
  const ids = idsOf(value);
  if (ids) {
    const names = new Map(card.targets.map((target) => [target.id, target.name]));
    return ids.map((id) => names.get(id) ?? id).join(", ");
  }
  return valueText(value, t);
}

// Wire times are microseconds, sometimes seconds.
function epochMsOf(value: number): number {
  if (value > 1e14) return Math.round(value / 1000);
  return value < 1e12 ? value * 1000 : value;
}

function idsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const list = recordOf(entry)?.ids;
    if (!Array.isArray(list)) return null;
    ids.push(...list.filter((id): id is string => typeof id === "string"));
  }
  return ids.length ? ids : null;
}

// `trigger_condition` → "Trigger condition"; `duration_secs` → "Duration".
function fieldLabel(key: string): string {
  const words = key.replace(SECONDS_FIELD, "").replace(/[_.]+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

// A nested object reads as one row per changed setting, never as one block of JSON.
function leafChanges(
  path: string[],
  after: unknown,
  before: unknown,
  known: boolean,
): LeafChange[] {
  const own = recordOf(after);
  const old = recordOf(before);
  if (!own || path.length >= MAX_FLAT_DEPTH || (known && before !== undefined && !old))
    return [{ path, after, ...(known && { before }) }];
  return Object.entries(own).flatMap(([key, value]) => {
    const has = !!old && key in old;
    if (has && JSON.stringify(old[key]) === JSON.stringify(value)) return [];
    return leafChanges([...path, key], value, old?.[key], has);
  });
}

// The leaf's own name, with its parent's when two leaves share it.
function leafLabels(changes: LeafChange[]): string[] {
  const leaf = changes.map((change) => change.path.at(-1) ?? "");
  return changes.map((change, index) =>
    leaf.indexOf(leaf[index]) === leaf.lastIndexOf(leaf[index]) || change.path.length < 2
      ? fieldLabel(leaf[index])
      : `${fieldLabel(change.path.at(-2) ?? "")} · ${fieldLabel(leaf[index])}`,
  );
}

/** The card's changed fields; `before` replaces the card's own old side, as a `changed_since` record does. */
export function approvalDiffRows(
  t: TranslateFn,
  card: ApprovalBlockData,
  before: unknown = card.before,
): ApprovalDiffRow[] {
  const changed = approvalDiff({ ...card, before });
  const unknown = t("assistant.approval.currentUnknown");
  const verb = approvalVerb(card);
  // A pause or resume sets a downtime, not the alert's fields, so its values have no old side.
  const stateVerb = verb === "pause" || verb === "resume";
  const pause = verb === "pause" && pauseUntil(card) !== null;
  const changes = (changed?.rows ?? [])
    .filter((row) => !(pause && PAUSE_TIME_FIELDS.has(row.field)))
    .flatMap((row) => leafChanges([row.field], row.after, row.before, "before" in row));
  const labels = leafLabels(changes);
  const rows = changes.map((change, index) => {
    const field = raw(labels[index]);
    const leaf = change.path.at(-1) ?? "";
    const value = raw(leafText(leaf, change.after, card, t));
    if (card.kind === "create" || stateVerb) return { field, value, before: null };
    const old =
      "before" in change
        ? leafText(leaf, change.before, card, t)
        : changed?.oneSided
          ? unknown
          : null;
    return { field, value, before: old === null ? null : raw(old) };
  });
  const notifies = approvalNotifies(card);
  return notifies
    ? [...rows, { field: t("assistant.approval.notifies"), value: raw(notifies), before: null }]
    : rows;
}

/** When a pause ends: the call's own arguments, else the shared change, else a gathered card's first call. */
export function pauseUntil(
  card: Pick<ApprovalBlockData, "args" | "after">,
  from?: number,
): number | null {
  const calls = card.args?.calls;
  const first = Array.isArray(calls) ? recordOf(calls[0]) : null;
  for (const args of [card.args, recordOf(card.after), first]) {
    const until = args ? approvalUntil({ args }, from) : null;
    if (until !== null) return until;
  }
  return null;
}

/** "pausing alerts": what an always grant covers, in the reader's words; the tool name when the card has no verb. */
export function approvalActionPhrase(
  t: TranslateFn,
  card: Pick<ApprovalBlockData, "kind" | "tool" | "targets" | "args">,
): I18nText {
  const verb = approvalVerb(card);
  if (!verb) return raw(card.tool);
  const entity = t(`assistant.entity.${approvalNoun(card)}`, 2);
  return t(`assistant.approval.actionPhrase.${verb}`, { entity });
}
