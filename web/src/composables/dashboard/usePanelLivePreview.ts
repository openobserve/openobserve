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

import { computed, onScopeDispose, ref, toRaw, watch } from "vue";
import type { Ref } from "vue";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";

export const LIVE_PREVIEW_DEBOUNCE_MS = 600;
export const LIVE_PREVIEW_SLOW_RUN_MS = 10_000;
export const LIVE_PREVIEW_HOLD_POLL_MS = 250;
export const LIVE_PREVIEW_HOLD_MAX_MS = 5_000;

export type LivePreviewApplyState = "refresh" | "pending" | "typed" | "slow" | "incomplete";

export interface UsePanelLivePreviewOptions {
  /** The panel being edited (dashboardPanelData.data). */
  panel: () => any;
  /** The panel the chart last ran with (the editor's chartData). */
  applied: () => any;
  liveVariables: () => any[];
  committedVariables: () => any[];
  /** Silent validation of the builder; never notifies. */
  isBuilderValid: () => boolean;
  /** True while the chart has a query in flight. */
  isLoading: Ref<boolean>;
  run: () => void;
  debounceMs?: number;
  /** Whether a select list is open; live runs wait for the pick (capped). */
  isOverlayOpen?: () => boolean;
}

const queryPayload = (query: any) => ({
  query: query?.query ?? "",
  vrl: query?.vrlFunctionQuery ?? "",
  streamType: query?.fields?.stream_type ?? "",
  step: query?.config?.step_value ?? null,
});

/** What the backend would receive for this panel, minus time range and variables. */
export const panelPayloadSignature = (panel: any): string =>
  JSON.stringify({
    queryType: panel?.queryType ?? "",
    queries: (panel?.queries ?? []).map(queryPayload),
  });

