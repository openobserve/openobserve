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
    data-test="rum-analytics-dropoff-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-5">
      <OTag
        v-if="users && pa.usersUnit.value.partial"
        :label="pa.usersUnit.value.label"
        variant="teal-soft"
        icon="person"
        size="sm"
        class="self-start"
        data-test="rum-analytics-dropoff-identity"
      />
      <OTag
        v-if="ratio > 1"
        :label="t('rum.analytics.sampled', { ratio })"
        variant="info-outline"
        icon="filter-alt"
        size="sm"
        class="self-start"
      />
      <OBanner
        v-if="incomplete"
        variant="warning"
        dense
        :content="t('rum.analytics.dropoff.incomplete')"
        data-test="rum-analytics-dropoff-incomplete"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="sm"
            data-test="rum-analytics-dropoff-incomplete-retry-btn"
            @click="load(true)"
            >{{ t("common.retry") }}</OButton
          >
        </template>
      </OBanner>

      <section class="flex flex-col gap-2" data-test="rum-analytics-dropoff-next-events">
        <div class="flex items-baseline gap-2">
          <span class="text-text-heading text-sm font-semibold">{{
            t("rum.analytics.dropoff.instead")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            t("rum.analytics.dropoff.insteadCaption", { unit: unitNoun })
          }}</span>
        </div>
        <AnalyticsPanelState
          :state="nextPanel"
          data-test="rum-analytics-dropoff-next"
          @retry="runner.retry('next')"
        >
          <div
            v-for="(row, i) in nextRows"
            :key="i"
            class="border-border-default grid grid-cols-[4.5rem_minmax(0,1fr)_4rem_8rem] items-center gap-3 border-b py-1.5 text-sm"
            :data-test="`rum-analytics-dropoff-next-row-${i}`"
          >
            <OTag
              :label="row.tag"
              :variant="row.variant"
              size="xs"
              :icon="row.exit ? 'exit-to-app' : ''"
            />
            <span class="text-text-body truncate font-mono text-xs"
              >{{ row.label }}<OTooltip :content="raw(row.label)"
            /></span>
            <span class="text-end tabular-nums">{{ formatCount(row.units, ratio) }}</span>
            <span class="flex items-center gap-2">
              <span class="w-12 text-end text-xs tabular-nums">{{ pct(row.share) }}</span>
              <OProgressBar :value="row.share" size="sm" class="flex-1" />
            </span>
          </div>
        </AnalyticsPanelState>
      </section>

      <section class="flex flex-col gap-2" data-test="rum-analytics-dropoff-compare">
        <div class="flex items-baseline gap-2">
          <span class="text-text-heading text-sm font-semibold">{{
            t("rum.analytics.dropoff.health")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            t("rum.analytics.dropoff.healthCaption")
          }}</span>
        </div>
        <AnalyticsPanelState
          :state="healthPanel"
          data-test="rum-analytics-dropoff-health"
          @retry="runner.retry('health')"
        >
          <div
            v-for="bar in healthBars"
            :key="bar.id"
            class="grid grid-cols-[10rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm"
            :data-test="`rum-analytics-dropoff-${bar.id}`"
          >
            <span class="text-text-secondary">{{ bar.label }}</span>
            <OProgressBar
              :value="bar.value"
              size="sm"
              :variant="bar.dropped ? 'warning' : 'success'"
            />
            <span class="text-end font-semibold tabular-nums">{{ pct(bar.value) }}</span>
          </div>
          <span v-if="noDifference" class="text-text-secondary text-xs">{{
            t("rum.analytics.dropoff.noDifference")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            windowMs
              ? t("rum.analytics.dropoff.definitionWindow", { unit: unitNoun })
              : t("rum.analytics.dropoff.definitionSession", { unit: unitNoun })
          }}</span>
        </AnalyticsPanelState>
      </section>

      <section class="flex flex-col gap-2">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.dropoff.sessions")
        }}</span>
        <AnalyticsPanelState
          :state="sessionsPanel"
          data-test="rum-analytics-dropoff-sessions-panel"
          @retry="load(true)"
        >
          <AnalyticsSessionsTable
            :rows="sessionRows"
            :total="sessionsTotal"
            :step-label="stepKey"
            :step-index="cohort.stepIndex"
            :loading-more="loadingMore"
            :load-more-failed="loadMoreFailed"
            :sampled="ratio"
            data-test-prefix="rum-analytics-dropoff-sessions"
            @open="openSession"
            @load-more="loadMore"
          />
        </AnalyticsPanelState>
      </section>
    </div>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="account-tree"
          icon-right="arrow-forward"
          data-test="rum-analytics-dropoff-paths-btn"
          @click="emit('paths', cohort)"
          >{{ t("rum.analytics.dropoff.seePaths") }}</OButton
        >
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="rum-analytics-dropoff-close-btn"
          @click="emit('update:open', false)"
          >{{ t("rum.analytics.dropoff.close") }}</OButton
        >
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import AnalyticsSessionsTable, {
  type SessionRow,
} from "@/components/rum/productAnalytics/AnalyticsSessionsTable.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, type NamedEvent, formatPct as pct } from "@/utils/rum/productAnalyticsModel";
import {
  PAGE_LIMIT,
  WINDOW_MS,
  cohortSessionsSql,
  dropoffHealthSql,
  dropoffNextSql,
  type FunnelCohort,
  type SampleRatio,
} from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

