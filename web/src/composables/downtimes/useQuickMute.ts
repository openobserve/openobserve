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
import { quickMuteMutation } from "@/services/downtimes.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  buildQuickMuteRequest,
  selectionCount,
  type QuickMuteSelection,
} from "@/utils/downtimes/quickMute";

/** Creates a quick mute and confirms it with a toast that links to the new downtime. */
export function useQuickMute() {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const router = useRouter();
  const mutation = useMutation(() => quickMuteMutation(orgId.value));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const mute = async (
    selection: QuickMuteSelection[],
    endsAtMicros: number,
    reason?: string,
  ): Promise<string | null> => {
    const count = selectionCount(selection);
    const startsAt = Date.now() * 1000;
    const body = buildQuickMuteRequest(selection, startsAt, endsAtMicros, timezone, reason);
    try {
      const created = await mutation.mutateAsync(body);
      const until = formatInTimeZone(new Date(endsAtMicros / 1000), timezone, "HH:mm");
      toast({
        variant: "success",
        message: t(
          "toastMessages.downtimes.muted",
          { count, time: `${until} ${timezone}`, folder: body.folder_id },
          count,
        ),
        action: {
          label: t("toastMessages.downtimes.viewDowntime"),
          handler: () => {
            void router.push({
              name: "downtimeDetail",
              params: { id: created.id },
              query: { org_identifier: orgId.value },
            });
          },
        },
      });
      return created.id;
    } catch (err: any) {
      toast({
        variant: "error",
        message: raw(err?.response?.data?.message) || t("toastMessages.downtimes.muteFailed"),
      });
      return null;
    }
  };

  const muteFor = (selection: QuickMuteSelection[], seconds: number) =>
    mute(selection, Date.now() * 1000 + seconds * 1_000_000);

  return { mute, muteFor, isPending: mutation.isPending, timezone };
}
