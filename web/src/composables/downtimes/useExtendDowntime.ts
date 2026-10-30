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

import { useRouter } from "vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { formatInTimeZone } from "date-fns-tz";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { extendDowntimeMutation } from "@/services/downtimes.queries";
import { downtimeKeys } from "@/services/downtimes.querykeys";
import type { Downtime, ExtendDowntimeRequest, ExtendDowntimeResponse } from "@/services/downtimes";
import { toast } from "@/lib/feedback/Toast/useToast";
import { dbmHttpError } from "@/utils/dbm/format";

/** Extends a downtime and confirms with the new end, or with a link to the follow-up it created. */
export function useExtendDowntime() {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const router = useRouter();
  const mutation = useMutation(() => extendDowntimeMutation(orgId.value));
  const queryClient = useQueryClient();
  // The zone the downtime pages show times in, read once so the dialog and its toast agree.
  const timezone = useViewerTimezone().value;

  const endText = (micros?: number | null) =>
    micros
      ? `${formatInTimeZone(new Date(micros / 1000), timezone, "d MMM HH:mm")} ${timezone}`
      : "";

  const extend = async (
    row: Pick<Downtime, "id" | "folder_id" | "version">,
    body: ExtendDowntimeRequest,
  ): Promise<ExtendDowntimeResponse | null> => {
    const sent = row.version === undefined ? body : { ...body, version: row.version };
    try {
      const result = await mutation.mutateAsync({ id: row.id, body: sent, folder: row.folder_id });
      const time = endText(result.schedule.ends_at);
      const createdId = result.created_id;
      if (createdId) {
        toast({
          variant: "success",
          message: t("toastMessages.downtimes.extendedFollowUp", { name: result.name, time }),
          action: {
            label: t("toastMessages.downtimes.viewDowntime"),
            handler: () => {
              void router.push({
                name: "downtimeDetail",
                params: { id: createdId },
                query: { org_identifier: orgId.value, folder: result.folder_id },
              });
            },
          },
        });
      } else {
        toast({ variant: "success", message: t("toastMessages.downtimes.extended", { time }) });
      }
      return result;
    } catch (err: unknown) {
      const { status, serverMessage } = dbmHttpError(err);
      // A 409 means the row moved since it was loaded, so the lists reload to show it.
      const reload =
        status === 409
          ? {
              label: t("toastMessages.downtimes.reload"),
              handler: () => {
                void queryClient.invalidateQueries({ queryKey: downtimeKeys.all(orgId.value) });
              },
            }
          : undefined;
      toast({
        variant: "error",
        message: serverMessage ? raw(serverMessage) : t("toastMessages.downtimes.extendFailed"),
        ...(reload ? { action: reload } : {}),
      });
      return null;
    }
  };

  const extendBy = (row: Pick<Downtime, "id" | "folder_id" | "version">, seconds: number) =>
    extend(row, { by_secs: seconds });

  return { extend, extendBy, isPending: mutation.isPending, timezone };
}
