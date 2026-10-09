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
import { useMutation } from "@tanstack/vue-query";
import { formatInTimeZone } from "date-fns-tz";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { extendDowntimeMutation } from "@/services/downtimes.queries";
import type { Downtime, ExtendDowntimeRequest, ExtendDowntimeResponse } from "@/services/downtimes";
import { toast } from "@/lib/feedback/Toast/useToast";
import { dbmHttpError } from "@/utils/dbm/format";

/** Extends a downtime and confirms with the new end, or with a link to the follow-up it created. */
export function useExtendDowntime() {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const router = useRouter();
  const mutation = useMutation(() => extendDowntimeMutation(orgId.value));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const endText = (micros?: number | null) =>
    micros
      ? `${formatInTimeZone(new Date(micros / 1000), timezone, "d MMM HH:mm")} ${timezone}`
      : "";

  const extend = async (
    row: Pick<Downtime, "id" | "folder_id">,
    body: ExtendDowntimeRequest,
  ): Promise<ExtendDowntimeResponse | null> => {
    try {
      const result = await mutation.mutateAsync({ id: row.id, body, folder: row.folder_id });
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
      const { serverMessage } = dbmHttpError(err);
      toast({
        variant: "error",
        message: serverMessage ? raw(serverMessage) : t("toastMessages.downtimes.extendFailed"),
      });
      return null;
    }
  };

  const extendBy = (row: Pick<Downtime, "id" | "folder_id">, seconds: number) =>
    extend(row, { by_secs: seconds });

  return { extend, extendBy, isPending: mutation.isPending, timezone };
}
