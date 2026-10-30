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
import { useStore } from "vuex";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { alertActionErrorOf } from "@/services/alerts";
import {
  ackAlertMutation,
  cancelAlertMuteMutation,
  extendAlertMuteMutation,
  muteAlertMutation,
  unackAlertMutation,
} from "@/services/alerts.queries";
import { downtimeDetailQuery } from "@/services/downtimes.queries";
import type {
  AckAlertRequest,
  AlertActionError,
  AlertActionPerson,
  AlertActionRefusal,
  ExtendAlertMuteRequest,
  MuteAlertResponse,
} from "@/ts/interfaces/alert";
import { toast } from "@/lib/feedback/Toast/useToast";
import { buildAlertMuteRequest, endTimeText, type AlertMuteEnd } from "@/utils/downtimes/quickMute";

/** The alert an action is for; `folderId` is the alert's own folder, which the route check reads. */
export interface AlertActionTarget {
  alertId: string;
  name: string;
  folderId?: string;
}

/** A live quick mute as the screens know it; `version` is absent on chips from older nodes. */
export interface AlertMuteRef {
  id: string;
  ends_at: number;
  version?: number;
}

export interface AlertMuteScope {
  groups?: string[];
  allGroups?: boolean;
  firingStartedAt?: number;
  reason?: string;
  /** The downtimes folder the mute is filed in; the server picks one when absent. */
  folderId?: string;
}

const personName = (p: AlertActionPerson) => p.name || p.email;

const extendBody = (version: number, end: AlertMuteEnd): ExtendAlertMuteRequest =>
  "untilClear" in end
    ? { version, until_clear: true }
    : "minutes" in end
      ? { version, minutes: end.minutes }
      : { version, ends_at: end.endsAt };

