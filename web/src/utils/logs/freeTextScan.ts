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

import { b64DecodeUnicodeSafe, b64EncodeUnicode } from "@/utils/formatters";
import type { FreeTextScanEntry } from "@/utils/query/freeTextFilter";

export const FREE_TEXT_I18N = {
  blocked: "search.freeTextChooseFirst",
  scan: "search.freeTextScanLogsOnly",
} as const;

/** The slice of the logs search object the scan-consent helpers read and write. */
export interface FreeTextScanHolder {
  meta: { sqlMode?: boolean; freeTextScan?: Record<string, FreeTextScanEntry> | null };
  data: { stream: { selectedStream: string[] }; freeTextBlocked?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function freeTextGateFlags(
  searchObj: FreeTextScanHolder,
  t: (key: string) => string,
): { blockedReason: string | null; scanReason: string | null } {
  const selected = searchObj.data.stream.selectedStream ?? [];
  const scan = searchObj.meta.freeTextScan ?? {};
  return {
    blockedReason: searchObj.data.freeTextBlocked ? t(FREE_TEXT_I18N.blocked) : null,
    scanReason: selected.some((stream) => !!scan[stream]) ? t(FREE_TEXT_I18N.scan) : null,
  };
}

/** Keeps only well-formed `{ fields, materialized? }` entries; anything else is dropped, never thrown. */
export function sanitizeFreeTextScan(value: unknown): Record<string, FreeTextScanEntry> {
  const out: Record<string, FreeTextScanEntry> = {};
  if (!isRecord(value)) return out;
  for (const [stream, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !Array.isArray(entry.fields)) continue;
    const fields = entry.fields.filter((f): f is string => typeof f === "string" && f !== "");
    if (stream === "" || fields.length === 0) continue;
    out[stream] = entry.materialized === true ? { fields, materialized: true } : { fields };
  }
  return out;
}

export function encodeFtScan(value: unknown): string | null {
  const clean = sanitizeFreeTextScan(value);
  return Object.keys(clean).length ? b64EncodeUnicode(JSON.stringify(clean)) || null : null;
}

export function decodeFtScan(param: unknown): Record<string, FreeTextScanEntry> {
  if (typeof param !== "string" || param === "") return {};
  try {
    return sanitizeFreeTextScan(JSON.parse(b64DecodeUnicodeSafe(param, "{}")));
  } catch {
    return {};
  }
}

/** Drops scan entries for streams that are no longer selected. */
export function pruneFreeTextScan(searchObj: FreeTextScanHolder): void {
  const scan = searchObj.meta.freeTextScan ?? {};
  const selected = new Set(searchObj.data.stream.selectedStream ?? []);
  const kept = Object.fromEntries(Object.entries(scan).filter(([stream]) => selected.has(stream)));
  if (Object.keys(kept).length !== Object.keys(scan).length) searchObj.meta.freeTextScan = kept;
}
