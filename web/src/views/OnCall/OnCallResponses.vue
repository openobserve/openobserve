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
      :row-class="rowClass"
      :get-row-style="rowStyle"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      :is-row-selectable="canAcknowledge"
      @row-click="openResponse"
    >
      <!-- Counts describe the filtered list below, which is honest here only
           because the whole set is fetched and paginated client-side. -->
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="oncall-responses-summary"
        >
          <OStatStrip
            :items="summaryStats"
            :loading="loading"
            selectable
            :selected-key="stateFilter"
            @select="onStatSelect"
          />
        </div>
      </template>

      <!-- During an incident the list IS the work surface. Opening 200 pages
           one at a time to claim them is not triage. -->
      <template #toolbar>
        <div v-if="selectedIds.length" class="flex w-full items-center gap-2">
          <span class="text-text-body text-sm" data-test="oncall-bulk-count">
            {{ t("oncall.selectedCount", { count: selectedIds.length }) }}
          </span>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="bulkBusy"
            data-test="oncall-bulk-ack"
            @click="bulkAcknowledge"
          >
            {{ t("oncall.acknowledge") }}
          </OButton>
          <OButton variant="outline" size="sm-action" @click="selectedIds = []">
            {{ t("oncall.cancel") }}
          </OButton>
        </div>
        <div v-else class="flex w-full items-center gap-2">
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
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import type { OnCallResponse, OnCallTeam } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  isEscalating,
  isSnoozed,
  priorityLabel,
  priorityRailColor,
  priorityTagVariant,
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
const stateFilter = ref<string | null>(null);
const selectedIds = ref<string[]>([]);
const busyId = ref("");
const bulkBusy = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamNameById = computed(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

const teamOptions = computed(() => [
  { label: t("oncall.allTeams"), value: "all" },
  ...teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const isFiltered = computed(
  () => !!search.value || teamFilter.value !== "all" || stateFilter.value !== null,
);

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
    // The producer sends the alert's name; the source id is a ksuid and tells
    // a woken engineer nothing. Fall back only when there is no title.
    accessorFn: (row: OnCallResponse) => row.title || row.subject.source_id,
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
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 150,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
    cell: (ctx: any) => {
      const row = ctx.row.original as OnCallResponse;
      const buttons = [];
      if (canAcknowledge(row)) {
        buttons.push(
          h(
            OButton,
            {
              variant: "outline",
              size: "sm-action",
              loading: busyId.value === row.id,
              "data-test": `oncall-row-ack-${row.id}`,
              // The row itself navigates; an action inside it must not.
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                acknowledgeRow(row);
              },
            },
            () => t("oncall.acknowledge"),
          ),
        );
      }
      buttons.push(
        h(
          OButton,
          {
            variant: "outline",
            size: "sm-action",
            loading: busyId.value === row.id,
            "data-test": `oncall-row-resolve-${row.id}`,
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              resolveRow(row);
            },
          },
          () => t("oncall.resolve"),
        ),
      );
      return h("span", { class: "flex items-center justify-center gap-1" }, buttons);
    },
  },
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    size: 120,
    accessorFn: (row: OnCallResponse) => row.opened_at,
    sortable: true,
    cell: (ctx: any) => h(OTimeCell, { value: ctx.row.original.opened_at, unit: "us" }),
  },
]);

// Everything except the state facet, so the strip counts what the rest of the
// filters allow — a tile that changed its own number as you clicked it would
// be unreadable.
const scopedResponses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return responses.value.filter((row) => {
    if (teamFilter.value !== "all" && row.team_id !== teamFilter.value) return false;
    if (!q) return true;
    return (
      (row.title ?? "").toLowerCase().includes(q) ||
      row.subject.source_id.toLowerCase().includes(q) ||
      (row.acked_by ?? "").toLowerCase().includes(q)
    );
  });
});

