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

import type { TemplateSuggestion } from "@/lib/forms/TemplateInput/OTemplateInput.types";
import { coverageGaps, inheritedUnion, type ResolvedVariablesGrouped } from "./resolved";

/** One row offered on `{{` in a Synthetics field; check-tier rows first, then the inherited union. */
export interface VariableSuggestion extends TemplateSuggestion {
  /** Environment names the variable is defined in; empty for a global or a check-tier row. */
  envs: string[];
  global: boolean;
  secret: boolean;
  /** Environments the name does not resolve in, from coverageGaps(). */
  gap: string[];
}

/** A check-tier variable as the editor holds it; `secure` is dropped by buildResolvedGrouped. */
export interface CheckVariableLike {
  name: string;
  secure?: boolean;
}

export function buildVariableSuggestions(
  grouped: ResolvedVariablesGrouped,
  checkVariables: CheckVariableLike[],
): VariableSuggestion[] {
  const localNames = new Set(checkVariables.map((v) => v.name.trim()));
  const gaps = coverageGaps(grouped);
  // Names stay as stored (untrimmed) so every row matches the known-name set built from the same data.
  const own: VariableSuggestion[] = checkVariables
    .map((v) => ({ name: v.name, envs: [], global: false, secret: Boolean(v.secure), gap: [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inherited: VariableSuggestion[] = inheritedUnion(grouped, localNames)
    .filter((row) => !row.overridden)
    .map((row) => ({
      name: row.name,
      envs: row.envs,
      global: row.global,
      secret: row.secret,
      gap: gaps.get(row.name) ?? [],
    }));
  return [...own, ...inherited];
}
