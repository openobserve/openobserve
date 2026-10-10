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

/** One suppressed run, as `GET /v2/{org}/alerts/history?downtime_id=` returns it. */
export interface SuppressedHit {
  timestamp: number;
  alert_name: string;
  status: string;
}

export interface SuppressedPage {
  hits: SuppressedHit[];
  total: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads a history response; a body that is not the expected object (a string, null) is an empty page. */
export function suppressedPage(body: unknown): SuppressedPage {
  let data = body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { hits: [], total: 0 };
    }
  }
  if (!isRecord(data)) return { hits: [], total: 0 };
  const hits = Array.isArray(data.hits) ? data.hits.filter(isRecord) : [];
  const parsed = hits.map((hit) => ({
    timestamp: Number(hit.timestamp),
    alert_name: String(hit.alert_name ?? ""),
    status: String(hit.status ?? ""),
  }));
  const total = typeof data.total === "number" ? data.total : parsed.length;
  return { hits: parsed, total };
}
