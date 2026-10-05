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
    data-test="rum-analytics-paths-branch-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-3">
      <OTag
        v-if="sampled > 1"
        :label="t('rum.analytics.sampled', { ratio: sampled })"
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
        data-test="rum-analytics-paths-branch-incomplete"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="sm"
            data-test="rum-analytics-paths-branch-incomplete-retry-btn"
            @click="load(true)"
            >{{ t("common.retry") }}</OButton
          >
        </template>
      </OBanner>
      <AnalyticsPanelState
        :state="panel"
        data-test="rum-analytics-paths-branch"
        @retry="load(true)"
      >
        <AnalyticsSessionsTable
          :rows="rows"
          :total="total"
          :step-label="title"
          :step-index="null"
          :loading-more="loadingMore"
          :load-more-failed="loadMoreFailed"
          :sampled="sampled"
          data-test-prefix="rum-analytics-paths-branch-sessions"
          @open="openSession"
          @load-more="loadMore"
        />
      </AnalyticsPanelState>
    </div>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="filter-alt"
          icon-right="arrow-forward"
          :disabled="!funnelSteps.length"
          data-test="rum-analytics-paths-branch-funnel-btn"
          @click="emit('build-funnel', funnelSteps)"
          >{{ t("rum.analytics.pathsView.buildFunnel") }}</OButton
        >
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="rum-analytics-paths-branch-close-btn"
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
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import AnalyticsSessionsTable, {
  type SessionRow,
} from "@/components/rum/productAnalytics/AnalyticsSessionsTable.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { pathStepLabel, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";
import {
  MAX_FUNNEL_STEPS,
  PAGE_LIMIT,
  branchSessionsSql,
  type PathsDef,
  type SampleRatio,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

const props = withDefaults(
  defineProps<{
    open: boolean;
    def: PathsDef;
    predicate: string;
    stepDepth: number;
    title: I18nText;
    expectedTotal: number | null;
    sampled?: SampleRatio;
    events?: NamedEvent[];
    pathKeys?: string[];
  }>(),
  { sampled: 1, events: () => [], pathKeys: () => [] },
);
const emit = defineEmits<{ "update:open": [boolean]; "build-funnel": [StepRef[]] }>();
const { t } = useI18nTyped();
const router = useRouter();
const pa = useProductAnalytics();
const runner = useAnalyticsSearch();

const panel = runner.panel<SessionRow>("branch");
const extra = ref<SessionRow[]>([]);
const loadingMore = ref(false);
const loadMoreFailed = ref(false);
const pageRuns = new Set<string>();
const incomplete = ref(false);
let retried = false;
let loadKey = "";

const rows = computed(() => [...panel.value.rows, ...extra.value]);
const total = computed(() => Number(panel.value.rows[0]?.total ?? 0));

const toStep = (k: string): StepRef => ({ kind: k.startsWith("c:") ? "c" : "p", key: k.slice(2) });

const funnelSteps = computed<StepRef[]>(() => {
  const keys = props.pathKeys.filter((k) => /^[pc]:/.test(k)).map(toStep);
  const anchor = props.def.anchor && props.def.anchor.kind !== "e" ? [props.def.anchor] : [];
  const ordered =
    props.def.direction === "next" ? [...anchor, ...keys] : [...keys.reverse(), ...anchor];
  return ordered.slice(0, MAX_FUNNEL_STEPS);
});

const opts = () => ({ events: props.events, sample: props.sampled });

async function load(force = false, resetRetry = true) {
  if (!props.open || !props.predicate) return;
  const cur = pa.resolveRange();
  const key = `${pa.scopeKey.value}|${JSON.stringify(props.def)}|${props.predicate}|${props.stepDepth}|${props.sampled}`;
  if (!force && key === loadKey) return;
  if (resetRetry) retried = false;
  loadKey = key;
  incomplete.value = false;
  extra.value = [];
  loadingMore.value = false;
  loadMoreFailed.value = false;
  for (const id of pageRuns) runner.hold(id, "idle");
  pageRuns.clear();
  const res = await runner.run<SessionRow>(
    "branch",
    {
      sql: branchSessionsSql(
        pa.scope.value,
        pa.identitySql.value,
        props.def,
        props.predicate,
        props.stepDepth,
        0,
        opts(),
      ),
      ...cur,
      limit: PAGE_LIMIT,
      sampled: props.sampled,
    },
    key,
  );
  // Exact runs must match the clicked branch; a mismatch re-runs once before it is shown as incomplete.
  if (
    res.status !== "ok" ||
    props.sampled > 1 ||
    props.expectedTotal === null ||
    total.value === props.expectedTotal
  )
    return;
  if (!retried) {
    retried = true;
    await load(true, false);
    return;
  }
  incomplete.value = true;
}

const loadMore = async () => {
  const key = loadKey;
  loadingMore.value = true;
  loadMoreFailed.value = false;
  try {
    const page = Math.ceil(rows.value.length / PAGE_LIMIT);
    const cur = pa.resolveRange();
    pageRuns.add(`branch-${page}`);
    const res = await runner.run<SessionRow>(
      `branch-${page}`,
      {
        sql: branchSessionsSql(
          pa.scope.value,
          pa.identitySql.value,
          props.def,
          props.predicate,
          props.stepDepth,
          page,
          opts(),
        ),
        ...cur,
        limit: PAGE_LIMIT,
        sampled: props.sampled,
      },
      `${loadKey}|${page}`,
    );
    // A page of the branch shown before belongs to that branch, not the one open now.
    if (key !== loadKey) return;
    if (res.status === "ok") extra.value = [...extra.value, ...res.rows];
    else if (res.status === "error" || res.status === "forbidden") loadMoreFailed.value = true;
  } finally {
    if (key === loadKey) loadingMore.value = false;
  }
};

const openSession = (row: SessionRow) => {
  const at = Number(row.step_t);
  const last = props.pathKeys.filter(Boolean).at(-1);
  const anchor = props.def.anchor;
  const label = last
    ? pathStepLabel(last, props.events)
    : anchor
      ? stepLabel(anchor, props.events)
      : "";
  const kind = last ? last.slice(0, 1) : (props.def.anchor?.kind ?? "p");
  void router.push({
    name: "SessionViewer",
    params: { id: row.sid },
    query: {
      start_time: String(at * 1000),
      end_time: String(at * 1000),
      event_time: String(at),
      from: "analytics",
      af_label: label,
      af_kind: kind,
      org_identifier: pa.toQuery().org_identifier as string,
    },
  });
};

watch(
  () => [props.open, props.predicate, props.stepDepth, props.def, props.sampled],
  () => {
    void load();
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => runner.abortAll());
</script>
