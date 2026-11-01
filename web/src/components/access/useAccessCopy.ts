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

import { onBeforeUnmount, ref } from "vue";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";

const COPIED_RESET_MS = 2000;

/** Copies a 403's details and flips `copied` for a moment. */
export function useAccessCopy(details: () => string) {
  const { t } = useI18nTyped();
  const copied = ref(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyDetails(): Promise<void> {
    if (!(await copyToClipboard(details(), t, { silent: true }))) return;
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), COPIED_RESET_MS);
  }

  onBeforeUnmount(() => clearTimeout(copiedTimer));
  return { copied, copyDetails };
}
