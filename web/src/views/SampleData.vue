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
    :title="t('sampleData.title')"
    :subtitle="t('sampleData.subtitle')"
    icon="science"
    :back="{
      label: t('ingestion.header'),
      to: { name: 'recommended', query: { org_identifier: org } },
    }"
    title-data-test="sample-data-title"
    scroll
    data-test="sample-data-page"
  >
    <template v-if="state === 'loaded'" #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="delete-outline"
        :loading="removing"
        data-test="sample-data-remove-btn"
        @click="confirmRemove = true"
      >
        {{ t("sampleData.remove") }}
      </OButton>
    </template>

    <div class="mx-auto flex w-full max-w-240 flex-col gap-4 py-4">
      <OCard
        variant="outlined"
        class="flex-row! items-center gap-4 p-5 max-md:flex-col! max-md:items-start"
        data-test="sample-data-hero"
      >
        <span
          class="bg-ingest-tint-purple text-ingest-accent-purple rounded-surface flex size-12 shrink-0 items-center justify-center"
        >
          <OIcon name="science" size="md" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <strong class="text-text-heading text-lg">{{ heroTitle }}</strong>
          <span class="text-text-secondary text-sm">{{ heroBody }}</span>
        </div>
        <OButton
          v-if="state === 'idle'"
          variant="primary"
          size="sm-action"
          icon-left="play-arrow"
          :disabled="!statusKnown"
          data-test="sample-data-load-btn"
          @click="startLoad"
        >
          {{ t("sampleData.load") }}
        </OButton>
        <OButton
          v-else-if="state === 'loaded' && overviewDashboardId"
          variant="primary"
          size="sm-action"
          icon-left="dashboard"
          data-test="sample-data-open-overview-btn"
          @click="openOverview"
        >
          {{ t("sampleData.openOverview") }}
        </OButton>
      </OCard>

      <OBanner v-if="loadError" variant="error" dense inline-actions data-test="sample-data-error">
        {{ loadError }}
        <template #actions>
          <OButton variant="outline" size="sm-action" @click="startLoad">
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>

      <OCard
        v-if="state === 'loading' || (state === 'loaded' && justLoaded)"
        variant="outlined"
        class="gap-3 p-5"
        data-test="sample-data-progress"
      >
        <div class="flex items-center justify-between gap-3">
          <strong class="text-text-heading">{{
            state === "loading" ? t("sampleData.progress.loading") : t("sampleData.progress.done")
          }}</strong>
          <span class="text-text-secondary text-xs" data-test="sample-data-progress-counts">{{
            countsLine
          }}</span>
        </div>
        <OProgressBar
          :value="overallFraction"
          :variant="state === 'loaded' ? 'success' : 'default'"
          size="sm"
        />
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li
            v-for="step in steps"
            :key="step.id"
            class="flex items-center gap-2 text-sm"
            :data-test="`sample-data-step-${step.id}`"
            :data-status="step.status"
          >
            <OIcon :name="stepIcon(step.status)" size="sm" :class="stepIconClass(step.status)" />
            <span :class="step.status === 'pending' ? 'text-text-secondary' : 'text-text-body'">{{
              step.label
            }}</span>
            <OTag
              v-if="step.status === 'failed'"
              :label="t('sampleData.progress.skipped')"
              variant="warning"
              size="sm"
            />
          </li>
        </ul>
      </OCard>

      <template v-if="state === 'loaded'">
        <div class="flex flex-col gap-2">
          <strong class="text-text-heading">{{ t("sampleData.explore.title") }}</strong>
          <span class="text-text-secondary text-sm">{{ t("sampleData.explore.subtitle") }}</span>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <EmptyStateActionCard
            v-for="tour in tours"
            :key="tour.id"
            :icon="tour.icon"
            :label="tour.label"
            :sublabel="tour.sublabel"
            :data-test="`sample-data-tour-${tour.id}`"
            @click="tour.go"
          />
        </div>
      </template>

      <template v-else>
        <strong class="text-text-heading">{{ t("sampleData.included.title") }}</strong>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <OCard
            v-for="item in included"
            :key="item.id"
            variant="outlined"
            class="flex-row! items-start gap-3 p-4"
            :data-test="`sample-data-included-${item.id}`"
          >
            <span
              class="rounded-default flex size-8 shrink-0 items-center justify-center"
              :class="item.tint"
            >
              <OIcon :name="item.icon" size="sm" />
            </span>
            <div class="flex min-w-0 flex-col gap-0.5">
              <strong class="text-text-heading text-sm">{{ item.label }}</strong>
              <span class="text-text-secondary text-xs">{{ item.detail }}</span>
            </div>
          </OCard>
        </div>
        <p class="text-text-secondary m-0 text-xs" data-test="sample-data-footnote">
          {{ t("sampleData.footnote", { prefix: raw("sample_"), hours: raw(String(hours)) }) }}
        </p>
      </template>
    </div>

    <ConfirmDialog
      v-model="confirmRemove"
      :title="t('sampleData.removeConfirm.title')"
      :message="t('sampleData.removeConfirm.message')"
      :ok-label="t('sampleData.remove')"
      ok-variant="destructive"
      data-test="sample-data-remove-dialog"
      @update:ok="removeAll"
      @update:cancel="confirmRemove = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { streamNameListQuery } from "@/services/stream.queries";
