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
  canFocus,
  initialFold,
  nearestVisible,
  revealOp,
  type FoldAction,
} from "@/utils/queryProfileFold";
import type { FoldNotice } from "./profileStyles";
import { operatorTitle } from "./profileText";
import { useQueryPlanPanels } from "./useQueryPlanPanels";

/** Selection, fold state, the layout it produces, and the notice explaining what is folded, for one plan view. */
export function useProfileFold(
  t: TranslateFn,
  model: () => ProfileModel,
  firstSelection: (m: ProfileModel) => string,
) {
  const { revealDetail } = useQueryPlanPanels();
  const selectedId = ref<string | null>(null);
  const canvasRef = ref<{ fitNext: () => void } | null>(null);
  const fold = shallowRef<FoldState>(initialFold());
  const reason = shallowRef<{ kind: "auto"; count: number } | { kind: "hot" } | null>(null);

  const layout = computed(() => layoutProfile(model(), fold.value));

  const notice = computed<FoldNotice | null>(() => {
    const focusOp = fold.value.focusId ? model().operators[fold.value.focusId] : null;
    if (focusOp) {
      return {
        text: t("search.queryProfile.focusNote", { op: operatorTitle(t, focusOp) }),
        action: t("search.queryProfile.showWholePlan"),
      };
    }
    if (!reason.value || (reason.value.kind === "auto" && !fold.value.grouped.size)) return null;
    const text =
      reason.value.kind === "hot"
        ? t("search.queryProfile.hotPathNote")
        : t("search.queryProfile.autoFolded", { count: reason.value.count }, reason.value.count);
    return { text, action: t("search.queryProfile.expandAll") };
  });

  const focusable = computed(() =>
    selectedId.value ? canFocus(model(), selectedId.value) : false,
  );

  function act(action: FoldAction) {
    const next = applyFold(model(), fold.value, action);
    if (action.type === "hotPath") {
      if (next !== fold.value) reason.value = { kind: "hot" };
    } else if (reason.value?.kind !== "auto" || action.type === "expandAll") {
      // the auto note holds while groups remain; the hot-path note only until the next change
      reason.value = null;
    }
    fold.value = next;
  }

  function reveal(opId: string) {
    const next = revealOp(model(), fold.value, opId);
    if (next === fold.value) return;
    if (reason.value?.kind === "hot") reason.value = null;
    fold.value = next;
  }

  function onNoticeAction() {
    act(fold.value.focusId ? { type: "focus", opId: null } : { type: "expandAll" });
  }

  function pick(id: string) {
    reveal(id);
    selectedId.value = id;
    revealDetail();
  }

  function focusOn(opId: string | null) {
    canvasRef.value?.fitNext();
    act({ type: "focus", opId });
  }

  watch(
    model,
    (m) => {
      const result = autoFold(m, initialFold());
      fold.value = result.fold;
      reason.value = result.count ? { kind: "auto", count: result.count } : null;
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
    canvasRef,
    fold,
    layout,
    notice,
    focusable,
    act,
    onNoticeAction,
    pick,
    focusOn,
  };
}
