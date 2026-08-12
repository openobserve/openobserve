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
        icon-left="person"
        data-test="oncall-responses-mine-btn"
        @click="goTo('onCallMine')"
      >
        {{ t("oncall.myOnCallNav") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        icon-left="group-work"
        data-test="oncall-responses-teams-btn"
        @click="goTo('onCallTeams')"
      >
        {{ t("oncall.teams") }}
      </OButton>
    </template>

    <!-- Setup is answered from live data, so it survives past "no teams": a
         team with nobody in its rotation pages nobody, and the calm empty
         state below would call that healthy. -->
    <OnCallSetupChecklist
      v-if="showChecklist"
      :has-team="setup.hasTeam"
      :has-staffed-rotation="setup.hasStaffedRotation"
      :has-routing="setup.hasRouting"
      :can-configure="canConfigure"
      :first-team-id="teams[0]?.id ?? null"
      @create-team="goTo('onCallTeams')"
    />

    <OTable
      :frame="false"
      :data="rows"
      :columns="columns"
      row-key="rowKey"
      :loading="loading"
      :streaming="polling"
      :error="loadError"
      pagination="client"
      :page-size="20"
      sort-by="opened_at"
      sort-order="desc"
      :column-visibility="{ firings: false, acked_by: false }"
      table-id="oncall-responses-list"
      :persist-columns="true"
      :show-global-filter="false"
      :enable-column-resize="true"
      data-test="oncall-responses-table"
      :row-rail-tone="rowRailTone"
      :row-tone="rowTone"
      selection="multiple"
      v-model:selected-ids="selectedIds"
      :is-row-selectable="canAcknowledge"
      @row-click="openResponse"
    >
      <!-- Counts describe the filtered list below, which is honest here only
           because everything the filters see is already loaded. -->
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
        <div v-if="selectedIds.length" class="flex w-full flex-wrap items-center gap-2">
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
          <ODropdown>
            <template #trigger>
              <OButton
                variant="outline"
                size="sm-action"
                icon-right="expand-more"
                :loading="bulkBusy"
                data-test="oncall-bulk-snooze"
              >
                {{ t("oncall.snooze") }}
              </OButton>
            </template>
            <ODropdownItem
              v-for="option in snoozeOptions"
              :key="option.minutes"
              :data-test="`oncall-bulk-snooze-${option.minutes}`"
              @select="bulkSnooze(option.minutes)"
            >
              {{ option.label }}
            </ODropdownItem>
          </ODropdown>
          <OButton
            variant="outline"
            size="sm-action"
            :loading="bulkBusy"
            data-test="oncall-bulk-resolve"
            @click="confirmBulkResolve = true"
          >
            {{ t("oncall.resolve") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="oncall-bulk-cancel"
            @click="selectedIds = []"
          >
            {{ t("oncall.cancel") }}
          </OButton>
        </div>
        <div v-else class="flex w-full flex-wrap items-center gap-2">
          <OSelect
            v-model="teamFilter"
            :options="teamOptions"
            :disabled="!teamsAvailable"
            :placeholder="teamsAvailable ? undefined : t('oncall.teamFilterUnavailable')"
            class="w-56"
            data-test="oncall-responses-team-filter"
          />
          <OSelect
            v-model="priorityFilter"
            :options="priorityOptions"
            class="w-40"
            data-test="oncall-responses-priority-filter"
          />
          <!-- `basis-40` so the search keeps a usable width once the row
               wraps, instead of collapsing to its padding. -->
          <OSearchInput
            v-model="search"
            class="min-w-40 flex-1 basis-40"
            clearable
            :placeholder="t('oncall.searchResponses')"
            data-test="oncall-responses-search"
          />
          <!-- A resolved page is the only record of what happened, and it was
               reachable from nowhere. Off by default so the live list stays
               about what still needs somebody. -->
          <OCheckbox
            v-model="includeResolved"
            :label="t('oncall.showResolved')"
            data-test="oncall-responses-resolved-toggle"
            @update:model-value="() => fetchResponses()"
          />
          <!-- On by default. A rule firing every minute is one problem, not
               ninety-five, and the ungrouped view is for reading history. -->
          <OCheckbox
            v-model="grouped"
            :label="t('oncall.groupByAlert')"
            data-test="oncall-responses-group-toggle"
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
          @click="refreshAll"
        >
          <OTooltip side="bottom" :content="t('oncall.refresh')" shortcut-id="oncallRefresh" />
        </OButton>
      </template>

      <!-- A silent poll must never blank the table under somebody's hands. -->
      <template #loading-banner>
        <span data-test="oncall-responses-poll-banner">{{ t("oncall.loadingShort") }}</span>
      </template>

      <template #cell-priority="{ row }">
        <OTag type="alertPriority" :value="`p${row.latest.priority}`" size="sm" />
      </template>

      <!-- "95 firings" is the number that matters; a single firing's number
           only means something on its own record. -->
      <template #cell-firings="{ row }">
        <OTag v-if="row.firings.length > 1" variant="default-soft" size="sm">
          {{ t("oncall.firingCount", { count: row.firings.length }) }}
        </OTag>
        <span v-else class="text-text-muted text-sm">
          {{ raw(`#${row.latest.subject.firing}`) }}
        </span>
      </template>

      <!-- A snoozed page is still open, so it would otherwise look exactly
           like one escalating right now. -->
      <template #cell-state="{ row }">
        <span class="flex flex-wrap items-center gap-1">
          <OTag type="oncallResponseState" :value="row.latest.state" size="sm" />
          <OTag v-if="isSnoozed(row.latest)" variant="warning-soft" size="sm">
            {{ t("oncall.snoozed") }}
          </OTag>
        </span>
      </template>

      <!-- No team means nothing claimed it, which is a routing bug rather than
           a blank cell. -->
      <template #cell-team="{ row }">
        <OTag v-if="!row.latest.team_id" variant="error-soft" size="sm">
          {{ t("oncall.statUnrouted") }}
        </OTag>
        <span v-else class="text-text-body truncate text-sm">
          {{ raw(teamNameById[row.latest.team_id] ?? row.latest.team_id) }}
        </span>
      </template>

      <template #cell-opened_at="{ row }">
        <OTimeCell :value="row.latest.opened_at" unit="us" />
      </template>

      <template #cell-actions="{ row }">
        <span class="flex items-center justify-center gap-1">
          <OButton
            v-if="canAcknowledge(row)"
            variant="outline"
            size="sm-action"
            :loading="busyId === row.rowKey"
            :data-test="`oncall-row-ack-${row.rowKey}`"
            @click.stop="acknowledgeRow(row)"
          >
            {{ t("oncall.acknowledge") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            :loading="busyId === row.rowKey"
            :data-test="`oncall-row-resolve-${row.rowKey}`"
            @click.stop="resolveRow(row)"
          >
            {{ t("oncall.resolve") }}
          </OButton>
        </span>
      </template>

      <!-- A transient 500 is not "this org has no pages", and it must offer a
           way back rather than a dead end. -->
      <template #error>
        <OEmptyState
          size="hero"
          variant="error"
          illustration="broken-panel"
          :title="t('oncall.loadResponsesFailed')"
          :description="loadError ? raw(loadError) : undefined"
          :action-label="t('oncall.retry')"
          data-test="oncall-responses-error"
          @action="refreshAll"
        />
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

      <!-- The server caps a page at 200 and the facets have to be honest about
           what they counted, so say so rather than quietly under-reporting. -->
      <template v-if="truncated" #bottom>
        <span class="text-text-secondary text-xs" data-test="oncall-responses-truncated">
          {{ t("oncall.listTruncated", { count: responses.length, total: totalCount }) }}
        </span>
      </template>
    </OTable>

    <ConfirmDialog
      v-model="confirmBulkResolve"
      :title="t('oncall.bulkResolveTitle')"
      :message="t('oncall.bulkResolveConfirm', { count: selectedIds.length })"
      @update:ok="bulkResolve"
      @update:cancel="confirmBulkResolve = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallPolling } from "@/composables/useOnCallPolling";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef, RowRailTone, RowTone } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import oncallService, { RESPONSE_PAGE_LIMIT } from "@/services/oncall";
import type {
  CoverageGaps,
  OnCallResponse,
  OnCallResponseGroup,
  OnCallTeam,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { groupBySubject, isEscalating, isSnoozed, priorityTone } from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();

/// A table row. Grouped or not, every row carries the same shape so the
/// columns and the actions never have to branch on the mode.
type PageRow = OnCallResponseGroup & { rowKey: string };

/// A busy org has more open records than one request may return, and the
/// facets have to count what the table can show. Three pages of the server's
/// cap is where "honest counts" stops being worth another round trip.
const MAX_PAGES = 3;

const responses = ref<OnCallResponse[]>([]);
const teams = ref<OnCallTeam[]>([]);
const teamsAvailable = ref(true);
const totalCount = ref(0);
const truncated = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const search = ref("");
const teamFilter = ref("all");
const priorityFilter = ref("all");
const stateFilter = ref<string | null>(null);
const selectedIds = ref<string[]>([]);
const grouped = ref(true);
const includeResolved = ref(false);
const busyId = ref("");
const bulkBusy = ref(false);
const confirmBulkResolve = ref(false);

// Only after the first fetch, so the checklist never flashes while loading.
const loaded = ref(false);
const setup = ref({ hasTeam: false, hasStaffedRotation: false, hasRouting: false });

const orgId = computed(() => store.state.selectedOrganization.identifier);
/// Lowercased to compare with `acked_by`, which the server normalises on a
/// handoff but not necessarily on a self-acknowledgement.
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? "").toLowerCase());

const teamNameById = computed<Record<string, string>>(() =>
  Object.fromEntries(teams.value.map((team) => [team.id, team.name])),
);

const teamOptions = computed(() => [
  { label: t("oncall.allTeams"), value: "all" },
  ...teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const priorityOptions = computed(() => [
  { label: t("oncall.allPriorities"), value: "all" },
  // "P1" is the same identifier on every surface — the alertPriority badge
  // group renders it with `raw` too.
  ...[1, 2, 3, 4, 5].map((p) => ({ label: raw(`P${p}`), value: String(p) })),
]);

const snoozeOptions = computed(() => [
  { minutes: 15, label: t("oncall.snooze15m") },
  { minutes: 30, label: t("oncall.snooze30m") },
  { minutes: 60, label: t("oncall.snooze1h") },
  { minutes: 180, label: t("oncall.snooze3h") },
]);

const isFiltered = computed(
  () =>
    !!search.value ||
    teamFilter.value !== "all" ||
    priorityFilter.value !== "all" ||
    stateFilter.value !== null,
);

const showChecklist = computed(
  () =>
    loaded.value &&
    !loadError.value &&
    !(setup.value.hasTeam && setup.value.hasStaffedRotation && setup.value.hasRouting),
);

const columns = computed<OTableColumnDef<PageRow>[]>(() => [
  {
    id: "priority",
    header: t("oncall.priority"),
    size: 88,
    accessorFn: (row: PageRow) => row.latest.priority,
    sortable: true,
  },
  {
    id: "subject",
    header: t("oncall.subject"),
    // The producer sends the alert's name; the source id is a ksuid and tells
    // a woken engineer nothing. Fall back only when there is no title.
    accessorFn: (row: PageRow) => row.latest.title || row.latest.subject.source_id,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "state",
    header: t("oncall.state"),
    size: 128,
    accessorFn: (row: PageRow) => row.latest.state,
    sortable: true,
  },
  {
    id: "team",
    header: t("oncall.team"),
    size: 160,
    accessorFn: (row: PageRow) =>
      teamNameById.value[row.latest.team_id] ?? row.latest.team_id ?? "",
    sortable: true,
    hideable: true,
  },
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    size: 128,
    accessorFn: (row: PageRow) => row.latest.opened_at,
    sortable: true,
    hideable: true,
  },
  {
    // "95 firings" is the number that matters; the individual firing number
    // only means something on a single record. Secondary, so off by default.
    id: "firings",
    header: t("oncall.firings"),
    size: 112,
    accessorFn: (row: PageRow) => row.firings.length,
    sortable: true,
    hideable: true,
  },
  {
    id: "acked_by",
    header: t("oncall.ackedBy"),
    size: 160,
    accessorFn: (row: PageRow) => row.latest.acked_by || "—",
    sortable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 176,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

// Everything except the state facet, so the strip counts what the rest of the
// filters allow — a tile that changed its own number as you clicked it would
// be unreadable.
const scopedResponses = computed(() => {
  const q = search.value.trim().toLowerCase();
  return responses.value.filter((row) => {
    if (teamFilter.value !== "all" && row.team_id !== teamFilter.value) return false;
    if (priorityFilter.value !== "all" && String(row.priority) !== priorityFilter.value) {
      return false;
    }
    if (!q) return true;
    return (
      (row.title ?? "").toLowerCase().includes(q) ||
      row.subject.source_id.toLowerCase().includes(q) ||
      (row.acked_by ?? "").toLowerCase().includes(q)
    );
  });
});

/// Asked of a ROW, not a record, so the strip counts the same things the
/// table shows. A group is unacknowledged if any firing in it still is.
function matchesStateFacet(row: PageRow, facet: string | null): boolean {
  switch (facet) {
    case "unacked":
      return row.escalating.some((r) => !r.acked_by && !isSnoozed(r));
    case "p1":
      return row.latest.priority === 1 && row.escalating.length > 0;
    case "acked":
      return row.firings.some((r) => r.state === "acknowledged");
    case "snoozed":
      return row.firings.some((r) => isSnoozed(r));
    // Whoever acknowledged it owns it: a handoff to a person acknowledges as
    // the new owner, so this is the same field either way.
    case "mine":
      return row.firings.some(
        (r) => !!r.acked_by && r.acked_by.toLowerCase() === viewerEmail.value,
      );
    // A record with no team paged nobody. The one facet that is a
    // configuration bug rather than a state somebody is working through.
    case "unrouted":
      return !row.latest.team_id;
    default:
      return true;
  }
}

/// Grouped or not, downstream code sees one shape.
function toRows(records: OnCallResponse[]): PageRow[] {
  const groups = grouped.value
    ? groupBySubject(records)
    : records.map((r) => ({
        latest: r,
        firings: [r],
        escalating: isEscalating(r.state) ? [r] : [],
      }));
  // Keyed by the record when ungrouped so two firings never collapse into one
  // table row by accident.
  return groups.map((g) => ({
    ...g,
    rowKey: grouped.value
      ? `${g.latest.subject.subject_type}:${g.latest.subject.source_id}`
      : g.latest.id,
  }));
}

const scopedRows = computed(() => toRows(scopedResponses.value));

const rows = computed(() =>
  scopedRows.value.filter((row) => matchesStateFacet(row, stateFilter.value)),
);

// Attention-first, with the total last: whoever opens this page needs the
// pages nobody has taken before anything else.
const summaryStats = computed<StatItem[]>(() => {
  const all = scopedRows.value;
  const count = (facet: string) => all.filter((r) => matchesStateFacet(r, facet)).length;
  const items: StatItem[] = [
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
      key: "mine",
      label: t("oncall.statMine"),
      value: count("mine"),
      icon: "person",
      tone: "info",
      dataTest: "oncall-stat-mine",
    },
    {
      // Now reachable: an acknowledged page stays in the list, so it needs a
      // way to be found.
      key: "acked",
      label: t("oncall.statAcked"),
      value: count("acked"),
      icon: "check-circle",
      tone: "info",
      dataTest: "oncall-stat-acked",
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
      key: "unrouted",
      label: t("oncall.statUnrouted"),
      value: count("unrouted"),
      icon: "help-outline",
      tone: "error",
      dataTest: "oncall-stat-unrouted",
    },
    {
      key: "all",
      label: t("oncall.statAll"),
      value: all.length,
      icon: "format-list-bulleted",
      tone: "neutral",
      dataTest: "oncall-stat-all",
    },
  ];
  // Dropped entirely when we do not know who is signed in, rather than left as
  // a tile that can only ever read zero.
  return viewerEmail.value ? items : items.filter((item) => item.key !== "mine");
});

// Only an escalating page can be claimed. A row with nothing left to claim
// offers no button rather than one that errors.
function canAcknowledge(row: PageRow): boolean {
  return row.escalating.length > 0;
}

/// Acts on every firing the row stands for. Acknowledging the latest of
/// ninety-five and leaving ninety-four escalating would be a worse lie than
/// showing all ninety-five rows.
async function acknowledgeRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    await Promise.allSettled(
      row.escalating.map((r) =>
        oncallService.acknowledgeResponse({
          org_identifier: orgId.value,
          response_id: r.id,
        }),
      ),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

async function resolveRow(row: PageRow) {
  busyId.value = row.rowKey;
  try {
    await Promise.allSettled(
      row.firings
        .filter((r) => r.state !== "resolved")
        .map((r) =>
          oncallService.resolveResponse({
            org_identifier: orgId.value,
            response_id: r.id,
          }),
        ),
    );
    await fetchResponses();
  } finally {
    busyId.value = "";
  }
}

/// The records the selection stands for. `pick` narrows to the ones the action
/// can legally touch, so a bulk action never fires a request that must fail.
function selectedRecords(pick: (row: PageRow) => OnCallResponse[]): string[] {
  return rows.value
    .filter((r) => selectedIds.value.includes(r.rowKey))
    .flatMap((r) => pick(r).map((e) => e.id));
}

type BulkDoneKey = "bulkAckDone" | "bulkSnoozeDone" | "bulkResolveDone";
type BulkPartialKey = "bulkAckPartial" | "bulkSnoozePartial" | "bulkResolvePartial";

// Settled, not all-or-nothing: one page failing must not silently abandon the
// other ninety-nine. All three bulk actions share this shape.
async function runBulk(
  ids: string[],
  call: (id: string) => Promise<unknown>,
  doneKey: BulkDoneKey,
  partialKey: BulkPartialKey,
) {
  bulkBusy.value = true;
  try {
    const results = await Promise.allSettled(ids.map(call));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      toast({ variant: "error", message: t(`oncall.${partialKey}`, { count: failed }) });
    } else {
      toast({ variant: "success", message: t(`oncall.${doneKey}`, { count: ids.length }) });
    }
    selectedIds.value = [];
    await fetchResponses();
  } finally {
    bulkBusy.value = false;
  }
}

async function bulkAcknowledge() {
  await runBulk(
    selectedRecords((r) => r.escalating),
    (id) => oncallService.acknowledgeResponse({ org_identifier: orgId.value, response_id: id }),
    "bulkAckDone",
    "bulkAckPartial",
  );
}

/// Snooze quiets an escalating record WITHOUT claiming it, so it only applies
/// to the ones still climbing the ladder.
async function bulkSnooze(minutes: number) {
  await runBulk(
    selectedRecords((r) => r.escalating),
    (id) => oncallService.snoozeResponse({ org_identifier: orgId.value, response_id: id, minutes }),
    "bulkSnoozeDone",
    "bulkSnoozePartial",
  );
}

async function bulkResolve() {
  confirmBulkResolve.value = false;
  await runBulk(
    selectedRecords((r) => r.firings.filter((f) => f.state !== "resolved")),
    (id) => oncallService.resolveResponse({ org_identifier: orgId.value, response_id: id }),
    "bulkResolveDone",
    "bulkResolvePartial",
  );
}

// Re-clicking the live tile clears it; "All" only ever clears.
function onStatSelect(key: string) {
  stateFilter.value = key === "all" || stateFilter.value === key ? null : key;
}

// The rail carries severity on every row. A closed record has no severity left
// to signal, so it gets none rather than a stale colour.
function rowRailTone(row: PageRow): RowRailTone | null {
  return isEscalating(row.latest.state) ? priorityTone(row.latest.priority) : null;
}

// Snoozed rows are deliberately inert, so they recede. This is the only wash
// on the list — the loud one is reserved for something you must act on now.
function rowTone(row: PageRow): RowTone | null {
  return isSnoozed(row.latest) ? "muted" : null;
}

function errorMessage(err: unknown): string {
  const body = (err as { response?: { data?: { message?: string } } } | null)?.response?.data;
  return body?.message ?? (err instanceof Error ? err.message : "");
}

/// Walks the server's pages until a short one arrives or the cap is hit. The
/// alternative — one page plus client-side facets over it — would put a number
/// on the stat strip that silently described a fraction of the org.
async function fetchAllPages(): Promise<OnCallResponse[]> {
  const out: OnCallResponse[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await oncallService.listResponses({
      org_identifier: orgId.value,
      include_resolved: includeResolved.value,
      limit: RESPONSE_PAGE_LIMIT,
      offset: page * RESPONSE_PAGE_LIMIT,
    });
    const batch = res.data ?? [];
    out.push(...batch);
    if (batch.length < RESPONSE_PAGE_LIMIT) {
      truncated.value = false;
      return out;
    }
  }
  truncated.value = true;
  return out;
}

/// `showSpinner` is false for the poll: it must never blank the table.
async function fetchResponses(showSpinner = true) {
  if (showSpinner) loading.value = true;
  try {
    responses.value = await fetchAllPages();
    loadError.value = null;
    // Only on SUCCESS. Setting this in `finally` would let a transient API
    // error render the first-run checklist, telling a configured org that
    // nothing is set up.
    loaded.value = true;
    await refreshTotal();
  } catch (err) {
    loadError.value = errorMessage(err) || String(t("oncall.loadResponsesFailed"));
  } finally {
    if (showSpinner) loading.value = false;
  }
}

/// Best-effort: the real total only matters when the list is truncated, and a
/// server without the counter must not break the screen.
async function refreshTotal() {
  try {
    const res = await oncallService.countResponses({
      org_identifier: orgId.value,
      include_resolved: includeResolved.value,
    });
    totalCount.value = res.data?.count ?? responses.value.length;
  } catch {
    totalCount.value = responses.value.length;
  }
}

/// Teams, coverage and ownership answer the checklist, not the list. A failure
/// on any one of them degrades a single control rather than the page.
async function fetchContext() {
  const [teamRes, gapRes, ruleRes] = await Promise.allSettled([
    oncallService.listTeams({ org_identifier: orgId.value }),
    oncallService.coverageGaps({ org_identifier: orgId.value }),
    oncallService.listOwnershipRules({ org_identifier: orgId.value }),
  ]);

  teamsAvailable.value = teamRes.status === "fulfilled";
  teams.value = teamRes.status === "fulfilled" ? (teamRes.value.data ?? []) : [];

  const rules = ruleRes.status === "fulfilled" ? (ruleRes.value.data ?? []) : [];

  setup.value = {
    hasTeam: teams.value.length > 0,
    hasStaffedRotation: await someTeamWouldPage(gapRes),
    // An alert bound straight to a team counts: it is routing without a rule.
    hasRouting: rules.length > 0 || responses.value.some((r) => !!r.team_id),
  };
}

/// "Would any team page a person right now?" The coverage-gap endpoint answers
/// it in one request; when it is unavailable we ask each team instead, because
/// a missing gap count is not the same fact as a gap count of zero — reading it
/// as zero marked the rotation staffed on an org that had no rotation at all,
/// and that tick also hides the checklist that would have said so.
async function someTeamWouldPage(
  gapRes: PromiseSettledResult<{ data?: CoverageGaps | null }>,
): Promise<boolean> {
  if (!teams.value.length) return false;
  if (gapRes.status === "fulfilled") {
    return (gapRes.value.data?.total ?? 0) < teams.value.length;
  }
  const slots = await Promise.allSettled(
    teams.value.map((team) =>
      oncallService.whoIsOnCall({ org_identifier: orgId.value, team_id: team.id }),
    ),
  );
  return slots.some((s) => s.status === "fulfilled" && (s.value.data ?? []).length > 0);
}

async function refreshAll() {
  await fetchResponses();
  await fetchContext();
}

// A poll must not reshuffle rows under a selection somebody is about to act
// on, and must not stack on a fetch already running.
const { polling } = useOnCallPolling(
  () => fetchResponses(false),
  () => loading.value || bulkBusy.value || selectedIds.value.length > 0,
);

function goTo(name: string) {
  router.push({ name, query: { org_identifier: orgId.value } });
}

function openResponse(row: PageRow) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.latest.id },
    query: { org_identifier: orgId.value },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    teamFilter.value = "all";
    priorityFilter.value = "all";
    stateFilter.value = null;
  }
}

useShortcuts([
  {
    id: "oncallRefresh",
    handler: () => {
      if (isInputFocused()) return;
      void refreshAll();
    },
  },
  { id: "oncallSearch", handler: () => focusSearchInput("oncall-responses-search") },
]);

onMounted(refreshAll);
</script>