interface NextRow {
  tag: I18nText;
  variant: BadgeVariant;
  label: string;
  units: number;
  share: number;
  exit: boolean;
}
interface HealthRow {
  side: string;
  units: number;
  sessions: number;
  with_error: number;
  with_frustration: number;
}

const SAME_POINT = 0.01;
const LISTED_NEXT = 5;

const props = withDefaults(
  defineProps<{
    open: boolean;
    cohort: FunnelCohort;
    sampled: SampleRatio;
    expectedDropped?: number | null;
    events?: NamedEvent[];
  }>(),
  { expectedDropped: null, events: () => [] },
);
const emit = defineEmits<{ "update:open": [boolean]; paths: [FunnelCohort] }>();
const { t } = useI18nTyped();
const router = useRouter();
const pa = useProductAnalytics();
const runner = useAnalyticsSearch();

const nextPanel = runner.panel<{
  is_next: number;
  kind: string | null;
  k: string | null;
  units: number;
}>("next");
const healthPanel = runner.panel<HealthRow>("health");
const sessionsPanel = runner.panel<SessionRow>("sessions");
const extraRows = ref<SessionRow[]>([]);
const loadingMore = ref(false);
const loadMoreFailed = ref(false);
const pageRuns = new Set<string>();
const incomplete = ref(false);
let retried = false;
let loadKey = "";

const users = computed(() => props.cohort.funnel.unit === "users" && !!pa.identitySql.value);
const ratio = computed<SampleRatio>(() => (users.value ? 1 : props.sampled));
const windowMs = computed(() =>
  users.value && props.cohort.funnel.window !== "session"
    ? WINDOW_MS[props.cohort.funnel.window]
    : null,
);
const unitNoun = computed(() =>
  users.value ? pa.usersUnit.value.noun : t("rum.analytics.funnel.sessionNoun"),
);
const step = computed(() => props.cohort.funnel.steps[props.cohort.stepIndex - 1]);
const stepKey = computed(() => (step.value ? stepLabel(step.value, props.events) : ""));
const nextKey = computed(() => {
  const s = props.cohort.funnel.steps[props.cohort.stepIndex];
  return s ? stepLabel(s, props.events) : "";
});

const dropped = computed(() => healthPanel.value.rows.find((r) => r.side === "dropped"));
const converted = computed(() => healthPanel.value.rows.find((r) => r.side === "converted"));
// The funnel's count and this drawer's are both raw sample counts, scaled only when shown.
const droppedUnits = computed(() =>
  dropped.value ? Number(dropped.value.units) : (props.expectedDropped ?? 0),
);

// The title repeats the funnel row's own figure, so a separately sampled count never contradicts it.
const title = computed(() => {
  const n = props.expectedDropped ?? droppedUnits.value;
  const count = formatCount(n, ratio.value);
  const step = props.cohort.stepIndex;
  return users.value
    ? t("rum.analytics.dropoff.title", { count, unit: unitNoun.value, step })
    : t("rum.analytics.dropoff.titleSessions", { count, step }, Math.round(n * ratio.value));
});
const subtitle = computed(() =>
  t("rum.analytics.dropoff.subtitle", { step: raw(stepKey.value), next: raw(nextKey.value) }),
);

const kindTag = (kind: string | null): { tag: I18nText; variant: BadgeVariant } =>
  kind === "c"
    ? { tag: t("rum.analytics.kind.click"), variant: "teal-soft" }
    : { tag: t("rum.analytics.kind.page"), variant: "blue-soft" };

const nextRows = computed<NextRow[]>(() => {
  const total = droppedUnits.value;
  const share = (n: number) => (total > 0 ? n / total : 0);
  const rows: NextRow[] = nextPanel.value.rows.slice(0, LISTED_NEXT + 1).map((r) => {
    const exit = Number(r.is_next) === 0;
    const units = Number(r.units);
    return exit
      ? {
          tag: t("rum.analytics.dropoff.exit"),
          variant: "default-outline",
          label: t("rum.analytics.dropoff.leftApp"),
          units,
          share: share(units),
          exit,
        }
      : { ...kindTag(r.kind), label: String(r.k), units, share: share(units), exit };
  });
  const listed = rows.reduce((a, r) => a + r.units, 0);
  if (nextPanel.value.status === "ok" && total - listed > 0) {
    rows.push({
      tag: t("rum.analytics.funnel.other"),
      variant: "default-soft",
      label: t("rum.analytics.funnel.other"),
      units: total - listed,
      share: share(total - listed),
      exit: false,
    });
  }
  return rows;
});

const rate = (r: HealthRow | undefined, field: "with_error" | "with_frustration") =>
  r && Number(r.units) > 0 ? Number(r[field]) / Number(r.units) : 0;

const hasFrustration = computed(() => !!pa.schema.value.action_frustration_type);

