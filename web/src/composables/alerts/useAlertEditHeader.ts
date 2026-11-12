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

import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { formatInTimeZone } from "date-fns-tz";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useAlertActions, type AlertMuteRef } from "@/composables/alerts/useAlertActions";
import { useDowntimesEnabled } from "@/composables/downtimes/useDowntimesEnabled";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { alertsListQuery, toggleAlertStateMutation } from "@/services/alerts.queries";
import alertsService from "@/services/alerts";
import type { ActiveDowntime } from "@/services/downtimes";
import type { EnableAlertResponseBody, TriggerAlertResponseBody } from "@/ts/interfaces/alert";
import { toast } from "@/lib/feedback/Toast/useToast";

// Longer delays overflow setTimeout and fire at once, so a long mute re-checks in steps.
const MAX_TIMER_MS = 2_147_483_647;

export interface AlertEditHeaderInput {
  alertId: () => string;
  name: () => string;
  folderId: () => string | undefined;
  /** Called with the state the server saved, so the open form does not send the old one back. */
  onEnabledSaved?: (enabled: boolean) => void;
}

interface AlertListRow {
  alert_id?: string;
  id?: string;
  enabled?: boolean;
  last_outcome?: string | null;
  active_downtime?: (ActiveDowntime & { version?: number }) | null;
}

/** What the state chip shows: a run outcome, a disabled alert, or no run yet. */
export type AlertEditState =
  { kind: "outcome"; value: string } | { kind: "disabled" } | { kind: "notRun" };

export interface AlertEditHeader {
  muteEnabled: ComputedRef<boolean>;
  muted: ComputedRef<AlertMuteRef | null>;
  mutedUntilText: ComputedRef<I18nText>;
  enabled: ComputedRef<boolean>;
  state: ComputedRef<AlertEditState>;
  pending: ComputedRef<boolean>;
  /** The "Fire now" confirmation is open; shared so a trigger in a closing menu can still open it. */
  fireOpen: ComputedRef<boolean>;
  setFireOpen: (open: boolean) => void;
  muteFor: (seconds: number) => Promise<boolean>;
  unmute: () => Promise<boolean>;
  fireNow: () => Promise<void>;
  toggleEnabled: () => Promise<void>;
  exportDefinition: () => Promise<Record<string, unknown> | null>;
  clone: (name: string) => Promise<boolean>;
  refresh: () => void;
}

const serverMessage = (error: unknown): string => {
  const message = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data
    ?.message;
  return typeof message === "string" ? message : "";
};

