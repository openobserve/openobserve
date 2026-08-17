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
    data-test="oncall-teams-page"
    :title="t('oncall.teamsTitle')"
    :subtitle="t('oncall.teamsSubtitle')"
    icon="group-work"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="oncall-teams-add-btn"
        @click="openCreate"
      >
        {{ t("oncall.addTeam") }}
      </OButton>
    </template>

    <OTable
        :error="loadError"
      :frame="false"
      :data="filteredTeams"
      :columns="columns"
      row-key="id"
      :loading="loading"
      pagination="client"
      table-id="oncall-teams-list"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-teams-table"
      @row-click="openTeam"
    >
      <template #toolbar>
        <div class="flex w-full items-center gap-2">
          <OSearchInput
            v-model="search"
            class="flex-1"
            clearable
            :placeholder="t('oncall.searchTeams')"
            data-test="oncall-teams-search"
          />
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="oncall-teams-refresh"
          @click="fetchTeams"
        >
          <OTooltip side="bottom" :content="t('oncall.refresh')" />
        </OButton>
      </template>

      <!-- The question this page is really asked: if something breaks now, who
           wakes up? Without it, coverage gaps are only findable one team at a
           time. -->
      <template #cell-on_call_now="{ row }">
        <span v-if="onCallByTeam[row.id] === undefined" class="text-text-muted text-sm">
          {{ t("oncall.loadingShort") }}
        </span>
        <OTag
          v-else-if="!onCallByTeam[row.id].length"
          type="oncallCoverage"
          value="gap"
          size="sm"
        />
        <!-- One entry PER SLOT: two bare emails joined by a space read as one
             long address, and said nothing about which pool each holds. -->
        <span v-else class="flex flex-col gap-0.5">
          <span
            v-for="slot in onCallByTeam[row.id]"
            :key="slot.user_email"
            class="flex flex-wrap items-center gap-1.5"
          >
            <OUserCell :value="slot.user_email" />
            <OTag
              v-if="slot.slot && !sameSlot(slot.slot, DEFAULT_SLOT)"
              variant="default-soft"
              size="sm"
              :data-test="`oncall-teams-slot-${row.id}-${slot.slot}`"
            >
              {{ raw(slot.slot) }}
            </OTag>
          </span>
        </span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="delete-outline"
          :aria-label="t('oncall.deleteTeam')"
          :data-test="`oncall-team-delete-${row.id}`"
          @click.stop="teamToDelete = row"
        />
      </template>

      <template v-if="notAvailable" #empty>
        <OEmptyState
          size="hero"
          icon="cloud-off"
          :title="t('oncall.notAvailableTitle')"
          :description="t('oncall.notAvailableDescription')"
          data-test="oncall-teams-not-available"
        />
      </template>

      <template #error>
        <OEmptyState
          size="hero"
          variant="error"
          illustration="broken-panel"
          :title="t('oncall.loadTeamsFailed')"
          :description="loadError ? raw(loadError) : undefined"
          :action-label="t('oncall.retry')"
          data-test="oncall-teams-error"
          @action="fetchTeams"
        />
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          preset="no-oncall-teams"
          :filtered="!!search"
          data-test="oncall-teams-empty"
          @action="onEmptyAction"
        />
      </template>
    </OTable>

    <OnCallTeamForm
      v-model:open="formOpen"
      :team="editingTeam"
      @saved="onSaved"
    />

    <!-- Named in the prompt: deleting the wrong rotation silently stops
         paging, and the team name is the only thing that distinguishes two
         otherwise identical rows. -->
    <ConfirmDialog
      :model-value="!!teamToDelete"
      :title="t('oncall.deleteTeamTitle')"
      :message="t('oncall.deleteTeamMessage', { name: teamToDelete?.name ?? '' })"
      @update:ok="deleteTeam"
      @update:cancel="teamToDelete = null"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import oncallService from "@/services/oncall";
