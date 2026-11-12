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

import { ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { recheckOncallReach } from "@/services/oncall.queries";

/** Sets up on-call in a new tab and re-reads whether incidents page anyone, so a blocked form keeps what the user entered. */
export const useOnCallSetup = () => {
  const store = useStore();
  const router = useRouter();
  const checking = ref(false);
  const org = () => String(store.state.selectedOrganization?.identifier ?? "");

  const openSetup = () => {
    const { href } = router.resolve({ path: "/oncall/teams", query: { org_identifier: org() } });
    window.open(href, "_blank", "noopener");
  };

  const checkAgain = async () => {
    const at = org();
    checking.value = true;
    try {
      const data = await recheckOncallReach(at);
      if (org() === at) await store.dispatch("setConfig", data);
    } catch {
      // The block stays as it was; the user can check again.
    } finally {
      checking.value = false;
    }
  };

  return { openSetup, checkAgain, checking };
};
