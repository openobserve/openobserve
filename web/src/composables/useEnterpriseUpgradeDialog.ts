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

/**
 * Module-scoped singleton (same pattern as ONavGroup's `openGroupKey`): every
 * caller of this composable shares the SAME ref, so a single
 * `<EnterpriseUpgradeDialog>` mounted once (in Header.vue) can be opened from
 * anywhere — a locked nav tile, a locked Settings tab — without each one
 * needing its own dialog instance or a prop/event chain back up to Header.
 */
const isEnterpriseUpgradeDialogOpen = ref(false);

export function useEnterpriseUpgradeDialog() {
  return {
    isOpen: isEnterpriseUpgradeDialogOpen,
    open: () => {
      isEnterpriseUpgradeDialogOpen.value = true;
    },
    close: () => {
      isEnterpriseUpgradeDialogOpen.value = false;
    },
  };
}
