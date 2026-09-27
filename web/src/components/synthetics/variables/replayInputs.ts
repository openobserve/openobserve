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
import { substitutePlaceholders, withDefaultScheme } from "./placeholders";
import { namedEnvironments } from "./scope";

/** Plain shared values for one environment, its rows over the global ones; a secret hides a plain global. */
export function sharedPlainValues(
  environments: SyntheticsEnvironment[],
  globals: SyntheticsVariable[],
  environmentId: string | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  const apply = (rows: SyntheticsVariable[]) => {
    for (const row of rows) {
      if (row.kind === "plain" && row.value !== undefined) values[row.name] = row.value;
      else delete values[row.name];
    }
  };
  apply(globals);
  apply(environments.find((env) => env.id === environmentId && !env.is_global)?.variables ?? []);
  return values;
}

/** The check's first pinned environment, else the org's first named one; the selector overrides this later. */
export function defaultReplayEnvironmentId(
  checkEnvironments: string[],
  environments: SyntheticsEnvironment[],
): string | undefined {
  return checkEnvironments[0] ?? namedEnvironments(environments)[0]?.id;
}

export function mergeReplayVariables(
  checkVariables: { name: string; value: string }[],
  supplied: Record<string, string>,
): { name: string; value: string }[] {
  const own = new Set(checkVariables.map((v) => v.name));
  const extra = Object.entries(supplied)
    .filter(([name]) => !own.has(name))
    .map(([name, value]) => ({ name, value }));
  return [...checkVariables, ...extra];
}

/** What replay runs with: check values over shared plain values, url resolved and given a scheme. */
export function replayInputs(
  url: string,
  checkVariables: { name: string; value: string }[],
  sharedPlain: Record<string, string>,
): { url: string; variables: { name: string; value: string }[] } {
  const variables = mergeReplayVariables(checkVariables, sharedPlain);
  const values = Object.fromEntries(variables.map((v) => [v.name, v.value]));
  return { url: withDefaultScheme(substitutePlaceholders(url, values)), variables };
}
