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

<!--
  Every team's ladder in one place.

  Auditing escalation meant opening each team in turn, which is how a team that
  pages nobody at P1 survives unnoticed: nothing ever put the twelve answers
  next to each other. The columns are the two failures worth finding — a
  priority that pages nobody at all, and a rung that resolves to nobody right
  now — rather than a rendering of the configuration.
-->
<template>
  <OPageLayout
    bleed
    data-test="oncall-policies-page"
    :title="t('oncall.policiesTitle')"
    :subtitle="t('oncall.policiesSubtitle')"
    icon="arrow-upward"
  >
    <OTable
      :frame="false"
      :data="rows"
      :columns="columns"
      row-key="teamId"
      :loading="loading"
      pagination="client"
      table-id="oncall-policies"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-policies-table"
      @row-click="openTeam"
    >
      <template #subheader>
        <div class="px-page-edge border-table-row-divider border-b py-1.5">
          <OStatStrip :items="summaryStats" :loading="loading" />
        </div>
      </template>

      <template #toolbar>
        <div class="flex w-full items-center gap-2">
          <OSearchInput
            v-model="search"
            class="flex-1"
            clearable
            :placeholder="t('oncall.searchTeams')"
            data-test="oncall-policies-search"
          />
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="oncall-policies-refresh"
          @click="fetchAll"
        >
          <OTooltip side="bottom" :content="t('oncall.refresh')" />
        </OButton>
      </template>

      <template #cell-on_call="{ row }">
        <OUserCell v-if="row.onCall" :value="row.onCall" />
        <OTag v-else type="oncallCoverage" value="gap" size="sm" />
      </template>

      <!-- The audit answer, not the configuration: a priority with no rungs
           wakes nobody however it is delivered. -->
      <template #cell-silent="{ row }">
        <span v-if="row.silent.length" class="flex flex-wrap gap-1">
          <OTag
            v-for="priority in row.silent"
            :key="priority"
            :variant="priorityTagVariant(priority)"
            size="sm"
          >
            {{ priorityLabel(priority) }}
          </OTag>
        </span>
        <span v-else class="text-text-muted text-sm">{{ ABSENT }}</span>
      </template>

      <!-- Configured and useless: the rung names somebody the rotation cannot
           supply right now. -->
      <template #cell-unreachable="{ row }">
        <span v-if="row.unreachable.length" class="flex flex-wrap gap-1">
          <OTag
            v-for="priority in row.unreachable"
            :key="priority"
            variant="warning-soft"
            size="sm"
          >
            {{ priorityLabel(priority) }}
          </OTag>
        </span>
        <span v-else class="text-text-muted text-sm">{{ ABSENT }}</span>
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          preset="no-oncall-teams"
          :filtered="!!search"
          data-test="oncall-policies-empty"
          @action="onEmptyAction"
        />
      </template>
    </OTable>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import oncallService from "@/services/oncall";
import type { OnCallTeam } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { priorityLabel, priorityTagVariant, resolveLadder } from "@/utils/oncall";

/// One team's ladder, reduced to the two questions this page exists to answer.
interface PolicyRow {
  teamId: string;
  teamName: string;
  onCall: string;
  /** Priorities whose ladder has no rungs at all. */
  silent: number[];
  /** Priorities with a rung that resolves to nobody right now. */
  unreachable: number[];
}

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const ABSENT = raw("—");

const allRows = ref<PolicyRow[]>([]);
const loading = ref(false);
const search = ref("");

const orgId = computed(() => store.state.selectedOrganization.identifier);

const columns = computed<OTableColumnDef<PolicyRow>[]>(() => [
  {
    id: "teamName",
    header: t("oncall.teamName"),
    accessorKey: "teamName",
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "on_call",
    header: t("oncall.onCallNow"),
    size: 220,
    accessorFn: (row: PolicyRow) => row.onCall,
  },
  {
    id: "silent",
    header: t("oncall.pagesNobodyAt"),
    size: 200,
    accessorFn: (row: PolicyRow) => row.silent.length,
    sortable: true,
  },
  {
    id: "unreachable",
    header: t("oncall.reachesNobodyAt"),
    size: 200,
    accessorFn: (row: PolicyRow) => row.unreachable.length,
    sortable: true,
  },
]);

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return allRows.value;
  return allRows.value.filter((row) => row.teamName.toLowerCase().includes(q));
});

const summaryStats = computed<StatItem[]>(() => [
  {
    key: "teams",
    label: t("oncall.teams"),
    value: rows.value.length,
    icon: "group-work",
    tone: "neutral",
    dataTest: "oncall-policies-stat-teams",
  },
  {
    key: "gaps",
    label: t("oncall.statCoverageGaps"),
    value: rows.value.filter((row) => !row.onCall).length,
    icon: "person-pin-circle",
    tone: rows.value.some((row) => !row.onCall) ? "error" : "neutral",
    dataTest: "oncall-policies-stat-gaps",
  },
  {
    key: "silent",
    label: t("oncall.statSilentPriorities"),
    value: rows.value.reduce((total, row) => total + row.silent.length, 0),
    icon: "volume-off",
    tone: "warning",
    dataTest: "oncall-policies-stat-silent",
  },
  {
    key: "unreachable",
    label: t("oncall.statUnreachableRungs"),
    value: rows.value.reduce((total, row) => total + row.unreachable.length, 0),
    icon: "warning-amber",
    tone: rows.value.some((row) => row.unreachable.length) ? "error" : "neutral",
    dataTest: "oncall-policies-stat-unreachable",
  },
]);

/// One request per team for the policy and one for the rotation: there is no
/// bulk form of either, so the fan-out is the cost of the page. Settled rather
/// than awaited together, so one team failing leaves the other rows readable.
async function fetchTeamRow(team: OnCallTeam): Promise<PolicyRow | null> {
  const [policyRes, onCallRes] = await Promise.allSettled([
    oncallService.getPolicy({ org_identifier: orgId.value, team_id: team.id }),
    oncallService.whoIsOnCall({ org_identifier: orgId.value, team_id: team.id }),
  ]);

  // A policy we could not read is not a policy that pages nobody, and saying
  // so would send somebody to fix a team that is fine.
  if (policyRes.status !== "fulfilled") return null;

  const slots = onCallRes.status === "fulfilled" ? (onCallRes.value.data ?? []) : [];
  const rungs = policyRes.value.data?.rungs ?? [];

  return {
    teamId: team.id,
    teamName: team.name,
    onCall: slots[0]?.user_email ?? "",
    silent: rungs.filter((rung) => !rung.steps.length).map((rung) => rung.priority),
    unreachable: rungs
      .filter((rung) =>
        resolveLadder(rung, slots).some((step) => !step.people.length && !step.wholeTeam),
      )
      .map((rung) => rung.priority),
  };
}

async function fetchAll() {
  loading.value = true;
  try {
    const teamsRes = await oncallService.listTeams({ org_identifier: orgId.value });
    const teams = teamsRes.data ?? [];
    const settled = await Promise.all(teams.map((team) => fetchTeamRow(team)));
    allRows.value = settled.filter((row): row is PolicyRow => row !== null);
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadTeamsFailed"),
    });
  } finally {
    loading.value = false;
  }
}

function openTeam(row: PolicyRow) {
  router.push({
    name: "onCallTeamDetail",
    params: { teamId: row.teamId, tab: "policy" },
    query: { org_identifier: orgId.value },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    return;
  }
  router.push({ name: "onCallTeams", query: { org_identifier: orgId.value } });
}

onMounted(fetchAll);
</script>