const healthBars = computed(() => {
  const bars = [
    {
      id: "error-dropped",
      label: t("rum.analytics.dropoff.errorDropped"),
      value: rate(dropped.value, "with_error"),
      dropped: true,
    },
    {
      id: "error-converted",
      label: t("rum.analytics.dropoff.errorConverted"),
      value: rate(converted.value, "with_error"),
      dropped: false,
    },
  ];
  if (hasFrustration.value) {
    bars.push(
      {
        id: "frustration-dropped",
        label: t("rum.analytics.dropoff.frustrationDropped"),
        value: rate(dropped.value, "with_frustration"),
        dropped: true,
      },
      {
        id: "frustration-converted",
        label: t("rum.analytics.dropoff.frustrationConverted"),
        value: rate(converted.value, "with_frustration"),
        dropped: false,
      },
    );
  }
  return bars;
});

const noDifference = computed(
  () =>
    healthPanel.value.status === "ok" &&
    Math.abs(rate(dropped.value, "with_error") - rate(converted.value, "with_error")) <
      SAME_POINT &&
    (!hasFrustration.value ||
      Math.abs(
        rate(dropped.value, "with_frustration") - rate(converted.value, "with_frustration"),
      ) < SAME_POINT),
);

const sessionRows = computed(() => [...sessionsPanel.value.rows, ...extraRows.value]);
const sessionsTotal = computed(() => Number(sessionsPanel.value.rows[0]?.total ?? 0));

const opts = () => ({ events: props.events, sample: ratio.value });

// Exact runs must agree with the funnel; a mismatch re-runs once before it is shown as incomplete.
const checkInvariant = async () => {
  if (ratio.value > 1 || props.expectedDropped === null || props.expectedDropped === undefined)
    return;
  const units = dropped.value ? Number(dropped.value.units) : 0;
  const expectedTotal = users.value ? Number(dropped.value?.sessions ?? 0) : props.expectedDropped;
  const ok = units === props.expectedDropped && sessionsTotal.value === expectedTotal;
  if (ok) {
    incomplete.value = false;
    return;
  }
  if (!retried) {
    retried = true;
    await load(true, false);
    return;
  }
  incomplete.value = true;
};

async function load(force = false, resetRetry = true) {
  if (!props.open || !props.cohort) return;
  const cur = pa.resolveRange();
  const key = `${pa.scopeKey.value}|${JSON.stringify(props.cohort)}|${ratio.value}`;
  if (!force && key === loadKey) return;
  loadKey = key;
  if (resetRetry) retried = false;
  incomplete.value = false;
  extraRows.value = [];
  loadingMore.value = false;
  loadMoreFailed.value = false;
  for (const id of pageRuns) runner.hold(id, "idle");
  pageRuns.clear();
  const scope = pa.scope.value;
  const id = pa.identitySql.value;
  const spec = (sql: string, limit: number) => ({ sql, ...cur, limit, sampled: ratio.value });
  await Promise.all([
    runner.run("next", spec(dropoffNextSql(scope, id, props.cohort, opts()), 6), key),
    runner.run(
      "health",
      spec(dropoffHealthSql(scope, id, props.cohort.funnel, props.cohort.stepIndex, opts()), 2),
      key,
    ),
    runner.run(
      "sessions",
      spec(cohortSessionsSql(scope, id, props.cohort, 0, opts()), PAGE_LIMIT),
      key,
    ),
  ]);
  if (loadKey === key && healthPanel.value.status === "ok" && sessionsPanel.value.status === "ok")
    await checkInvariant();
}

const loadMore = async () => {
  const key = loadKey;
  loadingMore.value = true;
  loadMoreFailed.value = false;
  try {
    const page = Math.ceil(sessionRows.value.length / PAGE_LIMIT);
    const cur = pa.resolveRange();
    pageRuns.add(`sessions-${page}`);
    const res = await runner.run<SessionRow>(
      `sessions-${page}`,
      {
        sql: cohortSessionsSql(pa.scope.value, pa.identitySql.value, props.cohort, page, opts()),
        ...cur,
        limit: PAGE_LIMIT,
        sampled: ratio.value,
      },
      `${loadKey}|${page}`,
    );
    // A page for a list since reloaded belongs to that old list, not this one.
    if (key !== loadKey) return;
    if (res.status === "ok") extraRows.value = [...extraRows.value, ...res.rows];
    else if (res.status === "error" || res.status === "forbidden") loadMoreFailed.value = true;
  } finally {
    if (key === loadKey) loadingMore.value = false;
  }
};

const openSession = (row: SessionRow) => {
  const at = Number(row.step_t);
  void router.push({
    name: "SessionViewer",
    params: { id: row.sid },
    query: {
      start_time: String(at * 1000),
      end_time: String(at * 1000),
      event_time: String(at),
      from: "analytics",
      af_step: String(props.cohort.stepIndex),
      af_label: stepKey.value,
      af_kind: step.value?.kind ?? "p",
      org_identifier: pa.toQuery().org_identifier as string,
    },
  });
};

watch(
  () => [props.open, props.cohort, props.sampled],
  () => {
    void load();
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => runner.abortAll());

defineExpose({ load });
</script>
