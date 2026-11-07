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

import type { ApprovalBlockData } from "@/composables/assistant/pure";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

type NamedCard = Pick<ApprovalBlockData, "tool" | "targets" | "args">;

// o2-ai words a refused call as "Error {status}: {body}".
const HTTP_ERROR = /^\s*Error (\d{3}):\s*([\s\S]*)$/;

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
