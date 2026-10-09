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
  <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-test="quality-page">
    <!-- With a config open the page header is the detail header, as on the other detail pages. -->
    <OPageHeader
      class="border-border-default shrink-0 border-b"
      :title="header.title"
      :subtitle="header.subtitle"
      :icon="configId ? undefined : 'star-rate'"
      :back="
        configId
          ? {
              label: t('onlineEvals.quality.detail.back'),
              onClick: closeConfig,
              dataTest: 'quality-detail-back',
            }
          : undefined
      "
      title-data-test="quality-page-title"
    >
      <template v-if="configId" #title-trail>
        <div class="flex shrink-0 items-center gap-1.5" data-test="quality-detail-tags">
          <OTag v-if="header.dataType" type="evalDataType" :value="header.dataType" />
          <OTag
            v-if="header.version != null"
            variant="default-soft"
            shape="rounded"
            :label="raw(`v${header.version}`)"
          />
        </div>
      </template>
      <template #actions>
        <OButton
          v-if="configId"
          variant="outline"
          size="sm"
          data-test="quality-detail-edit-config"
          @click="openEditConfig"
        >
          {{ t("onlineEvals.quality.detail.editConfig") }}
        </OButton>
        <slot name="header-actions" />
      </template>
    </OPageHeader>

    <section
      class="bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden"
      data-test="quality-body"
    >
      <!-- Env, Agent and Version scope the list and the detail alike; the detail adds its scope toggle. -->
      <div
        class="px-page-edge flex shrink-0 flex-wrap items-center gap-2 py-2"
        data-test="quality-scope-bar"
      >
        <slot name="filters" />
        <OToggleGroup
          v-if="configId && scopeOptions.length > 2"
          :model-value="scope"
          mobile-dropdown
          class="ms-auto"
          data-test="quality-detail-scope"
          @update:model-value="
            (value) => updateQuery({ scope: value === 'all' ? undefined : (value as string) })
          "
        >
          <OToggleGroupItem
            v-for="option in scopeOptions"
            :key="option.value"
            :value="option.value"
            size="sm"
            :data-test="`quality-detail-scope-${option.value}`"
          >
            {{ option.label }}
            <span class="font-semibold tabular-nums">{{ option.count }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
      <QualityConfigDetail
        v-if="configId"
        :config-id="configId"
        :row="selectedRow"
        :config="selectedConfig"
        :scope="scope"
        :only="only"
        :date-window="dateWindow"
        :agent-params="agentParams"
        :enabled="enabled"
        :initial-page="restoredPage"
        :initial-score-id="restoredScoreId"
        @back="closeConfig"
        @update:only="(value) => updateQuery({ only: value === 'all' ? undefined : value })"
        @status="(status) => (detailStatus = status)"
        @position="updatePosition"
      />
      <QualityConfigsTable
        v-else
        v-model:tile-filter="tileFilter"
        :rows="visibleRows"
        :tiles="tiles"
        :failed-runs="failedRuns"
        :loading="listQuery.isPending.value || configsLoading"
        :forbidden="listStatus === 403"
        :load-error="!!listQuery.error.value && listStatus !== 403"
        @open="openConfig"
        @retry="retryList"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type {
  EvalTargetScope,
  QualityAgentParams,
  ScoreConfig,
} from "@/services/online-evals.service";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { useQualityList, type DateWindow } from "./composables/useQualityList";
import { dataTypeOf, entityId } from "./utils/evalEntity";
import { thresholdForConfig } from "./utils/scoreThreshold";
import { parseTabFromRoute } from "./utils/routeSync";
import {
  QUALITY_SCOPES,
  scoreConfigLink,
  type QualityOnly,
  type QualityRow,
  type QualityScope,
} from "./utils/qualityFormat";
import QualityConfigsTable from "./quality/QualityConfigsTable.vue";
import QualityConfigDetail from "./quality/QualityConfigDetail.vue";

const props = defineProps<{
  scoreConfigs: ScoreConfig[];
  configsLoading: boolean;
  dateWindow: DateWindow;
  agentParams: QualityAgentParams;
  /** Agents the cascade selects; null while every level is "All". */
  evaluatorAgents: GenAiAgentListItem[] | null;
  /** False until the agent list first loads, so a deep-linked agent is applied before the first request. */
  enabled: boolean;
}>();

const emit = defineEmits<{
  /** Oldest data time and fetch state of the reads on screen, for the header's last-refreshed label. */
  (e: "status", status: { updatedAt: number | null; fetching: boolean }): void;
}>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const { listQuery, failedRunsQuery, failedRuns, rows, visibleRows, tiles, tileFilter, listStatus } =
  useQualityList({
    scoreConfigs: toRef(props, "scoreConfigs"),
    dateWindow: toRef(props, "dateWindow"),
    agentParams: toRef(props, "agentParams"),
    evaluatorAgents: toRef(props, "evaluatorAgents"),
    enabled: toRef(props, "enabled"),
  });

// The detail view lives in the URL, so a reload or a shared link opens the same view.
const configId = computed(() => (typeof route.query.config === "string" ? route.query.config : ""));
const selectedRow = computed<QualityRow | null>(
  () => rows.value.find((row) => row.configId === configId.value) ?? null,
);
const selectedConfig = computed<ScoreConfig | null>(
  () => props.scoreConfigs.find((config) => entityId(config) === configId.value) ?? null,
);

// URL values the controls cannot show (a scope without scores, Unhealthy without a threshold) fall back to All.
const scope = computed<QualityScope>(() => {
  const value = route.query.scope as EvalTargetScope;
  if (!QUALITY_SCOPES.includes(value)) return "all";
  const counts = selectedRow.value?.scopeCounts;
  return counts && !counts[value] ? "all" : value;
});
const only = computed<QualityOnly>(() => {
  if (route.query.only !== "unhealthy") return "all";
  const row = selectedRow.value;
  const config = selectedConfig.value;
  if (row) return row.unhealthy === null ? "all" : "unhealthy";
  return config && !thresholdForConfig(config).label ? "all" : "unhealthy";
});

/** The module title on the list; the config's name, description, type and version on the detail. */
const header = computed(() => {
  if (!configId.value) {
    return {
      title: t("aiObservability.nav.quality"),
      subtitle: t("aiObservability.subtitle.quality"),
      dataType: null,
      version: null,
    };
  }
  const row = selectedRow.value;
  const config = selectedConfig.value;
  return {
    title: raw(row?.name ?? config?.name ?? configId.value),
    subtitle: raw(row?.description || config?.description || ""),
    dataType: row?.dataType ?? (config ? dataTypeOf(config) : null),
    version: row?.version ?? config?.version ?? null,
  };
});

/** All, then each scope with scores; the toggle shows only when there are two or more. */
const scopeOptions = computed(() => {
  const counts = selectedRow.value?.scopeCounts;
  if (!counts) return [];
  return [
    {
      value: "all",
      label: t("onlineEvals.quality.scopes.all"),
      count: selectedRow.value?.total ?? 0,
    },
    ...QUALITY_SCOPES.filter((value) => counts[value] > 0).map((value) => ({
      value,
      label: t(`onlineEvals.quality.scopes.${value}`),
      count: counts[value],
    })),
  ];
});

function openEditConfig() {
  router
    .push(scoreConfigLink(String(route.name), orgId.value, configId.value, "update"))
    .catch(() => {});
}

// Patches the route does not show yet, so two replaces in one tick do not drop each other's keys.
let pendingPatch: Record<string, string | undefined> = {};
watch(
  () => route.query,
  () => (pendingPatch = {}),
);

function updateQuery(patch: Record<string, string | undefined>, push = false) {
  pendingPatch = { ...pendingPatch, ...patch };
  const query: Record<string, any> = { ...route.query, ...pendingPatch };
  for (const key of Object.keys(pendingPatch))
    if (pendingPatch[key] === undefined) delete query[key];
  if (!push && sameQuery(query, route.query)) return;
  const location = { name: route.name as string, query };
  (push ? router.push(location) : router.replace(location)).catch(() => {});
}

const sameQuery = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// The scores page (1-based) and selected score live in the URL, so Back from a link reopens the same score.
const restoredPage = computed(() => {
  const value = Number(route.query.page);
  return Number.isInteger(value) && value > 1 ? value - 1 : 0;
});
const restoredScoreId = computed(() =>
  typeof route.query.score === "string" && route.query.score ? route.query.score : null,
);

function updatePosition(position: { page: number; scoreId: string | null }) {
  updateQuery({
    page: position.page > 0 ? String(position.page + 1) : undefined,
    score: position.scoreId ?? undefined,
  });
}

function openConfig(row: QualityRow, onlyValue: QualityOnly) {
  updateQuery(
    {
      config: row.configId,
      scope: undefined,
      only: onlyValue === "all" ? undefined : onlyValue,
      page: undefined,
      score: undefined,
    },
    true,
  );
}

// "All configs" steps back when the entry before is the list, so it matches the browser Back button, even after a round trip through a link.
function previousIsList() {
  const back = window.history.state?.back;
  if (typeof back !== "string") return false;
  const previous = router.resolve(back);
  return (
    previous.name === route.name &&
    parseTabFromRoute(previous.query.tab) === "quality" &&
    !previous.query.config
  );
}

function closeConfig() {
  if (previousIsList()) {
    router.back();
    return;
  }
  updateQuery({
    config: undefined,
    scope: undefined,
    only: undefined,
    page: undefined,
    score: undefined,
  });
}

function retryList() {
  void listQuery.refetch();
}

const detailStatus = ref<{ updatedAt: number; fetching: boolean } | null>(null);
watch(configId, (id) => {
  if (!id) detailStatus.value = null;
});

watch(
  () => {
    const times = [listQuery.dataUpdatedAt.value, failedRunsQuery.dataUpdatedAt.value];
    if (configId.value && detailStatus.value) times.push(detailStatus.value.updatedAt);
    const loaded = times.filter((time) => time > 0);
    return {
      updatedAt: loaded.length ? Math.min(...loaded) : null,
      fetching:
        listQuery.isFetching.value ||
        failedRunsQuery.isFetching.value ||
        (!!configId.value && !!detailStatus.value?.fetching),
    };
  },
  (status) => emit("status", status),
  { immediate: true, deep: true },
);
</script>
