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
      <!-- Every team's ladder side by side. The page existed, was registered,
           and had no inbound link from anywhere — so the one view that finds a
           team paging nobody at P1 was reachable only by typing its URL. It
           belongs beside the team list, which is where somebody comparing
           teams already is. -->
      <OButton
        variant="outline"
        size="sm"
        data-test="oncall-teams-policies-btn"
        @click="openPolicies"
      >
        {{ t("oncall.policiesTitle") }}
      </OButton>
      <OButton
        v-if="canConfigure"
        variant="primary"
        size="sm"
        data-test="oncall-teams-add-btn"
        @click="openCreate"
      >
        {{ t("oncall.newTeam") }}
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
            :placeholder="t('oncall.searchTeamsPeople')"
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
           wakes up? Two columns rather than one stacked cell — a primary and a
           secondary in one box read as one long address, and neither could be
           sorted or scanned down the page on its own. -->
      <template #cell-primary="{ row }">
        <span v-if="onCallByTeam[row.id] === undefined" class="text-text-muted text-sm">
          {{ t("oncall.loadingShort") }}
        </span>
        <!-- Nobody in the primary pool is this page's one alarm, and it was
             invisible while a staffed secondary filled the cell they shared. -->
        <OTag
          v-else-if="!positionsByTeam[row.id]?.first"
          type="oncallCoverage"
          value="gap"
          size="sm"
          :data-test="`oncall-teams-primary-gap-${row.id}`"
        />
        <OUserCell v-else :value="positionsByTeam[row.id]!.first!.user_email" />
      </template>

      <template #cell-secondary="{ row }">
        <span v-if="onCallByTeam[row.id] === undefined" class="text-text-muted text-sm">
          {{ t("oncall.loadingShort") }}
        </span>
        <!-- A team with no second pool is ordinary, not a gap: a muted dash,
             not the alarm colour the primary column spends. -->
        <span
          v-else-if="!(positionsByTeam[row.id]?.rest.length ?? 0)"
          class="text-text-muted"
        >
          {{ raw("—") }}
        </span>
        <span v-else class="flex flex-col gap-0.5">
          <span
            v-for="position in positionsByTeam[row.id]?.rest ?? []"
            :key="position.rotation_id"
            class="flex flex-wrap items-center gap-1.5"
          >
            <OUserCell :value="position.user_email" />
            <!-- The header already says "secondary". Only a rotation the header
                 does not name has to announce itself. -->
            <OTag
              v-if="position.rotation_name.toLowerCase() !== 'secondary'"
              variant="default-soft"
              size="sm"
              :data-test="`oncall-teams-rotation-${row.id}-${position.rotation_id}`"
            >
              {{ raw(position.rotation_name) }}
            </OTag>
          </span>
        </span>
      </template>

      <!-- Delete was the only control here, so the most destructive act was
           the most discoverable one and editing was a whole-row click nothing
           announced. Safe actions first, destructive last. -->
      <template #cell-actions="{ row }">
        <OButton
          v-if="canConfigure"
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          :aria-label="t('oncall.editTeam')"
          :data-test="`oncall-team-edit-${row.id}`"
          @click.stop="openEdit(row)"
        >
          <OTooltip side="bottom" :content="t('oncall.editTeam')" />
        </OButton>
        <OButton
          v-if="canConfigure"
          variant="ghost"
          size="icon-sm"
          icon-left="delete-outline"
          :aria-label="t('oncall.deleteTeam')"
          :data-test="`oncall-team-delete-${row.id}`"
          @click.stop="teamToDelete = row"
        >
          <OTooltip side="bottom" :content="t('oncall.deleteTeam')" />
        </OButton>
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

      <!-- One `#empty` template, branching inside it: two templates bound to
           the same slot is a lint error and only one of them was ever
           rendered. The capability answer wins — a deployment without on-call
           has no empty org to describe. -->
      <template #empty>
        <OEmptyState
          v-if="notAvailable"
          size="hero"
          icon="cloud-off"
          :title="t('oncall.notAvailableTitle')"
          :description="t('oncall.notAvailableDescription')"
          data-test="oncall-teams-not-available"
        />
        <OEmptyState
          v-else-if="!loading"
          size="hero"
          preset="no-oncall-teams"
          :filtered="!!search"
          data-test="oncall-teams-empty"
          @action="onEmptyAction"
        />
      </template>
    </OTable>

    <OnCallTeamForm v-model:open="formOpen" :team="editingTeam" @saved="onSaved" />

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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import oncallService from "@/services/oncall";
import type { OnCallPosition, OnCallTeam } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { isOnCallUnavailable } from "@/utils/oncall";
import { toast } from "@/lib/feedback/Toast/useToast";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { canConfigure, noteConfigurationDenied } = useOnCallPermissions();

