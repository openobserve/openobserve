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
  <div class="px-page-edge flex flex-col gap-3 py-3" data-test="rum-analytics-retention">
    <RetentionUnlock
      v-if="pa.scopeStatus.value === 'ok' && !identitySql"
      :unidentified-sessions="
        pa.identity.value?.unidentifiedSessions ?? pa.summary.value?.sessions ?? 0
      "
      :reason="pa.identityGapText.value ?? t('rum.analytics.identity.absent')"
    />
    <OCard v-else variant="outlined" class="rounded-surface flex flex-col">
      <div class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span
          class="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          data-test="rum-analytics-retention-identity"
        >
          <OTag
            :label="
              t('rum.analytics.retention.identifiedBy', {
                unit: pa.usersUnit.value.label,
                field: raw(identitySql?.field ?? ''),
              })
            "
            variant="teal-soft"
            icon="person"
            size="sm"
          />
          <span class="text-text-secondary text-xs">{{
            t("rum.analytics.retention.coverage", {
              pct: ((pa.identity.value?.coverage ?? 0) * 100).toFixed(1),
              users: addCommasToNumber(pa.identity.value?.users ?? 0),
              unit: pa.usersUnit.value.noun,
              unidentified: addCommasToNumber(pa.identity.value?.unidentifiedSessions ?? 0),
            })
          }}</span>
        </span>
        <span class="w-60 max-md:w-full">
          <StepPicker
            :model-value="def.start"
            :placeholder="t('rum.analytics.retention.anyActivityStart')"
            :events="events"
            clearable
            data-test="rum-analytics-retention-start-select"
            @update:model-value="(s) => update({ start: s })"
          />
        </span>
        <span class="w-60 max-md:w-full">
          <StepPicker
            :model-value="def.ret"
            :placeholder="t('rum.analytics.retention.anyActivityReturn')"
            :events="events"
            clearable
            data-test="rum-analytics-retention-return-select"
            @update:model-value="(s) => update({ ret: s })"
          />
        </span>
        <OSelect
          :model-value="def.per"
          :options="perOptions"
          size="sm"
          class="w-48"
          data-test="rum-analytics-retention-granularity"
          @update:model-value="(v) => update({ per: v as Granularity })"
        />
        <OToggleGroup
          :model-value="def.mode"
          type="single"
          data-test="rum-analytics-retention-mode"
          @update:model-value="(v) => v && update({ mode: v as RetentionMode })"
        >
          <OToggleGroupItem
            value="on"
            size="xs"
            :tooltip="t('rum.analytics.retention.modeOnTooltip')"
            data-test="rum-analytics-retention-mode-on"
            >{{ t("rum.analytics.retention.modeOn") }}</OToggleGroupItem
          >
          <OToggleGroupItem
            value="after"
            size="xs"
            :tooltip="t('rum.analytics.retention.modeAfterTooltip')"
            data-test="rum-analytics-retention-mode-after"
            >{{ t("rum.analytics.retention.modeAfter") }}</OToggleGroupItem
          >
        </OToggleGroup>
      </div>
      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-text-secondary text-xs">{{
          t("rum.analytics.retention.cohortCaption")
        }}</span>
        <OBanner
          v-if="periods && periods.clipped && periods.dataStartUs"
          variant="info"
          dense
          :content="t('rum.analytics.retention.dataStart', { date: fmtDate(periods.dataStartUs) })"
          data-test="rum-analytics-retention-data-start"
        />
        <OEmptyState
          v-if="periodState === 'tooShort' || periodState === 'tooMany'"
          preset="no-search-results"
          size="block"
          :title="
            periodState === 'tooShort'
              ? t('rum.analytics.retention.tooShort')
              : t('rum.analytics.retention.tooMany')
          "
          :data-test="
            periodState === 'tooShort'
              ? 'rum-analytics-retention-too-short'
              : 'rum-analytics-retention-too-many'
          "
        >
          <template #actions>
            <OButton
              v-if="periodState === 'tooShort'"
              variant="outline"
              size="md"
              data-test="rum-analytics-retention-widen-range-btn"
              @click="widenRange"
              >{{ t("rum.analytics.overview.widenRange") }}</OButton
            >
          </template>
        </OEmptyState>
        <NamedEventsNotice
          v-else-if="eventsBlocked"
          :status="eventsStatus"
          data-test="rum-analytics-retention"
          @retry="pa.retryEvents()"
        />
        <AnalyticsPanelState
          v-else
          :state="gridPanel"
          data-test="rum-analytics-retention"
          :skeleton-rows="6"
          @retry="compute(true)"
        >
          <RetentionGrid
            v-if="grid && periods"
            :grid="grid"
            :granularity="periods.granularity"
            :mode="def.mode"
            :sampled="ratio"
            :unit="pa.usersUnit.value.noun"
            @cell="openCell"
          />
          <span class="text-text-secondary mt-2 block text-xs">{{
            t("rum.analytics.retention.legend", { tz: raw(timezone) })
          }}</span>
          <span
            class="text-text-body mt-1 block text-xs"
            data-test="rum-analytics-retention-cell-hint"
            >{{ t("rum.analytics.retention.cellHint") }}</span
          >
        </AnalyticsPanelState>
      </div>
    </OCard>
    <RetentionCellDrawer
      v-if="cell && periods"
      :open="!!cell"
      :cohort="cell.cohort"
      :k="cell.k"
      :def="def"
      :periods="periods"
      :cohort-label="cellCohortLabel"
      :period-label="cellPeriodLabel"
      :events="events"
      :retained-count="cellCounts?.users ?? null"
      :cohort-size="cellCounts?.size ?? null"
      @update:open="(v) => !v && (cell = null)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import RetentionGrid from "@/components/rum/productAnalytics/RetentionGrid.vue";
