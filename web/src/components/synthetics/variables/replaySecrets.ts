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

import type { SyntheticsEnvironment, SyntheticsVariable, WireStep } from "@/types/synthetics";
import type { ResolvedVariable } from "./resolved";
import { placeholderNames, substitutePlaceholders } from "./placeholders";
import { effectiveVariables } from "./resolved";

/** Which org, check and environment a remembered value was typed for. */
export interface ReplaySecretScope {
  org: string;
  checkId: string;
  environment: string;
}

export function secretsNeededForReplay(steps: WireStep[], resolved: ResolvedVariable[]): string[] {
  const secrets = new Set(
    effectiveVariables(resolved)
      .filter((v) => v.kind === "secret")
      .map((v) => v.name),
  );
  const needed = new Set<string>();
  for (const step of steps) {
    for (const field of [step.value, step.url, step.key, step.text, step.selector]) {
      for (const name of placeholderNames(field ?? "")) {
        if (secrets.has(name)) needed.add(name);
      }
    }
  }
  return [...needed].sort();
}

const sessionSecrets = new Map<string, string>();

function sessionKey(scope: ReplaySecretScope, name: string): string {
  return JSON.stringify([scope.org, scope.checkId, scope.environment, name]);
}

export function rememberReplaySecret(scope: ReplaySecretScope, name: string, value: string): void {
  sessionSecrets.set(sessionKey(scope, name), value);
}

/** Which of `names` already have a value in `scope`, and which still have to be asked for. */
export function partitionReplaySecrets(
  scope: ReplaySecretScope,
  names: string[],
): {
  known: Record<string, string>;
  missing: string[];
} {
  const known: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = sessionSecrets.get(sessionKey(scope, name));
    if (value === undefined) missing.push(name);
    else known[name] = value;
  }
  return { known, missing };
}

/** Drops every remembered value. Called on sign-out and when the org changes. */
export function forgetReplaySecrets(): void {
  sessionSecrets.clear();
}

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

/** What replay runs with: check values over supplied secrets over shared plain values, url resolved. */
export function replayInputs(
  url: string,
  checkVariables: { name: string; value: string }[],
  sharedPlain: Record<string, string>,
  secrets: Record<string, string>,
): { url: string; variables: { name: string; value: string }[] } {
  const variables = mergeReplayVariables(checkVariables, { ...sharedPlain, ...secrets });
  const values = Object.fromEntries(variables.map((v) => [v.name, v.value]));
  return { url: substitutePlaceholders(url, values), variables };
}
