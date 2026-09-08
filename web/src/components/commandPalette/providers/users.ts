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

import usersService from "@/services/users";
import serviceAccountsService from "@/services/service_accounts";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface UserRow {
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
}

// Same keys as the IAM role badge, so the palette and the Users page never disagree on a role name.
function roleLabel(ctx: EntityProviderContext, role?: string): string {
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

// Mirrors the rail: IAM is offered only to admins, and that decision already lives in navLinks.
const canSeeIam = (ctx: EntityProviderContext) => ctx.navNames.has("iam");

export function createUsersProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "iam");
  return {
    id: "users",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("users") && canSeeIam(ctx),
    list: async (signal) => {
      const res = await usersService.orgUsers(ctx.org, signal);
      const rows: UserRow[] = res?.data?.data ?? [];
      return rows
        .filter((r) => r.email)
        .map((r) =>
          userToItem(r, r.role ? String(ctx.t(`palette.roles.${r.role}`, r.role)) : "", group),
        );
    },
  };
}

export function createServiceAccountsProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "iam");
  return {
    id: "serviceAccounts",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("serviceAccounts") && canSeeIam(ctx),
    list: async (signal) => {
      const res = await serviceAccountsService.list(ctx.org, signal);
      const rows: UserRow[] = res?.data?.data ?? [];
      const subtitle = roleLabel(ctx, "serviceaccount");
      return rows.filter((r) => r.email).map((r) => serviceAccountToItem(r, subtitle, group));
    },
  };
}