function matchesStateFacet(row: OnCallResponse, facet: string | null): boolean {
  switch (facet) {
    case "unacked":
      return isEscalating(row.state) && !row.acked_by && !isSnoozed(row);
    case "p1":
      return row.priority === 1 && isEscalating(row.state);
    case "snoozed":
      return isSnoozed(row);
    default:
      return true;
  }
}

const filteredResponses = computed(() =>
  scopedResponses.value.filter((row) => matchesStateFacet(row, stateFilter.value)),
);

// Attention-first, with the total last: whoever opens this page needs the
// pages nobody has taken before anything else.
const summaryStats = computed<StatItem[]>(() => {
  const rows = scopedResponses.value;
  const count = (facet: string) => rows.filter((r) => matchesStateFacet(r, facet)).length;
  return [
    {
      key: "unacked",
      label: t("oncall.statUnacked"),
      value: count("unacked"),
      icon: "notifications-active",
      tone: "error",
      dataTest: "oncall-stat-unacked",
    },
    {
      key: "p1",
      label: t("oncall.statP1"),
      value: count("p1"),
      icon: "warning-amber",
      tone: "orange",
      dataTest: "oncall-stat-p1",
    },
    {
      key: "snoozed",
      label: t("oncall.statSnoozed"),
      value: count("snoozed"),
      icon: "pause-circle-filled",
      tone: "warning",
      dataTest: "oncall-stat-snoozed",
    },
    {
      key: "all",
      label: t("oncall.statAll"),
      value: rows.length,
      icon: "format-list-bulleted",
      tone: "neutral",
      dataTest: "oncall-stat-all",
    },
  ];
});

// Only an escalating page can be claimed; one that is already owned or closed
// would just error.
function canAcknowledge(row: OnCallResponse): boolean {
  return isEscalating(row.state);
}

async function acknowledgeRow(row: OnCallResponse) {
  busyId.value = row.id;
  try {
    await oncallService.acknowledgeResponse({
      org_identifier: orgId.value,
      response_id: row.id,
    });
    await fetchResponses();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.acknowledgeFailed"),
    });
  } finally {
    busyId.value = "";
  }
}

async function resolveRow(row: OnCallResponse) {
  busyId.value = row.id;
  try {
    await oncallService.resolveResponse({
      org_identifier: orgId.value,
      response_id: row.id,
    });
    await fetchResponses();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.resolveFailed"),
    });
  } finally {
    busyId.value = "";
  }
}

// Settled, not all-or-nothing: one page failing to ack must not silently
// abandon the other ninety-nine.
async function bulkAcknowledge() {
  bulkBusy.value = true;
  const ids = [...selectedIds.value];
  try {
    const results = await Promise.allSettled(
      ids.map((id) =>
        oncallService.acknowledgeResponse({
          org_identifier: orgId.value,
          response_id: id,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      toast({ variant: "error", message: t("oncall.bulkAckPartial", { count: failed }) });
    } else {
      toast({ variant: "success", message: t("oncall.bulkAckDone", { count: ids.length }) });
    }
    selectedIds.value = [];
    await fetchResponses();
  } finally {
    bulkBusy.value = false;
  }
}

// Re-clicking the live tile clears it; "All" only ever clears.
function onStatSelect(key: string) {
  stateFilter.value = key === "all" || stateFilter.value === key ? null : key;
}

// The rail carries severity on every row. A closed record has no severity left
// to signal, so it gets none rather than a stale colour.
function rowStyle(row: OnCallResponse): Record<string, string> {
  if (!isEscalating(row.state)) return {};
  return { boxShadow: `inset 0.25rem 0 0 0 ${priorityRailColor(row.priority)}` };
}

// Snoozed rows are deliberately inert, so they recede. This is the only wash
// on the list — the loud one is reserved for something you must act on now.
function rowClass(row: OnCallResponse): string {
  return isSnoozed(row) ? "!bg-surface-panel" : "";
}

async function fetchResponses() {
  loading.value = true;
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
    stateFilter.value = null;
  }
}

onMounted(fetchResponses);
</script>
