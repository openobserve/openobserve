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
import { useRouter } from "vue-router";
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
  type SlackAppSaveRefusal,
} from "@/utils/slackAppDestination";

type Row = Parameters<typeof switchToSlackApp>[0];

/** Switch, switch back and switch all (7.9): each is an in-place edit of the destination. */
export function useSlackAppSwitch() {
  const { t } = useI18nTyped();
  const org = useOrgId();
  const save = useMutation(() => saveDestinationMutation(org.value, () => true));
  const pending = ref(new Set<string>());

  const router = useRouter();
  type Failure = { reason: I18nText; refusal: SlackAppSaveRefusal };

  const reasonOf = (error: unknown): Failure => {
    const refusal = slackAppSaveRefusal(error);
    if (refusal.kind === "shared")
      return { reason: t("slackApp.destination.sharedRequired"), refusal };
    if (refusal.kind === "oncall_room")
      return { reason: t("slackApp.destination.oncallRequired"), refusal };
    if (refusal.kind === "version")
      return { reason: t("slackApp.destination.versionMismatch"), refusal };
    if (refusal.message) return { reason: raw(refusal.message), refusal };
    if (refusal.code === "used_by_oncall")
      return {
        reason: t("slackApp.destination.oncallNotAllowed", { product: raw("Slack") }),
        refusal,
      };
    if (refusal.code === "slack_unavailable")
      return { reason: t("slackApp.destination.unavailableReason"), refusal };
    return { reason: t("slackApp.destination.saveFailed"), refusal };
  };

  const put = async (name: string, data: unknown): Promise<Failure | null> => {
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

  const reviewAction = (name: string, refusal: SlackAppSaveRefusal, installationId?: string) => {
    if (!installationId || (refusal.kind !== "shared" && refusal.kind !== "oncall_room")) return {};
    return {
      action: {
        label: t("slackApp.switchAll.review"),
        handler: () => {
          void router.push({
            name: "alertDestinations",
            query: {
              org_identifier: org.value,
              action: "update",
              name,
              slack_app_installation: installationId,
              slack_app_refusal: refusal.code ?? "",
              ...(refusal.kind === "oncall_room"
                ? { slack_app_team: refusal.team, slack_app_room: refusal.destination }
                : {}),
            },
          });
        },
      },
    };
  };

  const failureLine = (name: string, failure: Failure) =>
    t("slackApp.destination.switchFailed", { name: raw(name), reason: failure.reason });

  const failed = (name: string, failure: Failure, installationId?: string) => {
    toast({
      variant: "error",
      message: failureLine(name, failure),
      ...reviewAction(name, failure.refusal, installationId),
    });
  };

  async function switchOne(row: Row, installationId: string): Promise<boolean> {
    const body = switchToSlackApp(row, installationId);
    if (!body) return false;
    const failure = await put(row.name, body);
    if (failure) {
      failed(row.name, failure, installationId);
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
    const failures: Array<{ name: string; failure: Failure }> = [];
    for (const row of rows) {
      const body = switchToSlackApp(row, installationId);
      const failure = body
        ? await put(row.name, body)
        : {
            reason: t("slackApp.destination.saveFailed"),
            refusal: { kind: "other" as const, code: null, message: null },
          };
      if (failure) failures.push({ name: row.name, failure });
      else switched += 1;
    }
    if (!failures.length) {
      if (switched) {
        toast({
          variant: "success",
          message: t("slackApp.destination.switchedAll", { count: switched }, switched),
        });
      }
      return switched;
    }
    const [first] = failures;
    toast({
      variant: switched ? "warning" : "error",
      title: t("slackApp.switchAll.summary", { switched, count: failures.length }),
      // One line each: server reasons can themselves contain ";".
      message: raw(failures.map(({ name, failure }) => failureLine(name, failure)).join("\n")),
      ...(failures.length === 1
        ? reviewAction(first.name, first.failure.refusal, installationId)
        : {}),
    });
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
