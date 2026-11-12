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
import OnCallFitChips from "@/components/oncall/OnCallFitChips.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { remindOncallUnlinkedMutation, slackOncallUnlinkedQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { InstallationView, SlackOncallUnlinkedMember } from "@/types/slack";

interface UnlinkedPerson {
  email: string;
  teams: { id: string; name: string }[];
  nextShiftAt: number | null;
  remindedAt: number | null;
  onCallNow: boolean;
}

const props = defineProps<{ installation: InstallationView }>();

/// Ten people, not the table default: the card sits among other settings and must not run the page long.
const PAGE_SIZE = 10;

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const timezone = computed<string | undefined>(() => store.state.timezone || undefined);

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
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-text-heading flex min-w-0 items-center gap-2 text-sm font-medium">
        {{ t("slackApp.oncallUnlinked.title", { product: raw("Slack") }) }}
        <OTag
          type="countChip"
          value="warning"
          size="sm"
          :label="t('slackApp.oncallUnlinked.count', { count: rows.length }, rows.length)"
          data-test="slack-oncall-unlinked-count"
        />
      </span>
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
      :pagination="rows.length > PAGE_SIZE ? 'client' : 'none'"
      :page-size="PAGE_SIZE"
      :show-global-filter="false"
      :cell-overflow-tooltip="false"
      dense
    >
      <template #cell-email="{ row }">
        <span :data-test="`slack-oncall-unlinked-person-${row.email}`">
          <OnCallPersonName class="block min-w-0 truncate" :email="row.email" />
        </span>
      </template>
      <template #cell-teams="{ row }">
        <OnCallFitChips
          :items="row.teams"
          :tooltip="raw(row.teams.map((team) => team.name).join(', '))"
          :data-test="`slack-oncall-unlinked-teams-${row.email}`"
        >
          <template #item="{ item }">
            <OTag size="sm" variant="default-soft" data-test="slack-oncall-unlinked-team">
              <OTruncatedText>{{ raw(item.name) }}</OTruncatedText>
            </OTag>
          </template>
        </OnCallFitChips>
      </template>
      <template #cell-next_shift="{ row }">
        <OTag
          v-if="row.onCallNow"
          variant="success-soft"
          size="sm"
          :label="t('slackApp.oncallUnlinked.onCallNow')"
          :data-test="`slack-oncall-unlinked-now-${row.email}`"
        />
        <OTimeCell
          v-else
          :value="row.nextShiftAt"
          unit="us"
          :timezone="timezone"
          :empty-label="raw('—')"
        />
      </template>
      <template #cell-reminder="{ row }">
        <span :data-test="`slack-oncall-unlinked-reminder-${row.email}`">
          <OTimeCell
            :value="row.remindedAt"
            unit="us"
            :timezone="timezone"
            :empty-label="t('slackApp.oncallUnlinked.notSent')"
          />
        </span>
      </template>
    </OTable>
  </OCard>
</template>