/** State and actions for the edit page's header, through the same services the alert list uses. */
export function useAlertEditHeader(input: AlertEditHeaderInput): AlertEditHeader {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const zone = useViewerTimezone();
  const actions = useAlertActions();
  const muteEnabled = useDowntimesEnabled();
  const toggleWrite = useMutation(() => toggleAlertStateMutation(orgId.value));
  const busy = ref(false);

  // The alert GET carries no run state or mute, so the header reads the alert's list row, as AlertDetail does.
  const listQuery = useQuery(() =>
    Object.assign(alertsListQuery(orgId.value, input.folderId() ?? "", input.name()), {
      enabled: !!orgId.value && !!input.alertId() && !!input.name(),
    }),
  );
  const row = computed<AlertListRow | null>(
    () =>
      ((listQuery.data.value as AlertListRow[] | undefined) ?? []).find(
        (r) => (r.alert_id ?? r.id) === input.alertId(),
      ) ?? null,
  );

  // undefined = the list row decides; an action here holds only until a list read started after it lands.
  const localMute = ref<AlertMuteRef | null | undefined>(undefined);
  const localEnabled = ref<boolean | undefined>(undefined);
  let localGen = 0;
  let readGen = -1;
  const holdLocal = () => {
    localGen += 1;
  };
  watch(
    () => listQuery.isFetching.value,
    (fetching) => {
      if (fetching) {
        readGen = localGen;
      } else if (readGen === localGen && listQuery.isSuccess.value) {
        localMute.value = undefined;
        localEnabled.value = undefined;
      }
    },
    { flush: "sync" },
  );

  const activeMute = computed<AlertMuteRef | null>(() => {
    if (localMute.value !== undefined) return localMute.value;
    const downtime = row.value?.active_downtime;
    // A group mute is ended from its group's row, so it does not mute the whole alert here.
    if (!downtime || downtime.alert_groups?.length) return null;
    return { id: downtime.id, ends_at: downtime.ends_at, version: downtime.version };
  });

  const now = ref(Date.now());
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [activeMute, now],
    ([mute]) => {
      clearTimeout(expiryTimer);
      if (!mute) return;
      const endsMs = mute.ends_at / 1000;
      const left = endsMs - Date.now();
      if (left > 0) {
        expiryTimer = setTimeout(() => (now.value = Date.now()), Math.min(left, MAX_TIMER_MS));
      } else if (now.value < endsMs) {
        now.value = Date.now();
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => clearTimeout(expiryTimer));

  const muted = computed<AlertMuteRef | null>(() => {
    const mute = activeMute.value;
    return mute && mute.ends_at / 1000 > now.value ? mute : null;
  });

  const mutedUntilText = computed<I18nText>(() =>
    muted.value
      ? t("alerts.editMode.mutedUntil", {
          time: formatInTimeZone(new Date(muted.value.ends_at / 1000), zone.value, "HH:mm"),
        })
      : raw(""),
  );

  const enabled = computed(() => localEnabled.value ?? row.value?.enabled ?? true);

  const state = computed<AlertEditState>(() => {
    if (!enabled.value) return { kind: "disabled" };
    const outcome = row.value?.last_outcome;
    return outcome ? { kind: "outcome", value: outcome } : { kind: "notRun" };
  });

  const target = () => ({
    alertId: input.alertId(),
    name: input.name(),
    folderId: input.folderId(),
  });

  const muteFor = async (seconds: number): Promise<boolean> => {
    const result = await actions.createMute(target(), { minutes: seconds / 60 });
    if (!result) return false;
    holdLocal();
    localMute.value = { id: result.downtime_id, ends_at: result.ends_at, version: result.version };
    return true;
  };

  const unmute = async (): Promise<boolean> => {
    const current = muted.value;
    if (!current) return false;
    const ok = await actions.endMute(target(), current.id);
    if (ok) {
      holdLocal();
      localMute.value = null;
    }
    return ok;
  };

  const fireNow = async () => {
    busy.value = true;
    try {
      const res = await alertsService.trigger_alert(orgId.value, input.alertId(), input.folderId());
      const data = res?.data as TriggerAlertResponseBody | undefined;
      // A lost claim or an ineligible alert means nothing ran, so success would mislead.
      toast(
        data?.claim_lost === true
          ? { variant: "warning", message: t("alerts.anomaly.detectionAlreadyRunning") }
          : data?.ineligible === true
            ? {
                variant: "warning",
                message: raw(data.message ?? "") || t("alerts.messages.triggerAlertFailed"),
              }
            : { variant: "success", message: t("alerts.alertTriggeredSuccess") },
      );
    } catch (error: unknown) {
      toast({
        variant: "error",
        message: raw(serverMessage(error)) || t("alerts.messages.triggerAlertFailed"),
      });
    } finally {
      busy.value = false;
    }
  };

  const toggleEnabled = async () => {
    try {
      const res = await toggleWrite.mutateAsync({
        alertId: input.alertId(),
        enabled: !enabled.value,
        folderId: input.folderId(),
      });
      holdLocal();
      localEnabled.value =
        (res?.data as EnableAlertResponseBody | undefined)?.enabled ?? !enabled.value;
      input.onEnabledSaved?.(localEnabled.value);
      toast({
        variant: "success",
        message: localEnabled.value
          ? t("toastMessages.alerts.alertResumedSuccessfully")
          : t("toastMessages.alerts.alertPausedSuccessfully"),
      });
    } catch {
      // The mutation's central handler already toasts the failure.
    }
  };

  const exportDefinition = async (): Promise<Record<string, unknown> | null> => {
    try {
      const res = await alertsService.export_by_id(orgId.value, input.alertId());
      const data = res.data;
      if (!data) throw new Error("empty export payload");
      // An id belongs to the alert that was exported, not to the one this definition will create.
      if (Object.prototype.hasOwnProperty.call(data, "id")) delete data.id;
      return data;
    } catch (error: unknown) {
      toast({
        variant: "error",
        message:
          raw(serverMessage(error)) || t("toastMessages.alerts.errorExportingAlertsPleaseTryAgain"),
      });
      return null;
    }
  };

  const clone = async (name: string): Promise<boolean> => {
    const folder = input.folderId() || "default";
    try {
      await alertsService.clone_by_id(
        orgId.value,
        input.alertId(),
        { name, folder_id: folder },
        folder,
      );
      toast({ variant: "success", message: t("alerts.editMode.cloneDone", { name: raw(name) }) });
      return true;
    } catch (error: unknown) {
      toast({
        variant: "error",
        message: raw(serverMessage(error)) || t("alerts.editMode.cloneFailed"),
      });
      return false;
    }
  };

  const pending = computed(
    () => busy.value || actions.pending.value || toggleWrite.isPending.value,
  );

  const fireOpen = ref(false);

  return {
    muteEnabled,
    muted,
    mutedUntilText,
    enabled,
    state,
    pending,
    fireOpen: computed(() => fireOpen.value),
    setFireOpen: (open) => {
      fireOpen.value = open;
    },
    muteFor,
    unmute,
    fireNow,
    toggleEnabled,
    exportDefinition,
    clone,
    refresh: () => void listQuery.refetch(),
  };
}
