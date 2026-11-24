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

import { GRANT_RIGHTS, type GrantRight, type SecretGrants } from "@/services/secrets";

/** One grant edit may write and delete at most this many tuples (R14-14). */
export const GRANT_EDIT_LIMIT = 100;

export type GrantRow = { role: string } & Record<GrantRight, boolean>;

export const emptyGrants = (): SecretGrants => ({
  see: [],
  use: [],
  manage: [],
  manage_access: [],
});

export const rowsFromGrants = (g: SecretGrants): GrantRow[] => {
  const roles = new Set(GRANT_RIGHTS.flatMap((right) => g[right] ?? []));
  return [...roles].sort().map((role) => ({
    role,
    see: (g.see ?? []).includes(role),
    use: (g.use ?? []).includes(role),
    manage: (g.manage ?? []).includes(role),
    manage_access: (g.manage_access ?? []).includes(role),
  }));
};

export const grantsFromRows = (rows: GrantRow[]): SecretGrants => {
  const g = emptyGrants();
  for (const row of rows) for (const right of GRANT_RIGHTS) if (row[right]) g[right].push(row.role);
  return g;
};

/** Tuples written plus tuples deleted between two grant sets. */
export const grantChangeCount = (before: SecretGrants, after: SecretGrants): number =>
  GRANT_RIGHTS.reduce((n, right) => {
    const a = new Set(before[right] ?? []);
    const b = new Set(after[right] ?? []);
    return n + [...a].filter((r) => !b.has(r)).length + [...b].filter((r) => !a.has(r)).length;
  }, 0);

export const hasGrants = (g: SecretGrants | undefined): boolean =>
  !!g && GRANT_RIGHTS.some((right) => (g[right] ?? []).length > 0);
