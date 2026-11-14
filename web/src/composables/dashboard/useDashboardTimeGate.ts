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

import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";
import { arePickerValuesEqual, isUsablePickerValue } from "@/utils/dashboard/panelTimeUtils";
import { rangeExceedsGuard } from "@/utils/orgTimeRangeSettings";

// Same pause Logs gives an absolute edit before it runs (debouncedAutoRunAbsolute).
export const ABSOLUTE_APPLY_DEBOUNCE_MS = 2500;

export interface DashboardTimeGateOptions {
  /** The range panels load with; the gate creates its own when the caller keeps none. */
  applied?: Ref<any>;
  isAutoRunOn: () => boolean;
  /** Runs when Auto Run applies a range, for callers that cannot watch `applied`. */
  onAutoApply?: (value: any) => void;
  /** Moves the picker to a range, since a mounted picker reads its v-model only once. */
  showInPicker?: (value: any) => void;
  /** The org's "ask before ranges longer than N days"; null when the org has none. */
  guardDays?: () => number | null;
}

export interface DashboardTimeApplyMeta {
  userChanged?: boolean;
  source?: string;
}

/** Keeps what a dashboard time picker shows apart from the range its panels load with. */
export const useDashboardTimeGate = (options: DashboardTimeGateOptions) => {
  const applied = options.applied ?? ref<any>(null);
  const picked = ref<any>(null);
  const held = ref<{ from: any; to: any } | null>(null);

  let hasStartingRange = false;
  let isPickerOpen = false;
  let pendingApply: ReturnType<typeof setTimeout> | null = null;

  const isWaiting = computed(
    () => isUsablePickerValue(picked.value) && !arePickerValuesEqual(picked.value, applied.value),
  );
  const needsRefresh = computed(() => isWaiting.value && !options.isAutoRunOn());

  const cancelPendingApply = () => {
    if (pendingApply === null) return;
    clearTimeout(pendingApply);
    pendingApply = null;
  };

  /** Promotes a waiting range and reports whether the applied range changed. */
  const apply = () => {
    cancelPendingApply();
    if (!isWaiting.value) return false;
    applied.value = { ...picked.value };
    return true;
  };

  const autoApply = () => {
    if (apply()) options.onAutoApply?.(applied.value);
  };

  /** Applies a waiting range, or re-issues the applied one so whatever watches it reloads. */
  const refresh = () => {
    if (!apply() && applied.value) applied.value = { ...applied.value };
  };

  const flush = () => {
    if (pendingApply !== null) autoApply();
  };

  /** Drops any waiting range in favour of an applied range set from outside the picker. */
  const adopt = () => {
    cancelPendingApply();
    picked.value = applied.value ? { ...applied.value } : null;
  };

  const onPick = (value: any) => {
    picked.value = value;

    // A picker reports its starting range when it mounts; that is the range already in force.
    if (!hasStartingRange) {
      hasStartingRange = true;
      applied.value = { ...value };
      return;
    }

    cancelPendingApply();
    if (!isWaiting.value || !options.isAutoRunOn()) return;

    const isAbsoluteEdit = value?.valueType !== "relative" && isPickerOpen;
    if (isAbsoluteEdit) pendingApply = setTimeout(autoApply, ABSOLUTE_APPLY_DEBOUNCE_MS);
    else autoApply();
  };

  const overGuard = (value: any) =>
    rangeExceedsGuard(
      Number(value?.startTime),
      Number(value?.endTime),
      options.guardDays?.() ?? null,
    );

  /** A range the user applied runs at once, Auto Run or not, unless it is over the org's guard. */
  const onApply = (value: any, meta?: DashboardTimeApplyMeta) => {
    if (meta?.userChanged === false) return onPick(value);
    held.value = null;
    if (!isUsablePickerValue(value)) return onPick(value);
    if (meta?.source !== "undo" && overGuard(value)) {
      held.value = { from: applied.value, to: value };
      return;
    }
    onPick(value);
    apply();
  };

  const confirmGuard = () => {
    const next = held.value?.to;
    held.value = null;
    if (!next) return;
    onPick(next);
    apply();
  };

  const dismissGuard = () => {
    if (!held.value) return;
    held.value = null;
    adopt();
    if (applied.value) options.showInPicker?.(applied.value);
  };

  const onShow = () => {
    isPickerOpen = true;
  };

  const onHide = () => {
    isPickerOpen = false;

    // A broken range never applies, so closing on one puts the picker back on the range panels show.
    if (picked.value && !isUsablePickerValue(picked.value) && applied.value) {
      adopt();
      options.showInPicker?.(applied.value);
      return;
    }
    flush();
  };

  watch(options.isAutoRunOn, (isOn) => {
    if (isOn) autoApply();
    else cancelPendingApply();
  });

  if (getCurrentScope()) onScopeDispose(cancelPendingApply);

  return {
    picked,
    applied,
    held,
    isWaiting,
    needsRefresh,
    onPick,
    onApply,
    onShow,
    onHide,
    flush,
    apply,
    refresh,
    adopt,
    confirmGuard,
    dismissGuard,
  };
};

export type DashboardTimeGate = ReturnType<typeof useDashboardTimeGate>;
