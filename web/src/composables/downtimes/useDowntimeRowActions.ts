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

import { ref } from "vue";
import { useRouter } from "vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import {
  cancelDowntimeMutation,
  downtimeDetailQuery,
  extendDowntimeMutation,
  mutedListKeys,
} from "@/services/downtimes.queries";
import type { ActiveDowntime, DowntimeListItem, ExtendDowntimeRequest } from "@/services/downtimes";
import { toast } from "@/lib/feedback/Toast/useToast";
import { endTimeText } from "@/utils/downtimes/quickMute";
import { downtimeLink } from "@/utils/downtimes/link";
import { failureResult, failureStatus, type MuteActionResult } from "@/utils/downtimes/muteResult";

/** What a write needs of the mute: the row's version guards it, the folder routes it. */
type MuteRow = Pick<ActiveDowntime, "id" | "folder_id" | "version">;

/** End and Extend of an anomaly or synthetics row's own mute, through the downtime routes. */
export function useDowntimeRowActions() {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const zone = useViewerTimezone();
  const cancelWrite = useMutation(() => cancelDowntimeMutation(orgId.value));
  const extendWrite = useMutation(() => extendDowntimeMutation(orgId.value));

  const extendUntilOpen = ref(false);
  const extendUntilRow = ref<DowntimeListItem | null>(null);

  // A refused write invalidates nothing on its own, yet the row it acted on is stale.
  const refetchLists = () => {
    for (const key of mutedListKeys(orgId.value)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const failed = (err: unknown, downtime: MuteRow, fallback: "cancel" | "extend") => {
    const status = failureStatus(err);
    if (status !== undefined) refetchLists();
    if (status === 409) {
      toast({
        variant: "error",
        message: t("toastMessages.downtimes.muteChangedOpen"),
        action: {
          label: t("toastMessages.downtimes.viewDowntime"),
          handler: () => void router?.push(downtimeLink(downtime, orgId.value)),
        },
      });
    } else if (status === 403) {
      toast({ variant: "error", message: t("toastMessages.downtimes.noPermissionToEnd") });
    } else {
      const message =
        fallback === "cancel"
          ? t("toastMessages.downtimes.cancelFailed")
          : t("toastMessages.downtimes.extendFailed");
      toast({ variant: "error", message });
    }
    return failureResult(err);
  };

  const end = async (downtime: ActiveDowntime): Promise<MuteActionResult> => {
    try {
      await cancelWrite.mutateAsync({
        id: downtime.id,
        folder: downtime.folder_id || undefined,
        version: downtime.version,
      });
      toast({ variant: "success", message: t("toastMessages.downtimes.muteEnded") });
      return "ok";
    } catch (err: unknown) {
      return failed(err, downtime, "cancel");
    }
  };

  const extendWith = async (
    downtime: MuteRow,
    body: ExtendDowntimeRequest,
  ): Promise<MuteActionResult> => {
    try {
      const result = await extendWrite.mutateAsync({
        id: downtime.id,
        body: { ...body, version: downtime.version },
        folder: downtime.folder_id || undefined,
      });
      const ends = result.schedule?.ends_at;
      const time = ends ? endTimeText(ends, Date.now() * 1000, zone.value, t) : "";
      toast({ variant: "success", message: t("toastMessages.downtimes.extended", { time }) });
      return "ok";
    } catch (err: unknown) {
      return failed(err, downtime, "extend");
    }
  };

  const extendBy = (downtime: ActiveDowntime, seconds: number) =>
    extendWith(downtime, { by_secs: seconds });

  /** The submit of the Extend until… dialog that [openExtendUntil] opened. */
  const extendUntil = async (until: number): Promise<MuteActionResult> => {
    const row = extendUntilRow.value;
    if (!row) return "failed";
    return extendWith(row, { until });
  };

  /** Extend until… needs the stored window; the row's version still guards the write. */
  const openExtendUntil = async (downtime: ActiveDowntime) => {
    try {
      const row = await queryClient.fetchQuery(
        downtimeDetailQuery(orgId.value, downtime.id, downtime.folder_id || undefined),
      );
      extendUntilRow.value = { ...row, version: downtime.version ?? row.version };
      extendUntilOpen.value = true;
    } catch (err: unknown) {
      failed(err, downtime, "extend");
    }
  };

  return { end, extendBy, extendUntil, openExtendUntil, extendUntilOpen, extendUntilRow };
}
