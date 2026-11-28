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

import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { orgUsersQuery } from "@/services/users.queries";

/** The signed-in user's role in the selected org, read from the org's user list. */
export function useOrgRole() {
  const store = useStore();
  const orgId = computed<string>(() => store?.state?.selectedOrganization?.identifier ?? "");
  const users = useQuery(() =>
    Object.assign(orgUsersQuery(orgId.value), { enabled: !!orgId.value }),
  );

  // Native login sets no `currentuser.role`; the list is the source, the session claim a fallback.
  const role = computed<string>(() => {
    const me = String(store?.state?.userInfo?.email ?? "").toLowerCase();
    const listed = (users.data.value ?? []).find(
      (user: { email?: string }) => String(user.email ?? "").toLowerCase() === me,
    );
    return String(listed?.role ?? store?.state?.currentuser?.role ?? "").toLowerCase();
  });

  /** Visibility only: the server enforces every admin and root route. */
  const isAdmin = computed(() => role.value === "admin" || role.value === "root");
  const isRoot = computed(() => role.value === "root");

  return { role, isAdmin, isRoot };
}
