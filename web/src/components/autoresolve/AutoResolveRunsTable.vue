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
  <section v-if="compact" class="flex flex-col gap-2" data-test="autoresolve-runs-recent">
    <div class="flex min-h-8 items-center justify-between gap-2">
      <h2 class="text-text-heading m-0 text-sm font-semibold">
        {{ autoresolveId ? t("autoresolve.saved.lastRuns") : t("autoresolve.runs.recent") }}
      </h2>
      <OButton
        v-if="!autoresolveId && total > rows.length"
        variant="ghost-primary"
        size="sm"
        data-test="autoresolve-runs-view-all"
        @click="emit('view-all')"
      >
        {{ t("autoresolve.runs.viewAll") }}
      </OButton>
    </div>
    <OTable
      v-if="loading || rows.length || forbidden || loadError"
      :data="rows"
      :columns="autoresolveId ? savedColumns : compactColumns"
      row-key="id"
      pagination="none"
      :fill-height="false"
      frame
      :loading="loading"
      :forbidden="forbidden"
      :error="loadError"
      :show-global-filter="false"
      :default-columns="false"
      data-test="autoresolve-runs-recent-table"
      @row-click="openRun"
    >
      <template #cell-created_at_us="{ row }">
        <OTimeCell :value="row.created_at_us" unit="us" :timezone="store.state.timezone" />
      </template>
      <template #cell-state="{ row }">
        <OTag type="autoresolveRunState" :value="shownRunState(row)" size="sm" />
      </template>
      <template #cell-requester="{ row }">
        <OUserCell v-if="row.trigger.kind === 'person'" :value="row.requester" />
        <OTruncatedText v-else>{{ startedByText(row.trigger, row.requester) }}</OTruncatedText>
      </template>
      <template #error="{ message }">
        <OEmptyState
          size="compact"
          preset="load-error"
          :description="raw(message)"
          @action="refresh"
        />
      </template>
    </OTable>
    <div
      v-else
      class="border-border-default rounded-surface border border-dashed"
      data-test="autoresolve-runs-recent-empty"
    >
      <OEmptyState
        size="inline"
        icon="history"
        preset="no-autoresolve-runs"
        :description="autoresolveId ? t('autoresolve.saved.lastRunsEmpty') : undefined"
      />
    </div>
    <p
      v-if="autoresolveId && total > rows.length"
      class="text-text-secondary m-0 text-xs"
      data-test="autoresolve-runs-recent-more"
    >
      {{ t("autoresolve.saved.lastRunsMore", { shown: rows.length, total }) }}
    </p>
  </section>

  <OTable
    v-else
    :data="rows"
    :columns="columns"
    row-key="id"
    pagination="server"
    :current-page="page"
    :page-size="pageSize"
    :page-size-options="PAGE_SIZES"
    :total-count="total"
    sorting="none"
    :frame="false"
    :loading="loading"
    :forbidden="forbidden"
    :error="loadError"
    :show-global-filter="false"
    :default-columns="false"
    :persist-columns="true"
    :enable-column-resize="true"
    table-id="autoresolve-runs"
    data-test="autoresolve-runs-table"
    @pagination-change="onPaginationChange"
    @row-click="openRun"
  >
    <template #toolbar>
      <div class="flex flex-1 flex-wrap items-center gap-2 max-md:contents">
        <OSearchInput
          v-model="search"
          class="min-w-0 flex-1 max-md:min-w-40 md:min-w-48"
          :placeholder="t('autoresolve.runs.search')"
          :debounce="300"
          clearable
          data-test="autoresolve-runs-search"
        />
        <OToggleGroup
          mobile-dropdown
          :model-value="stateGroup"
          data-test="autoresolve-runs-state"
          @update:model-value="(v) => (stateGroup = v as StateGroup)"
        >
          <OToggleGroupItem
            v-for="group in STATE_GROUP_OPTIONS"
            :key="group.value"
            :value="group.value"
            size="sm"
            :data-test="`autoresolve-runs-state-${group.value}`"
          >
            {{ group.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OSelect
          v-model="startedBy"
          :options="startedByOptions"
          :label="t('autoresolve.runs.startedBy')"
          label-position="inside"
          size="sm"
          width="sm"
          class="max-md:min-w-36 max-md:flex-1"
          data-test="autoresolve-runs-started-by"
        />
        <OSelect
          v-model="connection"
          :options="connectionOptions"
          :label="t('autoresolve.runs.connection')"
          label-position="inside"
          size="sm"
          width="sm"
          class="max-md:min-w-36 max-md:flex-1"
          data-test="autoresolve-runs-connection"
        />
        <div class="w-48 max-md:w-auto max-md:min-w-40 max-md:flex-1">
          <ODateTimeRange
            :mode="range.type"
            :relative-unit="range.type === 'relative' ? range.unit : undefined"
            :relative-amount="range.type === 'relative' ? range.amount : undefined"
            :start-date="range.type === 'absolute' ? range.startDate : undefined"
            :start-time="range.type === 'absolute' ? range.startTime : undefined"
            :end-date="range.type === 'absolute' ? range.endDate : undefined"
            :end-time="range.type === 'absolute' ? range.endTime : undefined"
            data-test="autoresolve-runs-range"
            @change="onRangeChange"
          />
        </div>
      </div>
    </template>
    <template #footer-note>
      <span data-test="autoresolve-home-region-note">{{ t("autoresolve.runs.regionNote") }}</span>
    </template>
    <template #toolbar-trailing>
      <ORefreshButton
        layout="inline"
        variant="outline"
        :last-run-at="lastUpdatedAt"
        :loading="fetching"
        data-test="autoresolve-runs-refresh"
        @click="refresh"
      />
    </template>
    <template #cell-created_at_us="{ row }">
      <OTimeCell :value="row.created_at_us" unit="us" :timezone="store.state.timezone" />
    </template>
    <template #cell-state="{ row }">
      <OTag type="autoresolveRunState" :value="shownRunState(row)" size="sm" />
    </template>
    <template #cell-requester="{ row }">
      <OUserCell v-if="row.trigger.kind === 'person'" :value="row.requester" />
      <OTruncatedText v-else>{{ startedByText(row.trigger, row.requester) }}</OTruncatedText>
    </template>
    <template #empty>
      <OEmptyState
        v-if="!loading"
        size="hero"
        preset="no-autoresolve-runs"
        :filtered="filtered"
        @action="onEmptyAction"
      />
    </template>
    <template #error="{ message }">
      <OEmptyState preset="load-error" :description="raw(message)" @action="refresh" />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type { DateTimeRangeValue } from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import {
  autoresolveErrorMessage,
  isForbidden,
  isTerminalRunState,
  type AutoResolveRunQuery,
  type AutoResolveRunRow,
  type AutoResolveRunState,
} from "@/services/autoresolve";
import { autoresolveRunsQuery, autoresolveSummaryQuery } from "@/services/autoresolve.queries";
import {
  autoresolveDuration,
  connectionsSentence,
  shownRunState,
  startedByText,
} from "@/utils/autoresolve/autoresolveText";

type StateGroup = "all" | "live" | "waiting" | "ended";

const props = withDefaults(
  defineProps<{
    org: string;
    compact?: boolean;
    /** Compact only: the last runs of this saved AutoResolve instead of the org's recent runs. */
    autoresolveId?: string;
  }>(),
  { compact: false, autoresolveId: undefined },
);

const emit = defineEmits<{ (e: "view-all"): void }>();

const PAGE_SIZES = [25, 50, 100];
const ANYONE = "anyone";
const ALL_CONNECTIONS = "all";
const COMPACT_ROWS = 5;
const SAVED_ROWS = 10;
const DAY_US = 86_400_000_000;
const UNIT_US = {
  seconds: 1_000_000,
  minutes: 60_000_000,
  hours: 3_600_000_000,
  days: DAY_US,
  weeks: 7 * DAY_US,
  months: 30 * DAY_US,
} as const;
const DEFAULT_RANGE = {
  type: "relative",
  unit: "days",
  amount: 7,
  timezone: "",
} as const satisfies DateTimeRangeValue;
const STATE_GROUPS: Record<StateGroup, AutoResolveRunState[] | undefined> = {
  all: undefined,
  live: ["investigating", "proceeding", "checking"],
  waiting: ["waiting_approval"],
  ended: [
    "worked",
    "no_change",
    "worse",
    "declined",
    "lapsed",
    "step_failed",
    "outcome_unknown",
    "failed",
  ],
};

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const STATE_GROUP_OPTIONS: { value: StateGroup; label: I18nText }[] = [
  { value: "all", label: t("common.all") },
  { value: "live", label: t("autoresolve.runs.stateGroup.live") },
  { value: "waiting", label: t("autoresolve.runs.stateGroup.waiting") },
  { value: "ended", label: t("autoresolve.runs.stateGroup.ended") },
];

const search = ref("");
const stateGroup = ref<StateGroup>("all");
const startedBy = ref<string>(ANYONE);
const connection = ref<string>(ALL_CONNECTIONS);
const range = ref<DateTimeRangeValue>({ ...DEFAULT_RANGE });
// A relative window starts from the last range change and stays open-ended, so new runs still show.
const anchorUs = ref(Date.now() * 1000);
const page = ref(1);
const pageSize = ref(PAGE_SIZES[0]);

const isDefaultRange = (r: DateTimeRangeValue) =>
  r.type === DEFAULT_RANGE.type &&
  r.unit === DEFAULT_RANGE.unit &&
  r.amount === DEFAULT_RANGE.amount;

const toUs = (date: string, time: string) =>
  new Date(`${date}T${time || "00:00"}`).getTime() * 1000;

const timeWindow = computed(() => {
  const r = range.value;
  if (r.type === "relative") {
    return { from: anchorUs.value - r.amount * UNIT_US[r.unit], to: undefined };
  }
  return { from: toUs(r.startDate, r.startTime), to: toUs(r.endDate, r.endTime) };
});

const runQuery = computed<AutoResolveRunQuery>(() =>
  props.compact
    ? props.autoresolveId
      ? { page: 1, page_size: SAVED_ROWS, autoresolve_id: props.autoresolveId }
      : { page: 1, page_size: COMPACT_ROWS }
    : {
        q: search.value.trim() || undefined,
        state: STATE_GROUPS[stateGroup.value],
        requester: startedBy.value === "me" ? store.state.userInfo?.email : undefined,
        connection: connection.value === ALL_CONNECTIONS ? undefined : connection.value,
        from_us: timeWindow.value.from,
        to_us: timeWindow.value.to,
        page: page.value,
        page_size: pageSize.value,
      },
);

const runsList = useQuery(() =>
  Object.assign(autoresolveRunsQuery(props.org, runQuery.value), { enabled: !!props.org }),
);
const summary = useQuery(() =>
  Object.assign(autoresolveSummaryQuery(props.org), { enabled: !!props.org && !props.compact }),
);

const rows = computed(() => runsList.data.value?.runs ?? []);
const total = computed(() => runsList.data.value?.total ?? 0);
const loading = runsList.isPending;
const fetching = runsList.isFetching;
const lastUpdatedAt = runsList.dataUpdatedAt;
const forbidden = computed(() => isForbidden(runsList.error.value));
const loadError = computed(() => {
  const e = runsList.error.value;
  if (!e || forbidden.value) return null;
  return autoresolveErrorMessage(e) ?? t("emptyState.loadError.description");
});

const filtered = computed(
  () =>
    !!search.value.trim() ||
    stateGroup.value !== "all" ||
    startedBy.value !== ANYONE ||
    connection.value !== ALL_CONNECTIONS ||
    !isDefaultRange(range.value),
);

watch([search, stateGroup, startedBy, connection, range], () => {
  page.value = 1;
});

const startedByOptions = computed(() => [
  { label: t("autoresolve.runs.anyone"), value: ANYONE },
  { label: t("autoresolve.runs.me"), value: "me" },
]);
const connectionOptions = computed(() => [
  { label: t("common.all"), value: ALL_CONNECTIONS },
  ...(summary.data.value?.connections ?? []).map((c) => ({ label: raw(c.name), value: c.id })),
]);

const took = (row: AutoResolveRunRow) => {
  if (isTerminalRunState(row.state)) {
    return row.ended_at_us ? autoresolveDuration(row.ended_at_us - row.created_at_us, t) : raw("—");
  }
  const now = (lastUpdatedAt.value || Date.now()) * 1000;
  return t("autoresolve.runs.tookSoFar", { time: autoresolveDuration(now - row.created_at_us, t) });
};

const runRoute = (row: AutoResolveRunRow) => ({
  name: "autoresolveRun",
  params: { id: row.id },
  query: { org_identifier: props.org },
});

const startedColumn: OTableColumnDef<AutoResolveRunRow> = {
  id: "created_at_us",
  header: t("autoresolve.runs.column.lastRun"),
  accessorKey: "created_at_us",
  size: 120,
};
const goalColumn: OTableColumnDef<AutoResolveRunRow> = {
  id: "goal",
  header: t("autoresolve.runs.column.goal"),
  accessorKey: "goal",
  size: 480,
  minSize: 200,
  meta: { isName: true, link: runRoute },
};
const stateColumn: OTableColumnDef<AutoResolveRunRow> = {
  id: "state",
  header: t("autoresolve.runs.column.state"),
  accessorKey: "state",
  size: 170,
};
const tookColumn: OTableColumnDef<AutoResolveRunRow> = {
  id: "took",
  header: t("autoresolve.runs.column.took"),
  accessorFn: took,
  size: 130,
  hideable: true,
  meta: { align: "right" },
};

const requesterColumn: OTableColumnDef<AutoResolveRunRow> = {
  id: "requester",
  header: t("autoresolve.runs.column.startedBy"),
  accessorKey: "requester",
  size: 200,
  hideable: true,
};

const columns: OTableColumnDef<AutoResolveRunRow>[] = [
  startedColumn,
  goalColumn,
  stateColumn,
  requesterColumn,
  {
    id: "connections",
    header: t("autoresolve.runs.column.connections"),
    accessorFn: (row) =>
      row.connections.length ? connectionsSentence(row.connections, t, 2) : raw("—"),
    size: 220,
    hideable: true,
  },
  tookColumn,
];
// The home column is narrow, so the goal takes what is left instead of a fixed width.
const compactColumns: OTableColumnDef<AutoResolveRunRow>[] = [
  startedColumn,
  {
    ...goalColumn,
    size: undefined,
    meta: { ...goalColumn.meta, autoWidth: true, fillRemaining: true },
  },
  stateColumn,
  tookColumn,
];

// One saved AutoResolve's runs share its goal, so who started each one takes the goal's place.
const savedColumns: OTableColumnDef<AutoResolveRunRow>[] = [
  startedColumn,
  stateColumn,
  { ...requesterColumn, size: undefined, meta: { autoWidth: true, fillRemaining: true } },
  tookColumn,
];

const openRun = (row: AutoResolveRunRow) => router.push(runRoute(row));

const onPaginationChange = (next: { page: number; size: number }) => {
  if (next.size !== pageSize.value) {
    pageSize.value = next.size;
    page.value = 1;
    return;
  }
  page.value = next.page;
};

const onRangeChange = (value: DateTimeRangeValue) => {
  anchorUs.value = Date.now() * 1000;
  range.value = value;
};

const refresh = () => {
  void runsList.refetch();
  if (!props.compact) void summary.refetch();
};

const onEmptyAction = (id?: string) => {
  if (id !== "clear-filters") return;
  search.value = "";
  stateGroup.value = "all";
  startedBy.value = ANYONE;
  connection.value = ALL_CONNECTIONS;
  anchorUs.value = Date.now() * 1000;
  range.value = { ...DEFAULT_RANGE };
};
</script>
