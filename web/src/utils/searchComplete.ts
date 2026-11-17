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

/** True only for a search response that holds every row: not partial, no function or query error, and a hits array. */
export function isCompleteSearch(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const body = data as Record<string, unknown>;
  return !searchFailed(body) && Array.isArray(body.hits);
}

/** True when a search answer, one-shot or streamed, is partial or carries a function or query error. */
export function searchFailed(body: Record<string, unknown> | undefined): boolean {
  return body?.is_partial === true || hasMessage(body?.function_error) || hasMessage(body?.error);
}

function hasMessage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => item !== "" && item != null);
  return value !== undefined && value !== null && value !== "" && value !== false;
}
