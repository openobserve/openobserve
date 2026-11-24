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

import type { BrowserCheck, BrowserStep, WriteOnlyMeta } from "@/types/synthetics";

/** What the edit GET returns in place of a write-only value (V39). */
export interface WriteOnlySetMarker {
  set: true;
  updated_at: number;
  updated_by: string;
}

export const KEEP = Object.freeze({ keep: true as const });

export const isSetMarker = (v: unknown): v is WriteOnlySetMarker =>
  !!v && typeof v === "object" && (v as { set?: unknown }).set === true;

/** Slot keys follow the server's stable identities: header by lowercase name, variable by name. */
const norm = (v: string | null | undefined) => String(v ?? "").trim();

export const slotKey = {
  authPassword: () => "auth.password",
  header: (name?: string | null) => `http.headers.${norm(name).toLowerCase()}`,
  variable: (name?: string | null) => `variables.${norm(name)}`,
  sshSecret: () => "ssh.secret",
  browserSecret: (name?: string | null) => `secrets.${norm(name)}`,
  cookie: (name?: string | null, domain?: string | null) => `cookies.${norm(name)}|${norm(domain)}`,
};

const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie)$|-(key|token|secret)$/i;

/** The server's name rule for a header whose `secure` flag is absent. */
export const defaultHeaderSecure = (name: string): boolean => CREDENTIAL_HEADER.test(name.trim());

export const headerIsSecure = (h: { name: string; secure?: boolean }): boolean =>
  h.secure ?? defaultHeaderSecure(h.name);

/**
 * Reads one API value into the model: a set marker becomes "" plus a `writeOnly` entry,
 * so the form never holds the value and saves it back as a keep.
 */
export const readSlot = (
  value: unknown,
  key: string,
  writeOnly: Record<string, WriteOnlyMeta>,
): string => {
  if (isSetMarker(value)) {
    writeOnly[key] = { updated_at: value.updated_at, updated_by: value.updated_by };
    return "";
  }
  return value == null ? "" : String(value);
};

type SlotState = Pick<BrowserCheck, "writeOnly" | "replacedSlots">;

export const isKept = (check: SlotState, key: string): boolean =>
  !!check.writeOnly?.[key] && !(check.replacedSlots ?? []).includes(key);

/** The save form of one slot: a keep while the kept value is untouched, else what was typed. */
export const writeSlot = (check: SlotState, key: string, typed: string): string | typeof KEEP =>
  isKept(check, key) && !typed ? KEEP : typed;

/** Marks a kept slot replaced (or kept again); the caller resets the typed value. */
export const setReplaced = <T extends SlotState>(check: T, key: string, replaced: boolean): T => {
  const others = (check.replacedSlots ?? []).filter((k) => k !== key);
  return { ...check, replacedSlots: replaced ? [...others, key] : others };
};

const STORE_REF = /\{\{\s*secrets\./;

/** A cookie that carries a store ref is always sent Secure, whatever the author chose (V34). */
export const cookieHasSecret = (value: string | null | undefined): boolean =>
  STORE_REF.test(String(value ?? ""));

/** A step value the server holds stays kept until the author replaces it or types a new one. */
export const stepValueKept = (step: BrowserStep): boolean => !!step.valueSet && !step.valueReplaced;

/** The save form of one step value: a keep while the kept value is untouched. */
export const writeStepValue = (step: BrowserStep): string | typeof KEEP | undefined =>
  stepValueKept(step) && !step.value ? KEEP : step.value;

/** True when the check holds any write-only value; drives the capture-off note (R16 A-05). */
export const carriesWriteOnly = (
  check: BrowserCheck & { http?: { headers: { name: string; value: string; secure?: boolean }[] } },
): boolean => {
  if (Object.keys(check.writeOnly ?? {}).some((k) => isKept(check, k))) return true;
  if ((check.journey ?? []).some(stepValueKept)) return true;
  if ((check.cookies ?? []).some((c) => c.value)) return true;
  if (check.auth?.password) return true;
  if ((check.variables ?? []).some((v) => v.secure && v.value)) return true;
  const headers = check.http?.headers ?? [];
  if (headers.some((h) => headerIsSecure(h) && h.value)) return true;
  return headers.some((h) => STORE_REF.test(h.value));
};

export interface UrlRefusal {
  code: "ref_not_allowed_in_field";
  name: string;
  kind: "secret" | "secure_variable" | "auth_value";
}

/**
 * A URL can't carry a secret or a write-only placeholder, because run results show the
 * full URL (V34, R15 F01). Returns the first offending reference, or null.
 */
export const urlRefRefusal = (url: string, secureNames: Set<string>): UrlRefusal | null => {
  for (const m of url.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) {
    const token = m[1];
    if (token.startsWith("secrets.")) {
      return { code: "ref_not_allowed_in_field", name: token.slice(8), kind: "secret" };
    }
    if (secureNames.has(token)) {
      return { code: "ref_not_allowed_in_field", name: token, kind: "secure_variable" };
    }
    if (/_AUTH_(TOKEN|PASSWORD)$/.test(token)) {
      return { code: "ref_not_allowed_in_field", name: token, kind: "auth_value" };
    }
  }
  return null;
};

/** Names whose values are write-only in this check: secure variables and browser secrets. */
export const secureNames = (check: BrowserCheck): Set<string> => {
  const names = new Set<string>();
  for (const v of check.variables ?? []) if (v.secure) names.add(v.name);
  for (const s of check.secrets ?? []) if (s.name) names.add(s.name);
  return names;
};

/** The first navigate step whose URL names a secret or write-only value, with its index. */
export const stepUrlRefusal = (
  check: BrowserCheck,
): { index: number; refusal: UrlRefusal } | null => {
  const names = secureNames(check);
  for (const [index, step] of (check.journey ?? []).entries()) {
    if (step.action !== "navigate") continue;
    const refusal = urlRefRefusal(step.value ?? "", names);
    if (refusal) return { index, refusal };
  }
  return null;
};