import type { OnCallSlot, OnCallTeam } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { isOnCallUnavailable } from "@/utils/oncall";
import { toast } from "@/lib/feedback/Toast/useToast";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const teams = ref<OnCallTeam[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const notAvailable = ref(false);
const search = ref("");
const formOpen = ref(false);
const editingTeam = ref<OnCallTeam | null>(null);
const teamToDelete = ref<OnCallTeam | null>(null);
// Undefined = not fetched yet, so a team in flight reads as loading rather
// than as an empty rotation.
const onCallByTeam = ref<Record<string, OnCallSlot[]>>({});

const orgId = computed(() => store.state.selectedOrganization.identifier);

const columns = computed<OTableColumnDef<OnCallTeam>[]>(() => [
  {
    id: "name",
    header: t("oncall.teamName"),
    accessorKey: "name",
    sortable: true,
    meta: { isName: true },
  },
  {
    // The question this page is really asked: if something breaks now, who
    // wakes up? Without it, coverage gaps are only findable one team at a time.
    id: "on_call_now",
    header: t("oncall.onCallNow"),
    size: 240,
    enableSorting: false,
    accessorFn: (row: OnCallTeam) => row.id,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 110,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
  {
    id: "timezone",
    header: t("oncall.timezone"),
    accessorKey: "timezone",
    sortable: true,
    hideable: true,
  },
  {
    id: "description",
    header: t("oncall.description"),
    accessorFn: (row: OnCallTeam) => row.description || "—",
    hideable: true,
  },
]);

const filteredTeams = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return teams.value;
  return teams.value.filter(
    (team) =>
      team.name.toLowerCase().includes(q) ||
      (team.description ?? "").toLowerCase().includes(q),
  );
});

async function fetchTeams() {
  loading.value = true;
  try {
    const res = await oncallService.listTeams({ org_identifier: orgId.value });
    teams.value = res.data ?? [];
    await fetchOnCallNow();
    loadError.value = null;
    notAvailable.value = false;
  } catch (err: any) {
    // Feature-off (404) and OSS (403 "Not Supported") are the same calm fact,
    // not an error: nothing failed and there is nothing to retry. §G.8.1 —
    // the teams list IS the capability probe.
    if (isOnCallUnavailable(err)) {
      notAvailable.value = true;
      return;
    }
    // The state, not a toast: a toast evaporates and leaves "no teams" on
    // screen, which reads as an unconfigured org rather than a failed read.
    loadError.value = String(err?.response?.data?.message ?? err?.message ?? "");
  } finally {
    loading.value = false;
  }
}

// One request per team, in parallel. A team whose rotation fails to load is
// left out of the map rather than shown as unstaffed — claiming nobody is on
// call when we simply do not know would send someone chasing a phantom gap.
async function fetchOnCallNow() {
  const results = await Promise.all(
    teams.value.map(async (team) => {
      try {
        const res = await oncallService.whoIsOnCall({
          org_identifier: orgId.value,
          team_id: team.id,
        });
        return [team.id, res.data ?? []] as const;
      } catch {
        return null;
      }
    }),
  );
  onCallByTeam.value = Object.fromEntries(results.filter((r) => r !== null));
}

async function deleteTeam() {
  const team = teamToDelete.value;
  teamToDelete.value = null;
  if (!team) return;
  try {
    await oncallService.deleteTeam({ org_identifier: orgId.value, team_id: team.id });
    toast({ variant: "success", message: t("oncall.teamDeleted") });
    await fetchTeams();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.deleteTeamFailed"),
    });
  }
}

function openCreate() {
  editingTeam.value = null;
  formOpen.value = true;
}

function openTeam(team: OnCallTeam) {
  router.push({
    name: "onCallTeamDetail",
    params: { teamId: team.id },
    query: { org_identifier: orgId.value },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    return;
  }
  openCreate();
}

function onSaved() {
  formOpen.value = false;
  fetchTeams();
}

onMounted(fetchTeams);
</script>