import RetentionCellDrawer from "@/components/rum/productAnalytics/RetentionCellDrawer.vue";
import RetentionUnlock from "@/components/rum/productAnalytics/RetentionUnlock.vue";
import NamedEventsNotice from "@/components/rum/productAnalytics/NamedEventsNotice.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  granularityOptions,
  retentionPeriods,
  toRetentionGrid,
  type NamedEvent,
  type RetentionGrid as Grid,
  type RetentionPeriods,
} from "@/utils/rum/productAnalyticsModel";
import {
  retentionSql,
  type Granularity,
  type RetentionDef,
  type RetentionMode,
  type SampleRatio,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "AnalyticsRetention" });

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const pa = useProductAnalytics();
const runner = useAnalyticsSearch();
const { identitySql } = pa;

const gridPanel = runner.panel<Record<string, number | null>>("retention");
const namedEvents = useNamedEvents();
const events = computed<NamedEvent[]>(() => [...namedEvents.events.value]);
const cell = ref<{ cohort: number; k: number } | null>(null);
let lastKey = "";
let active = true;
let activatedOnce = false;

const def = computed(() => pa.retention.value);
const usesEvents = computed(() => def.value.start?.kind === "e" || def.value.ret?.kind === "e");
const eventsStatus = computed(() => (usesEvents.value ? pa.eventsStatus.value : "ready"));
const eventsBlocked = computed(
  () => eventsStatus.value === "failed" || eventsStatus.value === "forbidden",
);
const timezone = computed(() => store.state.timezone || "UTC");
const ratio = computed<SampleRatio>(() => pa.sampleRatio.value);

const periodsResult = computed(() => {
  const r = pa.range.value;
  if (!r) return null;
  return retentionPeriods(
    r.startUs,
    r.endUs,
    timezone.value,
    Date.now() * 1000,
    pa.dataStartUs.value,
    def.value.per,
  );
});

const periods = computed<RetentionPeriods | null>(() => {
  const p = periodsResult.value;
  return p && "boundariesUs" in p ? p : null;
});

const periodState = computed(() => {
  const p = periodsResult.value;
  if (!p) return "pending";
  if ("tooShort" in p) return "tooShort";
  if ("tooMany" in p) return "tooMany";
  return "ok";
});

const grid = computed<Grid | null>(() =>
  gridPanel.value.status === "ok" && periods.value
    ? toRetentionGrid(gridPanel.value.rows, periods.value, timezone.value, def.value.mode)
    : null,
);

const perLabels = computed<Record<Granularity, I18nText>>(() => ({
  auto: t("rum.analytics.retention.perAuto"),
  day: t("rum.analytics.retention.perDay"),
  week: t("rum.analytics.retention.perWeek"),
  month: t("rum.analytics.retention.perMonth"),
}));