/** Ack and Mute from the alert screens, through the alert-scoped routes, with one toast per outcome. */
export function useAlertActions() {
  const { t } = useI18nTyped();
  const store = useStore();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const zone = useViewerTimezone();

  const ackWrite = useMutation(() => ackAlertMutation(orgId.value));
  const unackWrite = useMutation(() => unackAlertMutation(orgId.value));
  const muteWrite = useMutation(() => muteAlertMutation(orgId.value));
  const extendWrite = useMutation(() => extendAlertMuteMutation(orgId.value));
  const cancelWrite = useMutation(() => cancelAlertMuteMutation(orgId.value));

  const me = computed<string>(() => store.state.userInfo?.email ?? "");
  const pending = computed(
    () =>
      ackWrite.isPending.value ||
      unackWrite.isPending.value ||
      muteWrite.isPending.value ||
      extendWrite.isPending.value ||
      cancelWrite.isPending.value,
  );

  const timeOf = (micros: number): I18nText =>
    endTimeText(micros, Date.now() * 1000, zone.value, t);

  const refusalToast = (refusal: AlertActionRefusal) => {
    const onCall = raw(refusal.on_call.map(personName).join(", "));
    const canAct = raw(refusal.can_act.map(personName).join(", "));
    const reason =
      refusal.code === "mute_refused" ? t("alerts.ack.refused.mute") : t("alerts.ack.refused.ack");
    const people: I18nText | null =
      onCall && canAct
        ? t("alerts.ack.refused.people", { onCall, canAct })
        : onCall
          ? t("alerts.ack.refused.onCall", { people: onCall })
          : canAct
            ? t("alerts.ack.refused.canAct", { people: canAct })
            : null;
    toast(
      people
        ? { variant: "error", title: reason, message: people }
        : { variant: "error", message: reason },
    );
  };

  /** Toasts the typed refusals every route shares; false when the error is not one of them. */
  const sharedErrorToast = (error: AlertActionError | null): boolean => {
    if (!error) return false;
    if (error.code === "ack_refused" || error.code === "mute_refused") {
      refusalToast(error);
      return true;
    }
    if (error.code === "not_a_quick_mute") {
      toast({ variant: "error", message: t("toastMessages.downtimes.notQuickMute") });
      return true;
    }
    return false;
  };

  const sendAck = async (
    target: AlertActionTarget,
    body: AckAlertRequest,
    takeOver: boolean,
  ): Promise<boolean> => {
    const name = raw(target.name);
    try {
      const result = await ackWrite.mutateAsync({
        alertId: target.alertId,
        body,
        folderId: target.folderId,
      });
      const holder = result.acks.find((a) => a.acked_by !== me.value);
      if (!result.changed && holder) {
        toast({
          variant: "info",
          message: t("toastMessages.alerts.ack.alreadyAcked", { who: raw(holder.acked_by) }),
        });
      } else if (takeOver) {
        toast({ variant: "success", message: t("toastMessages.alerts.ack.takenOver", { name }) });
      } else if (body.all_groups) {
        const count = result.acks.length;
        toast({
          variant: "success",
          message: t("toastMessages.alerts.ack.ackedGroups", { count, name }, count),
        });
      } else {
        toast({ variant: "success", message: t("toastMessages.alerts.ack.acked", { name }) });
      }
      return true;
    } catch (err: unknown) {
      const error = alertActionErrorOf(err);
      if (sharedErrorToast(error)) return false;
      const message =
        error?.code === "not_firing"
          ? t("alerts.ack.errors.notFiring")
          : error?.code === "firing_changed"
            ? t("alerts.ack.errors.firingChanged")
            : t("toastMessages.alerts.ack.failed", { name });
      toast({ variant: "error", message });
      return false;
    }
  };

  const acknowledge = (
    target: AlertActionTarget,
    opts: { groupKey?: string; firingStartedAt?: number; allGroups?: boolean } = {},
  ) => {
    const body: AckAlertRequest = opts.allGroups
      ? { all_groups: true }
      : { group_key: opts.groupKey ?? "" };
    if (!opts.allGroups && opts.firingStartedAt !== undefined) {
      body.firing_started_at = opts.firingStartedAt;
    }
    return sendAck(target, body, false);
  };

  const takeOver = (
    target: AlertActionTarget,
    opts: { groupKey: string; firingStartedAt?: number },
  ) => {
    const body: AckAlertRequest = { group_key: opts.groupKey, take_over: true };
    if (opts.firingStartedAt !== undefined) body.firing_started_at = opts.firingStartedAt;
    return sendAck(target, body, true);
  };

  const unacknowledge = async (
    target: AlertActionTarget,
    opts: { groupKey: string; firingStartedAt?: number },
  ): Promise<boolean> => {
    const name = raw(target.name);
    const body =
      opts.firingStartedAt === undefined
        ? { group_key: opts.groupKey }
        : { group_key: opts.groupKey, firing_started_at: opts.firingStartedAt };
    try {
      await unackWrite.mutateAsync({ alertId: target.alertId, body, folderId: target.folderId });
      toast({ variant: "success", message: t("toastMessages.alerts.ack.unacked", { name }) });
      return true;
    } catch (err: unknown) {
      if (sharedErrorToast(alertActionErrorOf(err))) return false;
      toast({ variant: "error", message: t("toastMessages.alerts.ack.unackFailed", { name }) });
      return false;
    }
  };

  const createMute = async (
    target: AlertActionTarget,
    end: AlertMuteEnd,
    scope: AlertMuteScope = {},
  ): Promise<MuteAlertResponse | null> => {
    const name = raw(target.name);
    const body = buildAlertMuteRequest({ ...end, ...scope });
    try {
      const result = await muteWrite.mutateAsync({
        alertId: target.alertId,
        body,
        folderId: target.folderId,
      });
      const time = timeOf(result.ends_at);
      toast({
        variant: "success",
        message:
          "untilClear" in end
            ? t("toastMessages.downtimes.mutedUntilClear", { name, time })
            : t("toastMessages.downtimes.mutedOne", { name, time }),
      });
      return result;
    } catch (err: unknown) {
      const error = alertActionErrorOf(err);
      if (sharedErrorToast(error)) return null;
      const message =
        error?.code === "already_muted"
          ? t("toastMessages.downtimes.alreadyMuted", { name, time: timeOf(error.ends_at) })
          : error?.code === "downtime_cap"
            ? raw(error.message)
            : t("toastMessages.downtimes.muteFailed");
      toast({ variant: "error", message });
      return null;
    }
  };

  const mute = async (
    target: AlertActionTarget,
    end: AlertMuteEnd,
    scope: AlertMuteScope = {},
  ): Promise<boolean> => (await createMute(target, end, scope)) !== null;

  // A chip from an older node carries no version, so the stored row supplies it.
  const versionOf = async (downtime: AlertMuteRef): Promise<number | null> => {
    if (downtime.version !== undefined) return downtime.version;
    try {
      const row = await queryClient.fetchQuery(downtimeDetailQuery(orgId.value, downtime.id));
      return row.version ?? null;
    } catch {
      return null;
    }
  };

  const extend = async (
    target: AlertActionTarget,
    downtime: AlertMuteRef,
    end: AlertMuteEnd,
  ): Promise<boolean> => {
    const version = await versionOf(downtime);
    if (version === null) {
      toast({ variant: "error", message: t("toastMessages.downtimes.extendFailed") });
      return false;
    }
    try {
      const result = await extendWrite.mutateAsync({
        alertId: target.alertId,
        downtimeId: downtime.id,
        body: extendBody(version, end),
        folderId: target.folderId,
      });
      toast({
        variant: "success",
        message: t("toastMessages.downtimes.extended", { time: timeOf(result.ends_at) }),
      });
      return true;
    } catch (err: unknown) {
      const error = alertActionErrorOf(err);
      if (sharedErrorToast(error)) return false;
      const message =
        error?.code === "version_changed"
          ? t("toastMessages.downtimes.muteChanged", { time: timeOf(error.ends_at) })
          : t("toastMessages.downtimes.extendFailed");
      toast({ variant: "error", message });
      return false;
    }
  };

  const endMute = async (target: AlertActionTarget, downtimeId: string): Promise<boolean> => {
    try {
      await cancelWrite.mutateAsync({
        alertId: target.alertId,
        downtimeId,
        folderId: target.folderId,
      });
      toast({ variant: "success", message: t("toastMessages.downtimes.muteEnded") });
      return true;
    } catch (err: unknown) {
      if (sharedErrorToast(alertActionErrorOf(err))) return false;
      toast({ variant: "error", message: t("toastMessages.downtimes.cancelFailed") });
      return false;
    }
  };

  return {
    me,
    pending,
    acknowledge,
    takeOver,
    unacknowledge,
    mute,
    createMute,
    extend,
    endMute,
  };
}
