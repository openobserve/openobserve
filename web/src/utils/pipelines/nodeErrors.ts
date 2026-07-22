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
 * Pipeline node-error messages arrive in TWO shapes, and the frontend owns
 * reconciling them.
 *
 * `NodeErrors.errors` (src/config/src/meta/self_reporting/error.rs) changed from
 * `HashSet<String>` to `HashSet<(String, Option<Value>)>`. The struct is
 * persisted as JSON in `pipeline_last_errors.node_errors` (migration
 * m20250930_000001) and the read path is untyped passthrough — the DB returns
 * `Option<Value>` and the HTTP model forwards it verbatim, with no
 * `from_value::<NodeErrors>` anywhere to migrate or normalize it.
 *
 * So both shapes are live simultaneously and permanently:
 *   pre-upgrade rows:  ["boom", "bang"]
 *   post-upgrade rows: [["boom", null], ["bang", { detail: 1 }]]
 *
 * A bare `.join()` over the tuple shape renders
 * `"boom,\n\nbang,[object Object]"` — the array stringifies, taking the payload
 * with it. Every consumer must go through this helper instead.
 *
 * There is deliberately no back-end normalization to wait for: this is the
 * agreed home for the fix.
 */

/** One entry as it can appear on the wire. */
type RawNodeError = string | [string, unknown?] | unknown;

/**
 * Reduce a raw `errors` array to plain message strings, accepting both the
 * legacy string shape and the current `[message, payload]` tuple shape.
 *
 * Anything unrecognised is dropped rather than stringified — rendering
 * `[object Object]` in an error dialog is worse than showing one fewer line,
 * and `error_count` (which the caller reports separately) still reflects the
 * true total.
 */
export const normalizeNodeErrorMessages = (
  errors: RawNodeError[] | null | undefined,
): string[] => {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((entry) => {
      // current shape: [message, payload?] — take the message only.
      if (Array.isArray(entry)) return typeof entry[0] === "string" ? entry[0] : "";
      // legacy shape: a bare message string.
      if (typeof entry === "string") return entry;
      return "";
    })
    .filter((message) => message.length > 0);
};

/**
 * Join a node's errors into the block of text the tooltip/dialog renders,
 * appending the "… and N more" tail when the server truncated the list.
 * Returns null when there is nothing to show, so callers can `v-if` on it.
 */
export const formatNodeErrorText = (
  nodeError: { errors?: RawNodeError[]; error_count?: number } | null | undefined,
  moreLabel: (count: number) => string = (count) =>
    `... and ${count} more errors`,
): string | null => {
  const messages = normalizeNodeErrorMessages(nodeError?.errors);
  if (!messages.length) return null;

  const text = messages.join("\n\n");
  const total = nodeError?.error_count ?? 0;
  const hidden = total - messages.length;
  return hidden > 0 ? `${text}\n\n${moreLabel(hidden)}` : text;
};
