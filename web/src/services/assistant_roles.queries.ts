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

import { queryOptions } from "@tanstack/vue-query";

import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

import { assistantKeys } from "./assistant.querykeys";
import { getResourcePermission, getRoles } from "./iam";

export interface RoleChatAccess {
  role: string;
  /** `null` when this role's grants could not be read. */
  chat: boolean | null;
}

export interface RoleChatAccessList {
  roles: RoleChatAccess[];
  /** Every role in the org, also those past the cap. */
  total: number;
}

/** More roles than this and the panel lists the first ones; the full list stays in IAM › Roles. */
export const MAX_ROLES = 50;

/** Role reads in flight at once, so a large org does not fan out fifty requests. */
const ROLE_READS = 6;

const GRANTS_CHAT: ReadonlySet<string> = new Set(["AllowAll", "AllowPut"]);

/** Chat is a PUT on `ai`, alone or through AllowAll; anything else on the module grants no chat. */
export function grantsChat(permissions: unknown): boolean {
  if (!Array.isArray(permissions)) return false;
  return permissions.some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      String((entry as Record<string, unknown>).object ?? "").startsWith("ai:") &&
      GRANTS_CHAT.has(String((entry as Record<string, unknown>).permission ?? "")),
  );
}

export const roleChatAccessQuery = (org: string) =>
  queryOptions({
    queryKey: [...assistantKeys.settings(org), "roleChatAccess"] as const,
    queryFn: async (): Promise<RoleChatAccessList> => {
      const res = await getRoles(org);
      const all = (Array.isArray(res.data) ? res.data : []).filter(
        (role: unknown): role is string => typeof role === "string" && role.length <= 256,
      );
      const roles = all.slice(0, MAX_ROLES);
      const out: RoleChatAccess[] = new Array(roles.length);
      let next = 0;
      const worker = async () => {
        while (next < roles.length) {
          const i = next++;
          out[i] = await chatAccessOf(org, roles[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(ROLE_READS, roles.length) }, worker));
      return { roles: out, total: all.length };
    },
    staleTime: NORMAL_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

async function chatAccessOf(org: string, role: string): Promise<RoleChatAccess> {
  try {
    const perms = await getResourcePermission({
      role_name: role,
      org_identifier: org,
      resource: "ai",
    });
    return { role, chat: grantsChat(perms.data) };
  } catch {
    return { role, chat: null };
  }
}
