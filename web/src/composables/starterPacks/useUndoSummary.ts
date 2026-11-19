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
import { useI18nTyped } from "@/types/i18n";
import type { StarterPackFlow } from "./useStarterPackFlow";

const HOUR_US = 60 * 60 * 1_000_000;

/** The lines every undo or remove confirmation shows for a pack. */
export function useUndoSummary(flow: StarterPackFlow) {
  const { t } = useI18nTyped();
  const left = computed(() => {
    const hours = Math.floor(flow.undoLeftUs.value / HOUR_US);
    return hours > 0 ? t("starterPacks.undo.left", { hours }) : t("starterPacks.undo.leftSoon");
  });
  const cover = computed(() => {
    const live = flow.alertsOn.value;
    return live > 0
      ? t("starterPacks.undo.loseCover", { count: live }, live)
      : t("starterPacks.undo.allOff");
  });
  const removes = computed(() => {
    const count = flow.made.value.length;
    return t("starterPacks.undo.removes", { count }, count);
  });
  return { left, cover, removes };
}
