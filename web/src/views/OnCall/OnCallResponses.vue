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

<template>
  <OPageLayout
    bleed
    data-test="oncall-responses-page"
    :title="t('oncall.responsesTitle')"
    :subtitle="t('oncall.responsesSubtitle')"
    icon="notifications-active"
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="group-work"
        data-test="oncall-responses-teams-btn"
        @click="goToTeams"
      >
        {{ t("oncall.teams") }}
      </OButton>
    </template>

    <!-- No teams at all is a FIRST-RUN state, not a healthy one. "Nothing is
         paging" is only reassuring once something could page. -->
    <OnCallSetupGuide v-if="showSetupGuide" />

    <OTable
      v-else
      :frame="false"
      :data="filteredResponses"
      :columns="columns"
      row-key="id"
      :loading="loading"
      pagination="client"
      table-id="oncall-responses-list"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-responses-table"
      @row-click="openResponse"
    >
      <template #toolbar>
        <div class="flex w-full items-center gap-2">
          <OSelect
            v-model="teamFilter"
            :options="teamOptions"
            class="w-56"
            data-test="oncall-responses-team-filter"
          />
          <OSearchInput
            v-model="search"
            class="flex-1"
            clearable
            :placeholder="t('oncall.searchResponses')"
            data-test="oncall-responses-search"
          />
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="oncall-responses-refresh"
          @click="fetchResponses"
        >
          <OTooltip side="bottom" :content="t('oncall.refresh')" />
        </OButton>
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          preset="no-oncall-responses"
          :filtered="isFiltered"
          data-test="oncall-responses-empty"
          @action="onEmptyAction"
        />
      </template>
    </OTable>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OnCallSetupGuide from "@/components/oncall/OnCallSetupGuide.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import type { OnCallResponse, OnCallTeam } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatMicrosDuration,
  priorityLabel,
  priorityTagVariant,
  isSnoozed,
  stateTagVariant,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const responses = ref<OnCallResponse[]>([]);
const teams = ref<OnCallTeam[]>([]);
const loading = ref(false);
const search = ref("");
const teamFilter = ref("all");

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamNameById = computed(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

const teamOptions = computed(() => [
  { label: t("oncall.allTeams"), value: "all" },
  ...teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const isFiltered = computed(() => !!search.value || teamFilter.value !== "all");

// Only after the first fetch, so the guide never flashes while loading.
const loaded = ref(false);
const showSetupGuide = computed(() => loaded.value && teams.value.length === 0);

const columns = computed<OTableColumnDef<OnCallResponse>[]>(() => [
  {
    id: "priority",
    header: t("oncall.priority"),
    size: 90,
    accessorFn: (row: OnCallResponse) => row.priority,
    sortable: true,
    cell: (ctx: any) =>
      h(
        OTag,
        { variant: priorityTagVariant(ctx.row.original.priority), size: "sm" },
        () => priorityLabel(ctx.row.original.priority),
      ),
  },
  {
    id: "subject",
    header: t("oncall.subject"),
    accessorFn: (row: OnCallResponse) => row.subject.source_id,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "firing",
    header: t("oncall.firing"),
    size: 90,
    accessorFn: (row: OnCallResponse) => `#${row.subject.firing}`,
    hideable: true,
  },
  {
    id: "team",
    header: t("oncall.team"),
    accessorFn: (row: OnCallResponse) => teamNameById.value[row.team_id] ?? row.team_id,
    sortable: true,
  },
  {
    id: "state",
    header: t("oncall.state"),
    size: 130,
    accessorFn: (row: OnCallResponse) => row.state,
    // A snoozed page is still open, so it would otherwise sit in this list
    // looking exactly like one that is escalating right now. Whoever is
    // triaging needs to see which ones have already been quieted.
    cell: (ctx: any) => {
      const row = ctx.row.original as OnCallResponse;
      const tag = h(
        OTag,
        { variant: stateTagVariant(row.state), size: "sm" },
        () => t(`oncall.state_${row.state}`),
      );
      if (!isSnoozed(row)) return tag;
      return h("span", { class: "flex flex-wrap items-center gap-1" }, [
        tag,
        h(OTag, { variant: "warning-soft", size: "sm" }, () => t("oncall.snoozed")),
      ]);
    },
  },
  {
    id: "acked_by",
    header: t("oncall.ackedBy"),
    accessorFn: (row: OnCallResponse) => row.acked_by || "—",
    hideable: true,
  },
  {
    id: "age",
    header: t("oncall.age"),
    size: 100,
    accessorFn: (row: OnCallResponse) =>
      formatMicrosDuration(nowMicros.value - row.opened_at),
    sortable: false,
  },
]);

// Sampled once per fetch rather than per render: a reactive clock would make
// every row's age recompute on any unrelated update, and a page list is read
// in seconds, not watched like a timer.
const nowMicros = ref(Date.now() * 1000);

const filteredResponses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return responses.value.filter((row) => {
    if (teamFilter.value !== "all" && row.team_id !== teamFilter.value) return false;
    if (!q) return true;
    return (
      row.subject.source_id.toLowerCase().includes(q) ||
      (row.acked_by ?? "").toLowerCase().includes(q)
    );
  });
});

async function fetchResponses() {
  loading.value = true;
  nowMicros.value = Date.now() * 1000;
  try {
    const [responseRes, teamRes] = await Promise.all([
      oncallService.listResponses({ org_identifier: orgId.value }),
      oncallService.listTeams({ org_identifier: orgId.value }),
    ]);
    responses.value = responseRes.data ?? [];
    teams.value = teamRes.data ?? [];
    // Only on SUCCESS. Setting this in `finally` would let a transient API
    // error render the first-run guide, telling a configured org that nothing
    // is set up.
    loaded.value = true;
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadResponsesFailed"),
    });
  } finally {
    loading.value = false;
  }
}

function goToTeams() {
  router.push({ name: "onCallTeams", query: { org_identifier: orgId.value } });
}

function openResponse(row: OnCallResponse) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.id },
    query: { org_identifier: orgId.value },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    teamFilter.value = "all";
  }
}

onMounted(fetchResponses);
</script>
