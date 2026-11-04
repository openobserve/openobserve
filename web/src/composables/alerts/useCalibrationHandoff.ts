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

import { computed, nextTick, onBeforeUnmount, shallowRef } from "vue";
import type { useAlertForm } from "@/composables/useAlertForm";
import type { AlertEditorDraft } from "@/composables/alerts/useAlertEditorDraft";
import { queryClient } from "@/composables/query/queryClient";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { alertDetailQuery } from "@/services/alerts.queries";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { AlertEditHandoff, AlertFieldPatch } from "@/ts/interfaces/alertPrefill";
import { takeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import {
  CALIBRATION_PREFILL,
  planEditHandoff,
  type EditHandoffPlan,
} from "@/utils/alerts/alertEditHandoff";
import { applyCopy, type ApplyCopy } from "@/components/alert_calibration/applySuggestion";

type AlertForm = ReturnType<typeof useAlertForm>;

/** Applied and review are info, a patch withheld is amber, an unsupported type is neutral. */
export interface CalibrationBanner {
  variant: "info" | "warning" | "default";
  text: I18nText;
}

export interface UseCalibrationHandoffOptions {
  form: AlertForm;
  editorDraft: AlertEditorDraft;
  /** The alert as the server returned it, in wire units. */
  modelValue: () => Record<string, unknown> | null | undefined;
}

/** Reads a calibration handoff once, after the draft guard started, and applies its patch only onto clean, fresh values. */
export const useCalibrationHandoff = ({
  form,
  editorDraft,
  modelValue,
}: UseCalibrationHandoffOptions) => {
  const { t, locale } = useI18nTyped();
  const route = form.router.currentRoute;
  /** The banner's row is held from first paint, so the form never moves when the banner arrives. */
  const reserved = computed(() => route.value.query.prefill === CALIBRATION_PREFILL);
  const banner = shallowRef<CalibrationBanner | null>(null);
  let active = true;
  onBeforeUnmount(() => {
    active = false;
  });

  const orgId = () => String(form.store.state.selectedOrganization?.identifier ?? "");

  // Null when the list cannot be read, since an unchecked destination must never be attached.
  const destinationNames = async (patch?: AlertFieldPatch): Promise<string[] | null> => {
    if (!patch?.destinations) return [];
    try {
      // The catalogue is cached for an hour, so a destination deleted since then would pass.
      const list: unknown[] = await queryClient.fetchQuery({
        ...destinationsQuery(orgId(), "alert"),
        staleTime: 0,
      });
      return list.flatMap((item) => {
        const name = (item as { name?: unknown } | null)?.name;
        return typeof name === "string" ? [name] : [];
      });
    } catch {
      return null;
    }
  };

  // The editor's own read and the prompt's may be up to a minute old, so the from check needs the server's current values.
  const freshAlert = async (alertId: string): Promise<Record<string, unknown> | null> => {
    try {
      return await queryClient.fetchQuery({ ...alertDetailQuery(orgId(), alertId), staleTime: 0 });
    } catch {
      // A failed read plans as invalid, since an empty alert never matches the handoff's target.
      return null;
    }
  };

  const focus = async (plan: EditHandoffPlan) => {
    if (!plan.focusField) return;
    await nextTick();
    form.focusManager.focusField(plan.focusField);
  };

  const apply = async (
    handoff: AlertEditHandoff,
    plan: EditHandoffPlan,
    copy: ApplyCopy,
  ): Promise<CalibrationBanner> => {
    // A stored draft or an edit typed while the checks ran is the user's own work, so a suggestion never lands over it (P6-D6).
    if (editorDraft.hasStoredDraft() || editorDraft.draft.hasUnsavedChanges()) {
      return { variant: "warning", text: copy.notApplied("draft") };
    }
    const patch = handoff.patch as AlertFieldPatch;
    await editorDraft.applyProgrammaticChange(() => form.applyFieldPatch(patch));
    await focus(plan);
    return { variant: "info", text: copy.applied(plan.fields) };
  };

  const outcome = async (
    handoff: AlertEditHandoff,
    plan: EditHandoffPlan,
    copy: ApplyCopy,
  ): Promise<CalibrationBanner> => {
    switch (plan.status) {
      case "apply":
        return apply(handoff, plan, copy);
      case "review":
        await focus(plan);
        return { variant: "info", text: copy.review() };
      case "unsupported":
        return { variant: "default", text: copy.unsupported() };
      case "stale":
        return { variant: "warning", text: copy.notApplied("stale") };
      case "missing_destination":
        return {
          variant: "warning",
          text: copy.notApplied("missingDestination", plan.missingDestinations),
        };
      default:
        return { variant: "warning", text: copy.notApplied("invalid") };
    }
  };

  const run = async () => {
    if (!reserved.value || !form.beingUpdated.value) return;
    const alertId = route.value.params.alert_id;
    if (typeof alertId !== "string") return;
    const handoff = takeAlertEditHandoff(alertId);
    if (!handoff) return;
    const names = await destinationNames(handoff.patch);
    const alert = handoff.patch ? await freshAlert(alertId) : (modelValue() ?? {});
    if (!active) return;
    const plan = planEditHandoff(handoff, alert ?? {}, names ?? []);
    const copy = applyCopy(t, locale.value);
    const unchecked = names === null && ["apply", "missing_destination"].includes(plan.status);
    const checked: EditHandoffPlan = unchecked ? { ...plan, status: "invalid" } : plan;
    const result = await outcome(handoff, checked, copy);
    if (active) banner.value = result;
  };

  return { reserved, banner, run };
};
