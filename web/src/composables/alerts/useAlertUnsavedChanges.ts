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

import { computed, onBeforeUnmount, shallowRef, toRaw, type ComputedRef, type Ref } from "vue";
import { cloneDeep, set } from "lodash-es";
import {
  changedSections,
  diffAlertValues,
  type AlertFieldChange,
} from "@/utils/alerts/alertFormDiff";
import type { AlertSectionId } from "@/components/alerts/alertFormSections";

export interface AlertUnsavedChangesInput {
  /** The form's read-view of its values. */
  values: Ref<Record<string, unknown>>;
  /** Edit mode only: a new alert has nothing to compare with. */
  enabled: () => boolean;
  /** Resolves once the loaded alert is in the form. */
  ready: Promise<unknown>;
}

export interface AlertUnsavedChanges {
  changes: ComputedRef<AlertFieldChange[]>;
  sections: ComputedRef<Set<AlertSectionId>>;
  /** The values the form held before the first edit, or null before one could happen. */
  baseline: Readonly<Ref<Record<string, unknown> | null>>;
  /** Takes the baseline now; for tests and for hosts that know the form just settled. */
  takeBaseline: () => void;
  /** Records a value the server already saved, so it never counts as an unsaved change. */
  acceptSaved: (path: string, value: unknown) => void;
}

// Loads keep writing normalised values after `ready`; the first input is the last moment no edit has landed.
const BASELINE_EVENTS = ["pointerdown", "keydown"] as const;

/** Field-level diff of the edit form against the alert as it was before the user touched it. */
export function useAlertUnsavedChanges(input: AlertUnsavedChangesInput): AlertUnsavedChanges {
  const baseline = shallowRef<Record<string, unknown> | null>(null);
  let armed = false;
  let disposed = false;

  const takeBaseline = () => {
    baseline.value = cloneDeep(toRaw(input.values.value ?? {}));
    disarm();
  };

  const acceptSaved = (path: string, value: unknown) => {
    if (!baseline.value) return;
    baseline.value = set(cloneDeep(baseline.value), path, cloneDeep(value));
  };

  const onFirstInput = () => {
    if (baseline.value === null) takeBaseline();
  };

  function disarm() {
    if (!armed) return;
    armed = false;
    for (const name of BASELINE_EVENTS) document.removeEventListener(name, onFirstInput, true);
  }

  void input.ready.then(() => {
    if (disposed || !input.enabled() || baseline.value !== null) return;
    armed = true;
    for (const name of BASELINE_EVENTS) document.addEventListener(name, onFirstInput, true);
  });

  onBeforeUnmount(() => {
    disposed = true;
    disarm();
  });

  const changes = computed<AlertFieldChange[]>(() =>
    baseline.value && input.enabled()
      ? diffAlertValues(baseline.value, input.values.value ?? {})
      : [],
  );
  const sections = computed(() => changedSections(changes.value));

  return { changes, sections, baseline, takeBaseline, acceptSaved };
}
