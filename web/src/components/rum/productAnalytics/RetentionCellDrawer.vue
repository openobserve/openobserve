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
  <ODrawer
    :open="open"
    size="lg"
    :title="title"
    :sub-title="subtitle"
    data-test="rum-analytics-retention-cell-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3">
      <OTag
        v-if="pa.usersUnit.value.partial"
        :label="pa.usersUnit.value.label"
        variant="teal-soft"
        icon="person"
        size="sm"
        class="self-start"
        data-test="rum-analytics-retention-drawer-identity"
      />
      <OTabs v-model="tab" align="left" dense>
        <OTab
          name="retained"
          :label="t('rum.analytics.retention.retained')"
          data-test="rum-analytics-retention-drawer-retained-tab"
        />
        <OTab
          name="lost"
          :label="t('rum.analytics.retention.notRetained')"
          data-test="rum-analytics-retention-drawer-lost-tab"
        />
      </OTabs>
      <span
        v-if="truncatedNote"
        class="text-text-secondary text-xs"
        data-test="rum-analytics-retention-users-truncated"
        >{{ truncatedNote }}</span
      >
      <AnalyticsPanelState
        :state="state"
        data-test="rum-analytics-retention-users"
        @retry="load(true)"
      >
        <OTable
          :data="rows"
          :columns="columns"
          :default-columns="false"
          row-key="u"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :frame="false"
        >
          <template #cell-u="{ row, index }">
            <span
              class="text-text-body truncate"
              :data-test="`rum-analytics-retention-user-${index}`"
              >{{ row.u }}</span
            >
          </template>
          <template #cell-last_seen="{ row }">
            <span class="text-text-secondary text-xs">{{ fmt(row.last_seen) }}</span>
          </template>
          <template #cell-actions="{ row, index }">
            <OButton
              variant="ghost"
              size="sm"
              icon-right="arrow-forward"
              :data-test="`rum-analytics-retention-user-${index}-sessions-btn`"
              @click="viewInSessions(row.u)"
              >{{ t("rum.analytics.retention.viewInSessions") }}</OButton
            >
          </template>
        </OTable>
      </AnalyticsPanelState>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch, { type PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/formatters";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";
import {
  formatCount,
  type NamedEvent,
  type RetentionPeriods,
} from "@/utils/rum/productAnalyticsModel";
import {
  retentionCellUsersSql,
  type RetentionDef,
  type RetentionMode,
} from "@/utils/rum/productAnalyticsQueries";

interface UserRow {
  u: string;
  retained: number;
  sessions: number;
  last_seen: number;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    cohort: number;
    k: number;
    def: RetentionDef;
    periods: RetentionPeriods;
    cohortLabel: string;
    periodLabel: I18nText;
    events?: NamedEvent[];
    retainedCount?: number | null;
    cohortSize?: number | null;
  }>(),
  { events: () => [], retainedCount: null, cohortSize: null },
);
const emit = defineEmits<{ "update:open": [boolean] }>();
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const pa = useProductAnalytics();
const runner = useAnalyticsSearch();
const tab = ref<"retained" | "lost">("retained");

const panels: Record<RetentionMode, ReturnType<typeof runner.panel<UserRow>>> = {
  on: runner.panel<UserRow>("cell-on"),
  after: runner.panel<UserRow>("cell-after"),
};

const state = computed<PanelState<unknown>>(() => panels[props.def.mode].value);
const all = computed(() => panels[props.def.mode].value.rows);
const rows = computed(() =>
  all.value.filter((r) => (Number(r.retained) === 1) === (tab.value === "retained")),
);
const ratio = computed(() => pa.sampleRatio.value);

const title = computed(() =>
  t("rum.analytics.retention.cellTitle", {
    cohort: raw(props.cohortLabel),
    period: props.periodLabel,
  }),
);
// The list keeps at most 200 per side, so the counts come from the grid cell that was clicked.
const counts = computed(() => {
  const listed = all.value.filter((r) => Number(r.retained) === 1).length;
  const retained = props.retainedCount ?? listed;
  const total = props.cohortSize ?? all.value.length;
  return { retained, total, lost: Math.max(0, total - retained) };
});

const subtitle = computed(() =>
  t("rum.analytics.retention.cellSubtitle", {
    retained: formatCount(counts.value.retained, ratio.value),
    total: formatCount(counts.value.total, ratio.value),
    unit: pa.usersUnit.value.noun,
  }),
);

const truncatedNote = computed(() => {
  if (state.value.status !== "ok") return null;
  const of = tab.value === "retained" ? counts.value.retained : counts.value.lost;
  return rows.value.length < of
    ? t("rum.analytics.retention.cellTruncated", {
        shown: rows.value.length,
        count: formatCount(of, ratio.value),
      })
    : null;
});

const fmt = (us: number) =>
  us
    ? formatInTimeZone(new Date(Number(us) / 1000), store.state.timezone || "UTC", "MMM d, HH:mm")
    : "";

const columns = computed<OTableColumnDef<UserRow>[]>(() => [
  {
    id: "u",
    header: pa.usersUnit.value.one,
    accessorKey: "u",
    size: 220,
    meta: { fillRemaining: true },
  },
  {
    id: "sessions",
    header: t("rum.analytics.columns.sessions"),
    accessorKey: "sessions",
    size: 90,
    meta: { align: "right" },
  },
  {
    id: "last_seen",
    header: t("rum.analytics.retention.lastSeen"),
    accessorKey: "last_seen",
    size: 140,
  },
  { id: "actions", header: raw(""), size: 170, isAction: true, meta: { align: "right" } },
]);

const loaded = new Map<RetentionMode, string>();

const runMode = async (mode: RetentionMode, force: boolean) => {
  const id = pa.identitySql.value;
  if (!id || !props.periods.boundariesUs.length) return;
  const key = `${pa.scopeKey.value}|${JSON.stringify({ ...props.def, mode })}|${props.cohort}|${props.k}`;
  if (!force && loaded.get(mode) === key) return;
  loaded.set(mode, key);
  const end = pa.resolveRange().endUs;
  await runner.run(
    `cell-${mode}`,
    {
      sql: retentionCellUsersSql(
        pa.scope.value,
        id,
        { ...props.def, mode },
        props.periods.boundariesUs,
        props.cohort,
        props.k,
        {
          events: props.events,
          sample: ratio.value,
        },
      ),
      startUs: props.periods.boundariesUs[0],
      endUs: end,
      limit: 400,
      sampled: ratio.value,
    },
    key,
  );
};

// The other mode is fetched right after, so switching On / On or after never waits on a search.
async function load(force = false) {
  if (!props.open) return;
  const other: RetentionMode = props.def.mode === "on" ? "after" : "on";
  await runMode(props.def.mode, force);
  void runMode(other, force);
}

const viewInSessions = (value: string) => {
  const field = pa.identitySql.value?.field;
  if (!field) return;
  const q = pa.toQuery();
  const query: Record<string, string> = {
    org_identifier: q.org_identifier as string,
    query: b64EncodeUnicode(sqlEquals(field, value)) ?? "",
  };
  if (q.period) query.period = q.period as string;
  else {
    query.from = q.from as string;
    query.to = q.to as string;
  }
  void router.push({ name: "Sessions", query });
};

watch(
  () => [props.open, props.cohort, props.k, props.def.start, props.def.ret],
  () => {
    tab.value = "retained";
    void load();
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => runner.abortAll());
</script>
