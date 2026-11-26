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
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";

// OTable is generic, so `InstanceType<typeof OTable>` does not type-check; type only what the pages call.
export interface DbmTableHandle {
  scrollToTop?: () => void;
  $el?: HTMLElement;
  hasResizedColumns?: boolean;
  resetColumnSizes?: () => void;
}

export const useDbmColumnToggle = (tableId: string, defaults: Record<string, boolean>) => {
  const tableRef = ref<DbmTableHandle | null>(null);
  const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(tableId);
  // A saved user choice wins; otherwise start from the page defaults.
  if (!Object.keys(columnVisibility.value).length) columnVisibility.value = { ...defaults };
  return { tableRef, columnVisibility, setColumnVisibility };
};
