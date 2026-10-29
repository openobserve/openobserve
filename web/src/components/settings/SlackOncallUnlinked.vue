<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { remindOncallUnlinkedMutation, slackOncallUnlinkedQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView, SlackOncallUnlinkedMember } from "@/types/slack";
import { formatTimestamp } from "@/utils/date";

const props = defineProps<{ installation: InstallationView }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const unlinked = useQuery(() => slackOncallUnlinkedQuery(org.value, props.installation.id));
const remind = useMutation(() => remindOncallUnlinkedMutation(org.value, props.installation.id));

const rows = computed<SlackOncallUnlinkedMember[]>(() => unlinked.data.value?.members ?? []);

const columns = computed<OTableColumnDef<SlackOncallUnlinkedMember>[]>(() => [
  {
    id: "email",
    header: t("slackApp.oncallUnlinked.columnPerson"),
    size: 220,
    meta: { flex: true },
  },
  { id: "team", header: t("slackApp.oncallUnlinked.columnTeam"), size: 160 },
  { id: "next_shift", header: t("slackApp.oncallUnlinked.columnNextShift"), size: 180 },
  { id: "reminder", header: t("slackApp.oncallUnlinked.columnReminder"), size: 180 },
]);

const runRemind = async () => {
  try {
    const result = await remind.mutateAsync();
    toast({
      variant: "success",
      message: t("slackApp.oncallUnlinked.reminded", { count: result.sent }, result.sent),
    });
  } catch {
    toast({ variant: "error", message: t("slackApp.oncallUnlinked.remindFailed") });
  }
};
</script>

<template>
  <OCard
    v-if="rows.length"
    variant="outlined"
    class="flex flex-col gap-3 p-4"
    data-test="slack-oncall-unlinked"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-text-heading text-sm font-medium">
          {{ t("slackApp.oncallUnlinked.title", { product: raw("Slack") }) }}
        </span>
        <span class="text-text-secondary text-xs">
          {{ t("slackApp.oncallUnlinked.description") }}
        </span>
      </div>
      <OButton
        variant="outline"
        size="sm-action"
        :loading="remind.isPending.value"
        data-test="slack-oncall-unlinked-remind"
        @click="runRemind"
      >
        {{ t("slackApp.oncallUnlinked.remind") }}
      </OButton>
    </div>
    <OTable
      :data="rows"
      :columns="columns"
      row-key="email"
      pagination="none"
      :show-global-filter="false"
      :cell-overflow-tooltip="false"
      dense
    >
      <template #cell-email="{ row }">{{ raw(row.email) }}</template>
      <template #cell-team="{ row }">{{ raw(row.team_name) }}</template>
      <template #cell-next_shift="{ row }">
        <span v-if="row.next_shift_at">{{
          raw(formatTimestamp(row.next_shift_at, "EEE d MMM, HH:mm"))
        }}</span>
        <span v-else class="text-text-muted">{{ raw("—") }}</span>
      </template>
      <template #cell-reminder="{ row }">
        <span :data-test="`slack-oncall-unlinked-reminder-${row.email}`">{{
          row.reminded_at
            ? t("slackApp.oncallUnlinked.dmSent", {
                time: raw(formatTimestamp(row.reminded_at, "EEE h:mm a")),
              })
            : t("slackApp.oncallUnlinked.notSent")
        }}</span>
      </template>
    </OTable>
  </OCard>
</template>