import { foldersQuery } from "@/services/common.queries";
import { dashboardsSearchQuery, type DashboardSearchHit } from "@/services/dashboards.queries";
import { loadSampleDataMutation, removeSampleDataMutation } from "@/services/sample_data.queries";
import {
  SAMPLE_STEPS,
  sampleWindowHours,
  type SampleCounts,
  type SampleProgress,
  type SampleStepId,
} from "@/utils/sampleData/loader";
import {
  SAMPLE_FOLDER_NAME,
  SAMPLE_METRICS,
  SAMPLE_OVERVIEW_TITLE,
  SAMPLE_STREAMS,
} from "@/utils/sampleData/catalog";
import { b64EncodeUnicode } from "@/utils/zincutils";

type StepStatus = "pending" | "running" | "done" | "failed";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const hours = computed(() => sampleWindowHours(store.state.zoConfig?.ingest_allowed_upto));

const logStreams = useQuery(computed(() => streamNameListQuery(org.value, "logs")));
const statusKnown = computed(() => !logStreams.isPending.value);
const alreadyLoaded = computed(() =>
  (logStreams.data.value ?? []).some((s: { name?: string }) => s?.name === SAMPLE_STREAMS.appLogs),
);

const loadWrite = useMutation(() => loadSampleDataMutation(org.value));
const removeWrite = useMutation(() => removeSampleDataMutation(org.value));

const loading = ref(false);
const removing = ref(false);
const justLoaded = ref(false);
const confirmRemove = ref(false);
const loadError = ref<I18nText | null>(null);
const loadedOverviewId = ref<string>();
const loadedFolderId = ref<string>();
const counts = reactive<SampleCounts>({ logs: 0, spans: 0, metrics: 0 });
const stepStatus = reactive<Record<SampleStepId, StepStatus>>({
  telemetry: "pending",
  dashboards: "pending",
  alerts: "pending",
  functions: "pending",
  enrichment: "pending",
});
const telemetryFraction = ref(0);

const overviewSearch = useQuery(
  computed(() => ({
    ...dashboardsSearchQuery(org.value, SAMPLE_OVERVIEW_TITLE),
    enabled: alreadyLoaded.value || justLoaded.value,
  })),
);
const overviewHit = computed(() =>
  (overviewSearch.data.value ?? []).find(
    (hit: DashboardSearchHit) => hit.title === SAMPLE_OVERVIEW_TITLE,
  ),
);
const overviewDashboardId = computed(
  () => loadedOverviewId.value ?? overviewHit.value?.dashboardId,
);
const dashboardFolderId = computed(() => loadedFolderId.value ?? overviewHit.value?.folderId);

const alertFolders = useQuery(
  computed(() => ({
    ...foldersQuery(org.value, "alerts"),
    enabled: alreadyLoaded.value || justLoaded.value,
  })),
);
const sampleAlertFolderId = computed(
  () => (alertFolders.data.value ?? []).find((f) => f.name === SAMPLE_FOLDER_NAME)?.folderId,
);

