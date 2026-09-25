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

import type { PaletteItem } from "../types";
import type { EntityProviderContext } from "./context";

interface UserRow {
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
}

// Same keys as the IAM role badge, so the palette and the Users page never disagree on a role name.
export function roleLabel(ctx: EntityProviderContext, role?: string): string {
  if (!role) return "";
  const key = `components.badge.userRole.${role.toLowerCase()}`;
  const label = String(ctx.t(key));
  return label === key ? role : label;
}

function displayName(row: UserRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || row.email;
}

/** A user row: id `user:<email>`, opened on the user's IAM edit form. */
export function userToItem(row: UserRow, roleLabel: string, group?: string): PaletteItem {
  const name = displayName(row);
  return {
    id: `user:${row.email}`,
    type: "user",
    label: name,
    subtitle: [name === row.email ? "" : row.email, roleLabel].filter(Boolean).join(" · "),
    icon: "person",
    keywords: [row.email, row.role ?? ""].filter(Boolean),
    group,
    route: { name: "users", query: { action: "update", email: row.email } },
  };
}

/** A service-account row: id `serviceAccount:<email>`, opened on its IAM edit form. */
export function serviceAccountToItem(row: UserRow, subtitle: string, group?: string): PaletteItem {
  return {
    id: `serviceAccount:${row.email}`,
    type: "serviceAccount",
    label: displayName(row),
    subtitle,
    icon: "smart-toy",
    keywords: [row.email, "token", "api key"],
    group,
    route: { name: "serviceAccounts", query: { action: "update", email: row.email } },
  };
}
