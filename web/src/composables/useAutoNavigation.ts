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

import { useRouter } from "vue-router";
import { useStore } from "vuex";

export interface NavigationTarget {
  path: string;
  query?: Record<string, any>;
}

const useAutoNavigation = () => {
  const router = useRouter();
  const store = useStore();

  function navigate(target: NavigationTarget) {
    const org = store.state.selectedOrganization?.identifier ?? "default";
    router.push({
      path: target.path,
      query: { org_identifier: org, ...(target.query ?? {}) },
    });
  }

  return { navigate };
};

export default useAutoNavigation;
