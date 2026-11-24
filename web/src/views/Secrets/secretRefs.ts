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
import type { SecretKind, SecretPickerItem, StatusOnlyOutcome } from "@/services/secrets";

const REF_RE = /\{\{\s*(secrets|vars)\.([A-Za-z0-9_]+)\s*\}\}/g;

export const refText = (kind: SecretKind, name: string): string =>
  `{{${kind === "secret" ? "secrets" : "vars"}.${name}}}`;

/** Secret and variable names referenced anywhere in the given field values. */
export const refNames = (texts: (string | undefined | null)[]) => {
  const secrets = new Set<string>();
  const vars = new Set<string>();
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(REF_RE)) {
      (m[1] === "secrets" ? secrets : vars).add(m[2]);
    }
  }
  return { secrets, vars };
};

export const hasStoreRef = (texts: (string | undefined | null)[]): boolean => {
  const { secrets, vars } = refNames(texts);
  return secrets.size + vars.size > 0;
};

/** The host a pin would name for this URL: host, plus the port when it is not 443. */
export const pinHostOf = (url: string | undefined | null): string | null => {
  try {
    const u = new URL(String(url ?? ""));
    if (!u.hostname) return null;
    return u.port && u.port !== "443" ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
};

export type PickerState = "pinned" | "any-host" | "pin-on-first-use" | "legacy" | "not-allowed";

export const pickerState = (item: SecretPickerItem): PickerState => {
  if (!item.allowed_here) return "not-allowed";
  if (item.kind !== "secret") return "pinned";
  if (item.pin_mode === "any") return "any-host";
  if (item.pin_mode === "none") return "pin-on-first-use";
  if (item.pin_mode === "legacy") return "legacy";
  return "pinned";
};

/** Any-host and not-allowed secrets bind only for manage-access holders (V40, §3.6.1). */
export const pickerDisabled = (item: SecretPickerItem): boolean => {
  const state = pickerState(item);
  if (state !== "not-allowed" && state !== "any-host") return false;
  return item.rights?.manage_access !== true;
};

/** "Delivered (HTTP 200)" or "Failed: http_4xx (401)"; nothing from the response body (V37). */
export const formatTestOutcome = (t: TranslateFn, o: StatusOnlyOutcome): I18nText => {
  if (o.ok) {
    return o.status
      ? t("secrets.consumer.delivered", { status: o.status })
      : t("secrets.consumer.deliveredNoStatus");
  }
  const reason = [o.class, o.status ? `(${o.status})` : ""].filter(Boolean).join(" ");
  return t("secrets.consumer.failed", { reason: raw(reason || "unknown") });
};
