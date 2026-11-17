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

import { computed, ref, shallowRef, watch } from "vue";
import type { TranslateFn } from "@/types/i18n";
import { layoutProfile, type FoldState, type ProfileModel } from "@/utils/queryProfile";
import {
  applyFold,
  autoFold,
  initialFold,
  nearestVisible,
  revealOp,
  type FoldAction,
} from "@/utils/queryProfileFold";
import type { FoldNotice } from "./profileStyles";
import { useQueryPlanPanels } from "./useQueryPlanPanels";

/** Selection, fold state, the layout it produces, and the notice explaining what is folded, for one plan view. */
export function useProfileFold(
  t: TranslateFn,
  model: () => ProfileModel,
  firstSelection: (m: ProfileModel) => string,
) {
  const { revealDetail } = useQueryPlanPanels();
  const selectedId = ref<string | null>(null);
  const fold = shallowRef<FoldState>(initialFold());
  const autoFolded = ref(0);

  const layout = computed(() => layoutProfile(model(), fold.value));

  // the note holds while any automatic group is still folded
  const notice = computed<FoldNotice | null>(() => {
    const count = autoFolded.value;
    if (!count || !fold.value.grouped.size) return null;
    return {
      text: t("search.queryProfile.autoFolded", { count }, count),
      action: t("search.queryProfile.expandAll"),
    };
  });

  function act(action: FoldAction) {
    if (action.type === "expandAll") autoFolded.value = 0;
    fold.value = applyFold(model(), fold.value, action);
  }

  function onNoticeAction() {
    act({ type: "expandAll" });
  }

  function pick(id: string) {
    fold.value = revealOp(model(), fold.value, id);
    selectedId.value = id;
    revealDetail();
  }

  watch(
    model,
    (m) => {
      const result = autoFold(m, initialFold());
      fold.value = result.fold;
      autoFolded.value = result.count;
      selectedId.value = firstSelection(m);
    },
    { immediate: true },
  );

  watch(layout, (l) => {
    const id = selectedId.value;
    if (id && !l.cards.some((c) => c.opId === id))
      selectedId.value = nearestVisible(model(), l, id);
  });

  return {
    selectedId,
    fold,
    layout,
    notice,
    act,
    onNoticeAction,
    pick,
  };
}
