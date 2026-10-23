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

import { computed, ref, type Ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import { toast } from "@/lib/feedback/Toast/useToast";
import { saveDestinationMutation } from "@/services/alert_destination.queries";
import { oncallTeamRoomsQuery } from "@/services/oncall.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  oncallRoomNames,
  slackAppSaveRefusal,
  switchBackToWebhook,
  switchToSlackApp,
  type SlackAppDestination,
} from "@/utils/slackAppDestination";

type Row = Parameters<typeof switchToSlackApp>[0];

/** Switch, switch back and switch all (7.9): each is an in-place edit of the destination. */
export function useSlackAppSwitch() {
  const { t } = useI18nTyped();
  const org = useOrgId();
  const save = useMutation(() => saveDestinationMutation(org.value, () => true));
  const pending = ref(new Set<string>());

  const reasonOf = (error: unknown): I18nText => {
    const refusal = slackAppSaveRefusal(error);
    if (refusal.kind === "version") return t("slackApp.destination.versionMismatch");
    if (refusal.kind === "other" && refusal.message) return raw(refusal.message);
    return t("slackApp.destination.saveFailed");
  };

  const put = async (name: string, data: unknown): Promise<I18nText | null> => {
    pending.value = new Set(pending.value).add(name);
    try {
      await save.mutateAsync({ destination_name: name, data });
      return null;
    } catch (error) {
      return reasonOf(error);
    } finally {
      const next = new Set(pending.value);
      next.delete(name);
      pending.value = next;
    }
  };

  const failed = (name: string, reason: I18nText) =>
    toast({
      variant: "error",
      message: t("slackApp.destination.switchFailed", { name: raw(name), reason }),
    });

  async function switchOne(row: Row, installationId: string): Promise<boolean> {
    const body = switchToSlackApp(row, installationId);
    if (!body) return false;
    const reason = await put(row.name, body);
    if (reason) {
      failed(row.name, reason);
      return false;
    }
    toast({
      variant: "success",
      message: t("slackApp.destination.switched", { name: raw(row.name), product: raw("Slack") }),
    });
    return true;
  }

  async function switchBack(row: SlackAppDestination): Promise<boolean> {
    const body = switchBackToWebhook(row);
    if (!body) return false;
    const reason = await put(row.name, body);
    if (reason) {
      failed(row.name, reason);
      return false;
    }
    toast({
      variant: "success",
      message: t("slackApp.destination.switchedBack", { name: raw(row.name) }),
    });
    return true;
  }

  // Sequential, so one refusal (an old node) stops nothing else and every row gets its answer.
  async function switchAll(rows: Row[], installationId: string): Promise<number> {
    let switched = 0;
    let refused = 0;
    let lastReason: I18nText | null = null;
    for (const row of rows) {
      const body = switchToSlackApp(row, installationId);
      const reason = body ? await put(row.name, body) : t("slackApp.destination.saveFailed");
      if (reason) {
        refused += 1;
        lastReason = reason;
      } else {
        switched += 1;
      }
    }
    if (switched) {
      toast({
        variant: "success",
        message: t("slackApp.destination.switchedAll", { count: switched }, switched),
      });
    }
    if (refused && lastReason) {
      toast({
        variant: "error",
        message: t(
          "slackApp.switchAll.someFailed",
          { count: refused, reason: lastReason },
          refused,
        ),
      });
    }
    return switched;
  }

  return { pending, switchOne, switchBack, switchAll };
}

/** Names of webhook destinations on-call teams page through, read only while `enabled`. */
export function useOncallRoomNames(enabled: Ref<boolean>) {
  const org = useOrgId();
  const rooms = useQuery(() =>
    Object.assign(oncallTeamRoomsQuery(org.value), { enabled: enabled.value && !!org.value }),
  );
  return computed(() => oncallRoomNames(rooms.data.value ?? []));
}