const teams = ref<OnCallTeam[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const notAvailable = ref(false);
const search = ref("");
const formOpen = ref(false);
const editingTeam = ref<OnCallTeam | null>(null);
const teamToDelete = ref<OnCallTeam | null>(null);
// Which row's test page is in flight — a page-wide flag would spin every row.
// Undefined = not fetched yet, so a team in flight reads as loading rather
// than as an empty rotation.
const onCallByTeam = ref<Record<string, OnCallPosition[]>>({});

const orgId = computed(() => store.state.selectedOrganization.identifier);

/// The first rotation, and everything else.
///
/// Split by POSITION in the response rather than by a slot named "primary":
/// there is no keyword left to resolve, and every entry is an ordinary
/// rotation. A third rotation keeps its name and stays on the page rather than
/// being dropped by a column that only knows two.
///
/// A rotation that resolves to nobody is absent from the response, so `first`
/// being undefined IS the coverage gap — nothing has to check for a null holder.
const positionsByTeam = computed<
  Record<string, { first: OnCallPosition | undefined; rest: OnCallPosition[] }>
>(() =>
  Object.fromEntries(
    Object.entries(onCallByTeam.value).map(([teamId, held]) => [
      teamId,
      { first: held[0], rest: held.slice(1) },
    ]),
  ),
);

const columns = computed<OTableColumnDef<OnCallTeam>[]>(() => {
  // Read the split HERE rather than inside the accessor: the sort key has to
  // change with the rotations, and a closure that reads the ref lazily leaves
  // the table ordered on what it knew before the rotations landed.
  const held = positionsByTeam.value;
  const holders = (teamId: string, which: "first" | "rest") => {
    const entry = held[teamId];
    if (!entry) return "";
    const list = which === "first" ? (entry.first ? [entry.first] : []) : entry.rest;
    return list.map((position) => position.user_email).join(", ");
  };

  return [
    {
      id: "name",
      header: t("oncall.teamName"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      minSize: 160,
      meta: { isName: true },
    },
    {
      // Sorted ascending an unstaffed pool has no holder to sort by, so the
      // gaps float to the top — the rows worth finding first.
      id: "primary",
      header: t("oncall.rolePrimary"),
      size: 220,
      minSize: 180,
      sortable: true,
      accessorFn: (row: OnCallTeam) => holders(row.id, "first"),
    },
    {
      id: "secondary",
      header: t("oncall.roleSecondary"),
      size: 220,
      minSize: 180,
      sortable: true,
      hideable: true,
      accessorFn: (row: OnCallTeam) => holders(row.id, "rest"),
    },
    {
      id: "timezone",
      header: t("oncall.timezone"),
      accessorKey: "timezone",
      sortable: true,
      hideable: true,
      size: 170,
    },
    {
      id: "description",
      header: t("oncall.description"),
      accessorFn: (row: OnCallTeam) => row.description || "—",
      sortable: true,
      hideable: true,
      size: COL.description,
      minSize: 200,
      // Free text and the widest value in the row, so it absorbs the leftover
      // width instead of every fixed column being stretched to fill it.
      meta: { flex: true },
    },
    {
      // Declared last because it renders last — OTable pins an action column to
      // the right edge. No `size`: OTable derives the exact width from the icon
      // count, and any number we pass can only make it wider than the buttons.
      id: "actions",
      header: t("oncall.actions"),
      isAction: true,
      sortable: false,
      meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
    },
  ];
});

const filteredTeams = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return teams.value;
  return teams.value.filter((team) =>
    [
      team.name,
      team.description ?? "",
      team.timezone,
      // "Which team would page Priya right now" is a question this list can
      // answer in one keystroke; without the holders it costs a drill-in per
      // team, which is the same search done by hand.
      ...(onCallByTeam.value[team.id] ?? []).map((slot) => slot.user_email),
    ].some((field) => field.toLowerCase().includes(q)),
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
    noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        err?.response?.status === 403
          ? t("oncall.configDenied")
          : raw(err?.response?.data?.message) || t("oncall.deleteTeamFailed"),
    });
  }
}

function openPolicies() {
  router.push({ name: "onCallPolicies", query: { org_identifier: orgId.value } });
}

function openCreate() {
  editingTeam.value = null;
  formOpen.value = true;
}

function openEdit(team: OnCallTeam) {
  editingTeam.value = team;
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

/// `?action=add` — somebody arrived here already meaning to create a team, and
/// making them find the button again is the same click twice. Sent by the setup
/// checklist's first step, which is the one place that knows the visitor has no
/// team at all.
///
/// The parameter is consumed rather than left in the URL: it describes an
/// intent that has now been acted on, and a refresh or a Back into this page
/// would otherwise reopen a form the reader had deliberately closed.
function syncFromRoute() {
  if (route.query.action !== "add") return;

  openCreate();

  const { action: _action, ...rest } = route.query;
  router.replace({ name: route.name ?? undefined, params: route.params, query: rest });
}

// Watched as well as read on mount: arriving with the intent a second time is a
// query change on a route that is already mounted.
watch(() => route.query.action, syncFromRoute);

onMounted(() => {
  fetchTeams();
  syncFromRoute();
});
</script>
