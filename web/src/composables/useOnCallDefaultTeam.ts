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

import { computed, type Ref } from "vue";
import { useMutation } from "@tanstack/vue-query";

import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import { setRoutingConfigMutation } from "@/services/oncall.queries";
import { raw, useI18nTyped } from "@/types/i18n";

/** Nominates the org's default team, the one write behind the Edit team drawer's Default switch wherever it opens. */
export function useOnCallDefaultTeam(orgId: Ref<string>) {
  const { t } = useI18nTyped();
  const { confirm } = useConfirmDialog();
  const { noteConfigurationDenied } = useOnCallPermissions();
  const { config, load } = useOnCallRoutingConfig();
  const setRoutingConfigWrite = useMutation(() => setRoutingConfigMutation(orgId.value));

  const defaultTeamId = computed(() => config.value?.default_team_id ?? "");

  async function isTeamUnstaffed(teamId: string): Promise<boolean> {
    try {
      const { data } = await oncallService.coverageGaps({
        org_identifier: orgId.value,
        limit: 200,
      });
      return data.teams.some((gap) => gap.id === teamId);
    } catch {
      return false;
    }
  }

  async function setDefaultTeam(team: { id: string; name: string }) {
    if (await isTeamUnstaffed(team.id)) {
      const proceed = await confirm({
        title: t("oncall.defaultTeamUnstaffedTitle"),
        message: t("oncall.defaultTeamUnstaffedMessage", { team: raw(team.name) }),
        confirmLabel: t("oncall.defaultTeamUnstaffedConfirm"),
      });
      if (!proceed) return;
    }

    try {
      await setRoutingConfigWrite.mutateAsync(team.id);
      // Unforced: the write expired the entry, so this repaints from one server read.
      await load(orgId.value);
      toast({ variant: "success", message: t("oncall.defaultTeamSaved") });
    } catch (err: unknown) {
      noteConfigurationDenied(err);
      const failure = err as { response?: { status?: number; data?: { message?: string } } };
      toast({
        variant: "error",
        message:
          failure?.response?.status === 403
            ? t("oncall.configDenied")
            : raw(failure?.response?.data?.message) || t("oncall.defaultTeamSaveFailed"),
      });
    }
  }

  return { defaultTeamId, loadDefaultTeam: () => load(orgId.value), setDefaultTeam };
}
