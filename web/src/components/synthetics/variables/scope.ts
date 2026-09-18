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

/** The cross-tier relation of one name, for notes and delete dialogs. */
export type CrossTierShadow =
  { kind: "overrides-global" } | { kind: "overridden-in"; envs: string[] } | null;

/**
 * How `name` in the given scope relates to the other tier — an env row that
 * overrides a global, or a global that env rows shadow. Null when the name
 * lives in one tier only.
 */
export function crossTierShadow(
  name: string,
  environment: string | null,
  environments: SyntheticsEnvironment[],
  globals: SyntheticsVariable[],
): CrossTierShadow {
  if (environment) {
    return globals.some((g) => g.name === name) ? { kind: "overrides-global" } : null;
  }
  const envs = environments
    .filter((env) => !env.is_global && (env.variables ?? []).some((v) => v.name === name))
    .map((env) => env.name);
  return envs.length ? { kind: "overridden-in", envs } : null;
}

/** What the right-hand pane renders for the selected scope. */
export interface ScopeView {
  /** The selected environment; the global one (null until loaded) when Global is selected. */
  environment: SyntheticsEnvironment | null;
  variables: SyntheticsVariable[];
  /** Global variables live at `/synthetics/variables`, not under the environment's path. */
  isGlobal: boolean;
}

/** The org's reserved global environment, or null before the list has loaded. */
export function globalEnvironment(
  environments: SyntheticsEnvironment[],
): SyntheticsEnvironment | null {
  return environments.find((env) => env.is_global) ?? null;
}

/** Every environment but global: the tier whose rows override it. */
export function namedEnvironments(environments: SyntheticsEnvironment[]): SyntheticsEnvironment[] {
  return environments.filter((env) => !env.is_global);
}

/** Global pinned first, the rest in the server's order. */
export function railOrder(environments: SyntheticsEnvironment[]): SyntheticsEnvironment[] {
  return [...environments].sort((a, b) => Number(b.is_global) - Number(a.is_global));
}

/** The server refuses to delete global for everyone, so the rail offers no delete. */
export function canDeleteEnvironment(environment: SyntheticsEnvironment): boolean {
  return !environment.is_global;
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
  const environment = environments.find((e) => e.name === selected && !e.is_global);
  if (environment) {
    return { environment, variables: environment.variables, isGlobal: false };
  }
  return { environment: globalEnvironment(environments), variables: globals, isGlobal: true };
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
 * The default name offered when duplicating a variable.
 *
 * Upper-cased suffix, unlike [`duplicateNameFor`]: the server normalizes every
 * variable name to upper case, so offering `_copy` would show the user a name
 * they never get. Environment names are not normalized, hence the two helpers.
 */
export function duplicateVariableNameFor(source: string): string {
  return `${source}_COPY`;
}

/**
 * The prefill handed to the create form when duplicating a secret.
 *
 * Everything but the value, which no client ever holds. `has_value` is cleared
 * so the form cannot offer the Replace affordance for a value that is not
 * being carried over — the copy has to be given one by someone who knows it.
 */
export function duplicatePrefill(source: SyntheticsVariable): SyntheticsVariable {
  return { ...source, name: duplicateVariableNameFor(source.name), has_value: false };
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