export const variablesSignature = (variables: any[] | undefined): string =>
  JSON.stringify(
    (variables ?? [])
      .map((variable: any) => ({
        name: variable?.name,
        value: Array.isArray(variable?.value)
          ? [...variable.value].map((v) => JSON.stringify(v)).sort()
          : (variable?.value ?? null),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  );

/** Query text the user typed (custom SQL/PromQL or a VRL function) that differs from what last ran. */
export const hasTypedChanges = (panel: any, applied: any): boolean => {
  if (!applied?.queries) return false;
  return (panel?.queries ?? []).some((query: any, index: number) => {
    const ran = applied.queries[index];
    const vrlChanged = (query?.vrlFunctionQuery ?? "") !== (ran?.vrlFunctionQuery ?? "");
    const typedText = query?.customQuery && (query?.query ?? "").trim() !== "";
    return vrlChanged || (typedText && query.query !== ran?.query);
  });
};

// The Builder/Custom toggle alone changes nothing the backend receives.
const withoutEditorMode = (panel: any) =>
  panel && {
    ...panel,
    queries: (panel.queries ?? []).map((query: any) => ({ ...query, customQuery: false })),
  };

/** An open select list (field or function picker), but not menus, popovers or tooltips. */
export const isPopupOpen = (): boolean =>
  Array.from(document.querySelectorAll("[data-reka-popper-content-wrapper]")).some((wrapper) =>
    wrapper.querySelector('[role="listbox"]'),
  );

/**
 * Smart live preview for the dashboard panel editor: re-runs the chart when the backend
 * payload of a builder edit changes, never for typed query text.
 */
export const usePanelLivePreview = (options: UsePanelLivePreviewOptions) => {
  const debounceMs = options.debounceMs ?? LIVE_PREVIEW_DEBOUNCE_MS;
  const isOverlayOpen = options.isOverlayOpen ?? isPopupOpen;

  const isArmed = ref(false);
  const isSlowPaused = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let runStartedAt: number | null = null;
  let holdStartedAt: number | null = null;

  // Query text a newly added tab was seeded with; an untouched new tab is not a reason to run.
  const tabSeeds = new WeakMap<object, string>();
  const seedVersion = ref(0);

  const isUntouchedNewTab = (query: any, index: number, appliedCount: number) => {
    if (index < appliedCount) return false;
    const text = query?.query ?? "";
    return text.trim() === "" || tabSeeds.get(toRaw(query)) === text;
  };

  const recordTabSeeds = () => {
    const appliedCount = options.applied()?.queries?.length ?? 0;
    (options.panel()?.queries ?? []).forEach((query: any, index: number) => {
      const raw = query && toRaw(query);
      if (index < appliedCount || !raw || tabSeeds.has(raw) || query.customQuery) return;
      if ((query.query ?? "").trim() === "") return;
      tabSeeds.set(raw, query.query);
      seedVersion.value++;
    });
  };

  const isTypedPending = computed(() => hasTypedChanges(options.panel(), options.applied()));

  const variablesChanged = computed(
    () =>
      variablesSignature(options.liveVariables()) !==
      variablesSignature(options.committedVariables()),
  );

  const payloadChanged = computed(
    () => panelPayloadSignature(options.panel()) !== panelPayloadSignature(options.applied()),
  );

  /** Payload change worth a live run: ignores new tabs still holding their seeded query. */
  const liveChanged = computed(() => {
    void seedVersion.value;
    const panel = options.panel();
    const appliedCount = options.applied()?.queries?.length ?? 0;
    const queries = (panel?.queries ?? []).filter(
      (query: any, index: number) => !isUntouchedNewTab(query, index, appliedCount),
    );
    return (
      panelPayloadSignature({ ...panel, queries }) !== panelPayloadSignature(options.applied()) ||
      variablesChanged.value
    );
  });

  const isOutdated = computed(() => {
    const applied = options.applied();
    if (!applied) return false;
    return (
      payloadChanged.value ||
      variablesChanged.value ||
      checkIfConfigChangeRequiredApiCallOrNot(
        withoutEditorMode(applied),
        withoutEditorMode(options.panel()),
      )
    );
  });

  const isIncomplete = computed(
    () => isArmed.value && !isTypedPending.value && isOutdated.value && !options.isBuilderValid(),
  );

  const isPending = computed(
    () => isArmed.value && (isTypedPending.value || (isOutdated.value && !isIncomplete.value)),
  );

  const applyState = computed<LivePreviewApplyState>(() => {
    if (isTypedPending.value && isArmed.value) return "typed";
    if (isIncomplete.value) return "incomplete";
    if (!isPending.value) return "refresh";
    if (isSlowPaused.value) return "slow";
    return "pending";
  });

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    holdStartedAt = null;
  };

  /** Restarts the run clock so a superseded run's time is not charged to the new one. */
  const markRunStarted = () => {
    clearTimer();
    runStartedAt = options.isLoading.value ? Date.now() : null;
  };

  const shouldHold = () => {
    if (!isOverlayOpen()) return false;
    holdStartedAt ??= Date.now();
    return Date.now() - holdStartedAt < LIVE_PREVIEW_HOLD_MAX_MS;
  };

  const fire = () => {
    timer = null;
    if (isTypedPending.value || isSlowPaused.value) return;
    if (shouldHold()) {
      timer = setTimeout(fire, LIVE_PREVIEW_HOLD_POLL_MS);
      return;
    }
    holdStartedAt = null;
    if (!options.isBuilderValid() || !liveChanged.value) return;
    markRunStarted();
    options.run();
  };

  const schedule = () => {
    clearTimer();
    timer = setTimeout(fire, debounceMs);
  };

  const arm = () => {
    isArmed.value = true;
  };

  watch(
    () => panelPayloadSignature(options.panel()) + variablesSignature(options.liveVariables()),
    () => {
      recordTabSeeds();
      if (isArmed.value) schedule();
    },
  );

  watch(options.isLoading, (loading) => {
    if (loading) {
      runStartedAt ??= Date.now();
      return;
    }
    if (runStartedAt === null) return;
    isSlowPaused.value = Date.now() - runStartedAt > LIVE_PREVIEW_SLOW_RUN_MS;
    runStartedAt = null;
  });

  onScopeDispose(clearTimer);

  return {
    isArmed,
    isPending,
    isTypedPending,
    isSlowPaused,
    applyState,
    arm,
    markRunStarted,
    cancelScheduled: clearTimer,
  };
};

export default usePanelLivePreview;
