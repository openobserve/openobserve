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

import {
  computed,
  inject,
  provide,
  ref,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import alertsService from "@/services/alerts";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { EvaluateAlertBody, EvaluateAlertResponse } from "@/utils/alerts/alertEvaluate.types";
import type { EventWindow } from "@/utils/alerts/alertBacktest";
import { requestFailureReason, testRunKey } from "@/utils/alerts/alertTestRun";

export type AlertTestRunState = "idle" | "running" | "ready" | "failed";

/** One alert's dry run, shared by the preview that starts it and the 24-hour row that reads it. */
export interface AlertTestRun {
  state: Ref<AlertTestRunState>;
  result: ShallowRef<EvaluateAlertResponse | null>;
  failure: Ref<I18nText | null>;
  /** Key of the alert as it stands now; set by whoever builds the body. */
  currentKey: Ref<string | null>;
  testedKey: Ref<string | null>;
  /** The result while it still answers for the alert as it stands. */
  fresh: ComputedRef<EvaluateAlertResponse | null>;
  run: (org: string, body: EvaluateAlertBody, t: TranslateFn, folder?: string) => Promise<void>;
  cancel: () => void;
  /** The 24-hour row's own count of a real-time alert's events, uncapped, for its current query. */
  eventDay: ShallowRef<RealtimeEventDay | null>;
}

export interface RealtimeEventDay {
  events: number;
  windows: EventWindow[];
}

export const ALERT_TEST_RUN_KEY: InjectionKey<AlertTestRun> = Symbol("alertTestRun");

export function createAlertTestRun(): AlertTestRun {
  const state = ref<AlertTestRunState>("idle");
  const result = shallowRef<EvaluateAlertResponse | null>(null);
  const failure = ref<I18nText | null>(null);
  const currentKey = ref<string | null>(null);
  const testedKey = ref<string | null>(null);
  let controller: AbortController | null = null;
  let generation = 0;

  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    if (state.value === "running") state.value = result.value ? "ready" : "idle";
  };

  const run: AlertTestRun["run"] = async (org, body, t, folder) => {
    cancel();
    const mine = generation;
    controller = new AbortController();
    const key = testRunKey(body);
    state.value = "running";
    try {
      const response = await alertsService.evaluate(
        org,
        { alert: body },
        folder,
        controller.signal,
      );
      if (mine !== generation) return;
      result.value = response.data;
      testedKey.value = key;
      failure.value = null;
      state.value = "ready";
    } catch (error) {
      // A newer run, or a cancel, owns the state now.
      if (mine !== generation) return;
      result.value = null;
      testedKey.value = key;
      failure.value = requestFailureReason(error, t);
      state.value = "failed";
    } finally {
      if (mine === generation) controller = null;
    }
  };

  const fresh = computed(() =>
    state.value === "ready" && testedKey.value !== null && testedKey.value === currentKey.value
      ? result.value
      : null,
  );

  const eventDay = shallowRef<RealtimeEventDay | null>(null);
  return { state, result, failure, currentKey, testedKey, fresh, run, cancel, eventDay };
}

/** The form's shared dry run; a host without one gets its own and passes it down. */
export function useAlertTestRun(): AlertTestRun {
  const shared = inject(ALERT_TEST_RUN_KEY, null);
  if (shared) return shared;
  const own = createAlertTestRun();
  provide(ALERT_TEST_RUN_KEY, own);
  return own;
}

/** For the form that hosts both the preview and the 24-hour row. */
export function provideAlertTestRun(): AlertTestRun {
  const own = createAlertTestRun();
  provide(ALERT_TEST_RUN_KEY, own);
  return own;
}
