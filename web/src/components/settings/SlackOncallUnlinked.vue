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
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { remindOncallUnlinkedMutation, slackOncallUnlinkedQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView, SlackOncallUnlinkedMember } from "@/types/slack";
import { formatTimestamp } from "@/utils/date";

interface UnlinkedPerson {
  email: string;
  teams: { id: string; name: string }[];
  nextShiftAt: number | null;
  remindedAt: number | null;
  onCallNow: boolean;
}

const props = defineProps<{ installation: InstallationView }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const unlinked = useQuery(() => slackOncallUnlinkedQuery(org.value, props.installation.id));
const remind = useMutation(() => remindOncallUnlinkedMutation(org.value, props.installation.id));

const earliest = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b);
const latest = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

// The server returns one row per person per team; a next shift already started means on call now.
const groupByPerson = (members: SlackOncallUnlinkedMember[], nowUs: number): UnlinkedPerson[] => {
  const byEmail = new Map<string, UnlinkedPerson>();
  for (const m of members) {
    const person = byEmail.get(m.email) ?? {
      email: m.email,
      teams: [],
      nextShiftAt: null,
      remindedAt: null,
      onCallNow: false,
    };
    if (!person.teams.some((team) => team.id === m.team_id)) {
      person.teams.push({ id: m.team_id, name: m.team_name });
    }
    person.nextShiftAt = earliest(person.nextShiftAt, m.next_shift_at);
    person.remindedAt = latest(person.remindedAt, m.reminded_at);
    byEmail.set(m.email, person);
  }
  const people = [...byEmail.values()];
  for (const person of people) {
    person.onCallNow = person.nextShiftAt !== null && person.nextShiftAt <= nowUs;
  }
  return people.sort((a, b) => {
    if (a.onCallNow !== b.onCallNow) return a.onCallNow ? -1 : 1;
    if (a.nextShiftAt !== b.nextShiftAt) {
      if (a.nextShiftAt === null) return 1;
      if (b.nextShiftAt === null) return -1;
      return a.nextShiftAt - b.nextShiftAt;
    }
    return a.email.localeCompare(b.email);
  });
};

const rows = computed<UnlinkedPerson[]>(() =>
  groupByPerson(unlinked.data.value?.members ?? [], unlinked.dataUpdatedAt.value * 1000),
);

const columns = computed<OTableColumnDef<UnlinkedPerson>[]>(() => [
  {
    id: "email",
    header: t("slackApp.oncallUnlinked.columnPerson"),
    size: 220,
    meta: { flex: true },
  },
  { id: "teams", header: t("slackApp.oncallUnlinked.columnTeam"), size: 220 },
  { id: "next_shift", header: t("slackApp.oncallUnlinked.columnNextShift"), size: 160 },
  { id: "reminder", header: t("slackApp.oncallUnlinked.columnReminder"), size: 160 },
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
        <span class="text-text-heading flex items-center gap-2 text-sm font-medium">
          {{ t("slackApp.oncallUnlinked.title", { product: raw("Slack") }) }}
          <OTag
            variant="warning-soft"
            size="sm"
            :label="t('slackApp.oncallUnlinked.count', { count: rows.length }, rows.length)"
            data-test="slack-oncall-unlinked-count"
          />
        </span>
        <span class="text-text-secondary text-xs">
          {{ t("slackApp.oncallUnlinked.description") }}
        </span>
      </div>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="send"
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
      <template #cell-email="{ row }">
        <span :data-test="`slack-oncall-unlinked-person-${row.email}`">{{ raw(row.email) }}</span>
      </template>
      <template #cell-teams="{ row }">
        <span class="flex flex-wrap gap-1">
          <OTag
            v-for="team in row.teams"
            :key="team.id"
            size="sm"
            variant="default-soft"
            :label="raw(team.name)"
            data-test="slack-oncall-unlinked-team"
          />
        </span>
      </template>
      <template #cell-next_shift="{ row }">
        <OTag
          v-if="row.onCallNow"
          variant="error-soft"
          size="sm"
          :label="t('slackApp.oncallUnlinked.onCallNow')"
          :data-test="`slack-oncall-unlinked-now-${row.email}`"
        />
        <span v-else-if="row.nextShiftAt">{{
          raw(formatTimestamp(row.nextShiftAt, "EEE d MMM, HH:mm"))
        }}</span>
        <span v-else class="text-text-muted">{{ raw("—") }}</span>
      </template>
      <template #cell-reminder="{ row }">
        <span :data-test="`slack-oncall-unlinked-reminder-${row.email}`">{{
          row.remindedAt
            ? t("slackApp.oncallUnlinked.dmSent", {
                time: raw(formatTimestamp(row.remindedAt, "EEE h:mm a")),
              })
            : t("slackApp.oncallUnlinked.notSent")
        }}</span>
      </template>
    </OTable>
  </OCard>
</template>
