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

import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

/**
 * The rail's value for the unscoped tier.
 *
 * Not an environment name: an environment may not begin with `_`, precisely
 * because names become OpenFGA object ids, so this can never collide with one.
 */
export const GLOBAL_SCOPE = "_global";

/** What the right-hand pane renders for the selected scope. */
export interface ScopeView {
  /** The environment, or null when Global is selected. */
  environment: SyntheticsEnvironment | null;
  variables: SyntheticsVariable[];
  /** Global has no entity behind it, so it has no Edit, Duplicate or Delete. */
  isGlobal: boolean;
}

/**
 * Resolve the selected scope against the loaded data.
 *
 * Falls back to Global when the selection names an environment that is no
 * longer there - deleted in another tab, or filtered out by permission on a
 * refetch. Rendering an empty pane for a scope that does not exist would look
 * like an environment with no variables.
 */
export function resolveScope(
  selected: string,
  environments: SyntheticsEnvironment[],
  globals: SyntheticsVariable[],
): ScopeView {
  if (selected !== GLOBAL_SCOPE) {
    const environment = environments.find((e) => e.name === selected);
    if (environment) {
      return { environment, variables: environment.variables, isGlobal: false };
    }
  }
  return { environment: null, variables: globals, isGlobal: true };
}

/**
 * The default name offered when duplicating.
 *
 * `_copy` rather than a counter: the user is expected to replace it, and a
 * name that reads as a placeholder invites that more than `dev2` does.
 */
export function duplicateNameFor(source: string): string {
  return `${source}_copy`;
}

/**
 * What the duplicate dialog promises, given what the source holds.
 *
 * The secret count is called out separately because those arrive unset. Saying
 * so before the click is the difference between a deliberate choice and a
 * surprise the first time a check fails.
 */
export function duplicateSummary(variables: SyntheticsVariable[]): {
  total: number;
  secrets: number;
} {
  return {
    total: variables.length,
    secrets: variables.filter((v) => v.kind === "secret").length,
  };
}
