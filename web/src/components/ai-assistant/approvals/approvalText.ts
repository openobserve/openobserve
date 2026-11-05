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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

// o2-ai words a refused call as "Error {status}: {body}".
const HTTP_ERROR = /^\s*Error (\d{3}):\s*([\s\S]*)$/;

/** A heading as the tail of a sentence: "Pause alert x" reads "Denied: pause alert x". */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
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