const state = computed<"idle" | "loading" | "loaded">(() => {
  if (loading.value) return "loading";
  if (justLoaded.value || alreadyLoaded.value) return "loaded";
  return "idle";
});

const stepLabels = computed<Record<SampleStepId, I18nText>>(() => ({
  telemetry: t("sampleData.steps.telemetry"),
  dashboards: t("sampleData.steps.dashboards"),
  alerts: t("sampleData.steps.alerts"),
  functions: t("sampleData.steps.functions"),
  enrichment: t("sampleData.steps.enrichment"),
}));
const steps = computed(() =>
  SAMPLE_STEPS.map((id) => ({ id, label: stepLabels.value[id], status: stepStatus[id] })),
);
const overallFraction = computed(() => {
  // telemetry dominates the wall time, so it carries most of the bar
  const assetsDone = SAMPLE_STEPS.slice(1).filter((s) =>
    ["done", "failed"].includes(stepStatus[s]),
  ).length;
  return telemetryFraction.value * 0.8 + (assetsDone / (SAMPLE_STEPS.length - 1)) * 0.2;
});
const countsLine = computed(() =>
  t("sampleData.progress.counts", {
    logs: raw(counts.logs.toLocaleString()),
    spans: raw(counts.spans.toLocaleString()),
    metrics: raw(counts.metrics.toLocaleString()),
  }),
);

const heroTitle = computed(() =>
  state.value === "loaded" ? t("sampleData.hero.loadedTitle") : t("sampleData.hero.title"),
);
const heroBody = computed(() =>
  state.value === "loaded"
    ? t("sampleData.hero.loadedBody")
    : t("sampleData.hero.body", { hours: raw(String(hours.value)) }),
);

const stepIcon = (status: StepStatus): IconName => {
  if (status === "done") return "check-circle";
  if (status === "failed") return "warning-amber";
  if (status === "running") return "progress-activity";
  return "radio-button-unchecked";
};
const stepIconClass = (status: StepStatus) => {
  if (status === "done") return "text-status-success-text";
  if (status === "failed") return "text-icon-chip-warning-text";
  if (status === "running") return "text-accent animate-spin";
  return "text-text-secondary";
};

const included = computed<
  { id: string; icon: IconName; tint: string; label: I18nText; detail: I18nText }[]
>(() => [
  {
    id: "logs",
    icon: "search",
    tint: "bg-ingest-tint-blue text-ingest-accent-blue",
    label: t("sampleData.included.logs"),
    detail: t("sampleData.included.logsDetail", {
      app: raw(SAMPLE_STREAMS.appLogs),
      access: raw(SAMPLE_STREAMS.accessLogs),
    }),
  },
  {
    id: "traces",
    icon: "account-tree",
    tint: "bg-ingest-tint-purple text-ingest-accent-purple",
    label: t("sampleData.included.traces"),
    detail: t("sampleData.included.tracesDetail"),
  },
  {
    id: "metrics",
    icon: "bar-chart",
    tint: "bg-ingest-tint-teal text-ingest-accent-teal",
    label: t("sampleData.included.metrics"),
    detail: t("sampleData.included.metricsDetail", {
      count: raw(String(Object.keys(SAMPLE_METRICS).length)),
    }),
  },
  {
    id: "dashboards",
    icon: "dashboard",
    tint: "bg-ingest-tint-amber text-ingest-accent-amber",
    label: t("sampleData.included.dashboards"),
    detail: t("sampleData.included.dashboardsDetail"),
  },
  {
    id: "alerts",
    icon: "notifications",
    tint: "bg-ingest-tint-orange text-ingest-accent-orange",
    label: t("sampleData.included.alerts"),
    detail: t("sampleData.included.alertsDetail"),
  },
  {
    id: "functions",
    icon: "functions",
    tint: "bg-tabs-active-bg text-tabs-active-text",
    label: t("sampleData.included.functions"),
    detail: t("sampleData.included.functionsDetail"),
  },
]);

const go = (name: string, query: Record<string, string> = {}) =>
  router.push({ name, query: { org_identifier: org.value, ...query } }).catch(() => {});

