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

import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { useRoute } from "vue-router";

type DialogRef = Ref<boolean>;

const useCreateAction = (dialogRef?: DialogRef | (() => void)) => {
  const route = useRoute();
  const key = "o2_create_action";

  // Tracks whether a cross-page create action is pending
  let pendingCreate = false;

  function openDialog() {
    if (!dialogRef) return;
    if (typeof dialogRef === "function") {
      dialogRef();
    } else if (!dialogRef.value) {
      dialogRef.value = true;
    }
  }

  // Global event (same-page: palette fires → dialog opens)
  window.addEventListener("o2:create-action", openDialog);
  onBeforeUnmount(() =>
    window.removeEventListener("o2:create-action", openDialog),
  );

  // Check for pending action on mount
  onMounted(() => {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      sessionStorage.removeItem(key);
      pendingCreate = true;
    }
    // Direct URL access — open immediately
    if (route.query.action === "create") {
      openDialog();
    }
  });

  return {
    /** Call when the page's initial data has finished loading */
    onPageReady: () => {
      if (pendingCreate) {
        pendingCreate = false;
        openDialog();
      }
    },
  };
};

export default useCreateAction;
