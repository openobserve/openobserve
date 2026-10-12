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
 * Known-benign messages that reach RUM as "errors" but aren't bugs: a
 * WebSocket cleanup running after its socket is already gone, and a config
 * fetch or Monaco operation cancelled by a route change/unmount (axios
 * AbortController, Monaco disposal). Matched against both the message and
 * stack of a captured error/log so `console.error(prefix, err)` call sites
 * (which stringify `err` into the message) are caught too.
 */
export const IGNORED_NOISE_PATTERNS: RegExp[] = [
  /Cleanup socket failed, socket not found/i,
  // These three prefixes also fire for a genuine failure (a real 500, a
  // network timeout) — require an actual cancellation token after the
  // prefix, not just the prefix itself, or a real failure stringifies to
  // e.g. "Error in getOrganizationSettings: Request failed with status code
  // 500" and would be silently dropped here.
  /^Failed to load the full configuration:[\s\S]*(?:CancelledError|ERR_CANCELED)/i,
  /^Error in getOrganizationSettings:[\s\S]*(?:CancelledError|ERR_CANCELED)/i,
  /^Error while fetching config:[\s\S]*(?:CancelledError|ERR_CANCELED)/i,
  // Monaco editor disposal cancelling a pending operation — the message is
  // the bare word, with no distinguishing stack.
  /^Canceled$/,
];

/** Whether a captured error/log message+stack is known noise, not a real bug. */
export function isIgnoredNoise(message: string | undefined, stack?: string | undefined): boolean {
  const haystacks = [message || "", stack || ""];
  return IGNORED_NOISE_PATTERNS.some((pattern) => haystacks.some((text) => pattern.test(text)));
}