const openOverview = () => {
  if (!overviewDashboardId.value) {
    go("dashboards");
    return;
  }
  go("viewDashboard", {
    dashboard: overviewDashboardId.value,
    folder: dashboardFolderId.value ?? "default",
  });
};

const tours = computed<
  { id: string; icon: IconName; label: I18nText; sublabel: I18nText; go: () => void }[]
>(() => [
  {
    id: "dashboards",
    icon: "dashboard",
    label: t("sampleData.explore.dashboards"),
    sublabel: t("sampleData.explore.dashboardsDesc"),
    go: openOverview,
  },
  {
    id: "logs",
    icon: "search",
    label: t("sampleData.explore.logs"),
    sublabel: t("sampleData.explore.logsDesc"),
    go: () =>
      go("logs", {
        stream: SAMPLE_STREAMS.appLogs,
        stream_type: "logs",
        period: "1h",
        refresh: "0",
        sql_mode: "false",
        query: b64EncodeUnicode("service_name = 'payment' AND level = 'error'") ?? "",
        type: "logs",
      }),
  },
  {
    id: "traces",
    icon: "account-tree",
    label: t("sampleData.explore.traces"),
    sublabel: t("sampleData.explore.tracesDesc"),
    go: () =>
      go("traces", {
        stream: SAMPLE_STREAMS.traces,
        period: "1h",
        query: b64EncodeUnicode("span_status = 'ERROR'") ?? "",
      }),
  },
  {
    id: "metrics",
    icon: "bar-chart",
    label: t("sampleData.explore.metrics"),
    sublabel: t("sampleData.explore.metricsDesc"),
    go: () => go("metrics", { metric: SAMPLE_METRICS.requests }),
  },
  {
    id: "alerts",
    icon: "notifications",
    label: t("sampleData.explore.alerts"),
    sublabel: t("sampleData.explore.alertsDesc"),
    go: () =>
      go("alertList", sampleAlertFolderId.value ? { folder: sampleAlertFolderId.value } : {}),
  },
  {
    id: "functions",
    icon: "functions",
    label: t("sampleData.explore.functions"),
    sublabel: t("sampleData.explore.functionsDesc"),
    go: () => go("functionList"),
  },
]);

const onProgress = (p: SampleProgress) => {
  Object.assign(counts, p.counts);
  if (p.step === "telemetry") {
    telemetryFraction.value = p.fraction;
    stepStatus.telemetry = p.fraction >= 1 ? "done" : "running";
    return;
  }
  if (p.fraction === 0) stepStatus[p.step] = "running";
};

const resetProgress = () => {
  for (const id of SAMPLE_STEPS) stepStatus[id] = "pending";
  telemetryFraction.value = 0;
  Object.assign(counts, { logs: 0, spans: 0, metrics: 0 });
};

const startLoad = async () => {
  if (loading.value) return;
  loadError.value = null;
  justLoaded.value = false;
  resetProgress();
  loading.value = true;
  try {
    const result = await loadWrite.mutateAsync({
      ingestAllowedUptoHours: store.state.zoConfig?.ingest_allowed_upto,
      onProgress,
    });
    for (const id of SAMPLE_STEPS.slice(1)) {
      stepStatus[id] = result.failedSteps.includes(id) ? "failed" : "done";
    }
    loadedOverviewId.value = result.overviewDashboardId;
    loadedFolderId.value = result.dashboardFolderId;
    justLoaded.value = true;
    store.dispatch("setIsDataIngested", true);
    toast({ variant: "success", message: t("sampleData.toast.loaded") });
  } catch (e: any) {
    stepStatus.telemetry = "failed";
    loadError.value = raw(e?.response?.data?.message) || t("sampleData.toast.loadFailed");
  } finally {
    loading.value = false;
  }
};

const removeAll = async () => {
  confirmRemove.value = false;
  removing.value = true;
  try {
    await removeWrite.mutateAsync();
    justLoaded.value = false;
    loadedOverviewId.value = undefined;
    loadedFolderId.value = undefined;
    resetProgress();
    toast({ variant: "success", message: t("sampleData.toast.removed") });
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("sampleData.toast.removeFailed"),
    });
  } finally {
    removing.value = false;
  }
};
</script>
