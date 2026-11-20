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

import type { CaseEntityKind } from "./cases";

export interface EntityRef {
  kind: CaseEntityKind;
  value: string;
}

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;

/** A stored value as its scalar parts; arrays and their JSON text yield each element. */
export function entityValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(entityValues);
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(entityValues);
    } catch {
      // Not JSON: the brackets are part of the value.
    }
  }
  return text ? [text] : [];
}

/** A value as a person reads it: array elements comma-separated, never JSON. */
export function plainEntityText(value: unknown): string {
  const parts = entityValues(value);
  if (parts.length) return parts.join(", ");
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function normalizeIp(raw: string): string {
  const v = raw.trim().toLowerCase();
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : v;
  return mapped;
}

/** Short lower-cased host name, so `WIN-FIN-008.acme.local` matches `win-fin-008`. */
function normalizeHost(raw: string): string {
  const v = raw.trim().toLowerCase();
  return IPV4.test(v) || v.includes(":") ? v : (v.split(".")[0] ?? "");
}

/** The account part of `DOMAIN\acct`, `acct@domain` or an ARN, lower-cased. */
function userAccount(raw: string): string {
  let v = raw.trim().toLowerCase();
  if (v.startsWith("arn:")) v = v.split(":").slice(5).join(":").split("/").pop() ?? "";
  if (v.includes("\\")) v = v.split("\\").pop() ?? "";
  if (v.includes("@")) v = v.slice(0, v.lastIndexOf("@"));
  return v.trim();
}

function matches(kind: CaseEntityKind, candidate: string, wanted: string): boolean {
  if (!candidate || !wanted) return false;
  if (kind === "ip") return normalizeIp(candidate) === normalizeIp(wanted);
  if (kind === "host") return normalizeHost(candidate) === normalizeHost(wanted);
  const account = userAccount(wanted);
  return !!account && userAccount(candidate) === account;
}

/** Whether any column of the row holds one of the entities. */
export function rowNamesEntity(row: Record<string, unknown>, entities: EntityRef[]): boolean {
  if (!entities.length) return true;
  for (const value of Object.values(row)) {
    for (const part of entityValues(value)) {
      if (entities.some((e) => matches(e.kind, part, e.value))) return true;
    }
  }
  return false;
}
