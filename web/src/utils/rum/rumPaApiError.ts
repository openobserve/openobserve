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

export interface RumPaError {
  status?: number;
  code?: string;
  current?: unknown;
  funnels?: { id: string; name: string }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isRef = (v: unknown): v is { id: string; name: string } =>
  isRecord(v) && typeof v.id === "string" && typeof v.name === "string";

/** Reads the `{code, current?, funnels?}` error contract; middleware 401/403 bodies carry no code. */
export function rumPaError(e: unknown): RumPaError {
  const response = isRecord(e) && isRecord(e.response) ? e.response : null;
  if (!response) return {};
  const out: RumPaError = {};
  if (typeof response.status === "number") out.status = response.status;
  const body = response.data;
  if (!isRecord(body) || typeof body.code !== "string") return out;
  out.code = body.code;
  if (body.current !== undefined) out.current = body.current;
  if (Array.isArray(body.funnels)) out.funnels = body.funnels.filter(isRef);
  return out;
}
