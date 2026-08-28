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

import type { SyntheticsVariable } from "@/types/synthetics";

/**
 * How a value renders in the list.
 *
 * A secret has no value to render - the server never sends one - so the column
 * carries presence instead. Returning a discriminated shape rather than a
 * pre-formatted string keeps the "never display a secret" rule in one place
 * instead of at every call site.
 */
export type ValueDisplay = { kind: "secret"; isSet: boolean } | { kind: "plain"; isSet: boolean };

export function valueDisplay(variable: SyntheticsVariable): ValueDisplay {
  return { kind: variable.kind, isSet: variable.has_value };
}

/**
 * Relative time from a microsecond timestamp.
 *
 * Microseconds, not milliseconds: every synthetics timestamp on the wire is
 * `now_micros()`. Treating one as milliseconds dates a row to 1970.
 */
export function relativeTime(micros: number, now: number = Date.now()): string {
  if (!micros) return "—";
  const seconds = Math.max(0, Math.floor((now - micros / 1000) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Does the environment refuse deletion outright, rather than on confirmation?
 *
 * A secret's value is write-only, so deleting one is unrecoverable by anyone -
 * there is no copy to restore from and nobody who can read it back. Checks are
 * the other hard block: the check would keep naming an environment that no
 * longer exists. Plain variables only need confirmation.
 */
export function environmentDeleteBlock(
  variables: SyntheticsVariable[],
  checksCount: number,
): "secrets" | "checks" | null {
  if (checksCount > 0) return "checks";
  if (variables.some((v) => v.kind === "secret")) return "secrets";
  return null;
}

/** Variables matching a case-insensitive substring of name or description. */
export function filterVariables(
  variables: SyntheticsVariable[],
  query: string,
): SyntheticsVariable[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return variables;
  return variables.filter(
    (v) => v.name.toLowerCase().includes(needle) || v.description.toLowerCase().includes(needle),
  );
}
