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

import { computed, shallowRef, watch, type Ref } from "vue";
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

/** Fold state, the layout it produces, and the notice explaining what is folded, for one plan view. */
export function useProfileFold(
  t: TranslateFn,
  model: () => ProfileModel,
  selectedId: Ref<string | null>,
) {
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
    if (!reason.value) return null;
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
    fold.value = applyFold(model(), fold.value, action);
    reason.value = action.type === "hotPath" ? { kind: "hot" } : null;
  }

  function reveal(opId: string) {
    const next = revealOp(model(), fold.value, opId);
    if (next !== fold.value) fold.value = next;
  }

  function onNoticeAction() {
    act(fold.value.focusId ? { type: "focus", opId: null } : { type: "expandAll" });
  }

  watch(
    model,
    (m) => {
      const result = autoFold(m, initialFold());
      fold.value = result.fold;
      reason.value = result.count ? { kind: "auto", count: result.count } : null;
    },
    { immediate: true },
  );

  watch(layout, (l) => {
    const id = selectedId.value;
    if (id && !l.cards.some((c) => c.opId === id))
      selectedId.value = nearestVisible(model(), l, id);
  });

  return { fold, layout, notice, focusable, act, reveal, onNoticeAction };
}