const reasonText = (reason: string | null): I18nText | null => {
  if (!reason) return null;
  if (reason.startsWith("dataDays:"))
    return t("rum.analytics.retention.onlyDays", { n: Number(reason.slice(9)) });
  return reason === "tooMany"
    ? t("rum.analytics.retention.reasonTooMany")
    : t("rum.analytics.retention.reasonTooFew");
};

const perOptions = computed(() => {
  const r = pa.range.value;
  if (!r) return [];
  return granularityOptions(r.startUs, r.endUs, timezone.value, pa.dataStartUs.value).map((o) => {
    const why = reasonText(o.reason);
    return {
      label: why
        ? t("rum.analytics.retention.perDisabled", { label: perLabels.value[o.value], reason: why })
        : perLabels.value[o.value],
      value: o.value,
      disabled: o.disabled,
    };
  });
});

const fmtDate = (us: number) =>
  formatInTimeZone(new Date(us / 1000), timezone.value, "MMM d, yyyy");

const cellCohortLabel = computed(
  () => grid.value?.rows.find((r) => r.cohort === cell.value?.cohort)?.label ?? "",
);
const cellPeriodLabel = computed(() => {
  const k = cell.value?.k ?? 0;
  const g = periods.value?.granularity ?? "day";
  return g === "day"
    ? t("rum.analytics.retention.dayN", { n: k })
    : g === "week"
      ? t("rum.analytics.retention.weekN", { n: k })
      : t("rum.analytics.retention.monthN", { n: k });
});

const update = (patch: Partial<RetentionDef>) => {
  pa.retention.value = { ...def.value, ...patch };
};

const widenRange = () => pa.widenRange(router);

const cellCounts = computed(() => {
  const c = cell.value;
  const row = c ? grid.value?.rows.find((r) => r.cohort === c.cohort) : null;
  const users = c ? row?.cells[c.k]?.users : undefined;
  return row && users !== undefined ? { users, size: row.size } : null;
});

const openCell = (c: { cohort: number; k: number }) => {
  cell.value = c;
};

const hold = (status: "idle" | "loading") => {
  lastKey = "";
  cell.value = null;
  runner.hold("retention", status);
};

// The mode only re-reads the same result, so it is left out of the key and never re-queries.
const compute = async (force = false) => {
  await pa.loadScope();
  if (pa.scopeStatus.value !== "ok" || !pa.state.app) return;
  await pa.loadDataStart();
  void pa.syncUrl(router);
  if (eventsStatus.value === "loading") hold("loading");
  const gate = await pa.eventsGate(() => usesEvents.value);
  if (!active) return;
  if (gate !== "ready") {
    hold(gate === "loading" ? "loading" : "idle");
    return;
  }
  const id = identitySql.value;
  const p = periods.value;
  if (!id || !p) return;
  const rulesOf = (s: typeof def.value.start) =>
    s?.kind === "e" ? (events.value.find((e) => e.id === s.key)?.rules ?? null) : null;
  const shape = [
    def.value.start,
    def.value.ret,
    def.value.per,
    rulesOf(def.value.start),
    rulesOf(def.value.ret),
  ];
  const key = `${pa.scopeKey.value}|${id.excluded.length}|${JSON.stringify(shape)}|${p.boundariesUs.join(",")}|${ratio.value}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  cell.value = null;
  const end = pa.resolveRange().endUs;
  await runner.run(
    "retention",
    {
      sql: retentionSql(pa.scope.value, id, def.value, p.boundariesUs, {
        events: events.value,
        sample: ratio.value,
      }),
      startUs: p.boundariesUs[0],
      endUs: end,
      limit: (p.boundariesUs.length * (p.boundariesUs.length + 1)) / 2,
      sampled: ratio.value,
    },
    key,
  );
};

watch(
  () => [
    def.value,
    pa.scopeKey.value,
    identitySql.value?.excluded.length,
    pa.dataStartUs.value,
    namedEvents.events.value,
    pa.eventsStatus.value,
  ],
  () => {
    if (active) void compute();
  },
  { deep: true },
);

watch(
  () => pa.refreshTick.value,
  () => {
    if (active) void compute(true);
  },
);

onMounted(() => {
  void compute();
});

onActivated(() => {
  active = true;
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  void runner.rerunAborted();
  void compute();
});

onDeactivated(() => {
  active = false;
  runner.abortAll();
});

onBeforeUnmount(() => runner.abortAll());
</script>
