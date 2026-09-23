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

import { rumField } from "@/utils/rum/fields";

/**
 * The browser SDK re-sends a view as a new document on every update — creation,
 * throttled metric changes, `setViewName`, a periodic keep-alive, unload and view
 * end — all sharing one `view_id`, with `_o2_document_version` incrementing and
 * `date` fixed at the view's start. Read raw, one navigation looks like several.
 */

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

// Latest version wins; without one, the longest time spent (it only grows).
const isNewer = (candidate: any, current: any): boolean => {
  const candidateVersion = toNumber(rumField(candidate, "document_version"));
  const currentVersion = toNumber(rumField(current, "document_version"));
  if (candidateVersion !== currentVersion) return candidateVersion > currentVersion;
  const candidateSpent = toNumber(candidate?.view_time_spent);
  const currentSpent = toNumber(current?.view_time_spent);
  if (candidateSpent !== currentSpent) return candidateSpent > currentSpent;
  return true; // tie: the later-seen document
};

const minDate = (a: unknown, b: unknown): unknown => {
  const x = Number(a);
  const y = Number(b);
  if (!(x > 0)) return b;
  if (!(y > 0)) return a;
  return x <= y ? a : b;
};

/**
 * One row per `view_id`: the view's latest document, stamped with the earliest
 * `date` across its documents so it stays at the moment the navigation happened.
 * Each view sits where its first document did; rows that are not views, or carry
 * no `view_id`, pass through untouched and in order.
 *
 * @example
 *   collapseViewDocuments([
 *     { type: "view", view_id: "v1", _o2_document_version: 2, date: 10 },
 *     { type: "view", view_id: "v1", _o2_document_version: 5, date: 10 },
 *   ]); // [{ type: "view", view_id: "v1", _o2_document_version: 5, date: 10 }]
 */
export function collapseViewDocuments<T = any>(rows: T[]): T[] {
  const slots: any[] = [];
  const slotByViewId = new Map<string, number>();

  for (const row of rows as any[]) {
    const viewId = row?.type === "view" ? row?.view_id : undefined;
    if (!viewId) {
      slots.push(row);
      continue;
    }
    const index = slotByViewId.get(viewId);
    if (index === undefined) {
      slotByViewId.set(viewId, slots.length);
      slots.push(row);
      continue;
    }
    const current = slots[index];
    const date = minDate(current.date, row.date);
    slots[index] = { ...(isNewer(row, current) ? row : current), date };
  }

  return slots;
}
