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

/**
 * How an End or Extend from a row went. `conflict`: the server refused it (409, 403, 404), so
 * the row is stale and its screen refreshes. `failed`: no answer came, so nothing changed.
 */
// Named for what the screen does next, not the HTTP status: every answer that is not ok refreshes.
export type MuteActionResult = "ok" | "conflict" | "failed";

/** Any server answer is a `conflict`; only a request with no response is `failed`. */
export const failureResult = (err: unknown): MuteActionResult =>
  (err as { response?: unknown } | null)?.response ? "conflict" : "failed";

/** The status of a failed call, or undefined when no answer came. */
export const failureStatus = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;
