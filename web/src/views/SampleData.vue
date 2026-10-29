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
        <div v-else-if="state === 'loaded'" class="flex shrink-0 flex-wrap gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="dashboard"
            data-test="sample-data-open-overview-btn"
            @click="openTarget('dashboard')"
          >
            {{ t("sampleData.openOverview") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            icon-left="flag"
            data-test="sample-data-start-tour-btn"
            @click="startTour"
          >
            {{ t("sampleData.welcome.ready.startTour") }}
          </OButton>
        </div>
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
        class="p-5"
      >
        <SampleDataProgress />
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
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import SampleDataProgress from "@/components/sampleData/SampleDataProgress.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { streamNameListQuery } from "@/services/stream.queries";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { sampleWindowHours } from "@/utils/sampleData/loader";
import { SAMPLE_METRICS, SAMPLE_STREAMS } from "@/utils/sampleData/catalog";
import {
  SAMPLE_TOUR_STEPS,
  resolveTourTarget,
  type SampleTourStepId,
} from "@/utils/sampleData/tour";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const hours = computed(() => sampleWindowHours(store.state.zoConfig?.ingest_allowed_upto));

const logStreams = useQuery(computed(() => streamNameListQuery(org.value, "logs")));
const statusKnown = computed(() => !logStreams.isPending.value);
const alreadyLoaded = computed(() =>
  (logStreams.data.value ?? []).some((s: { name?: string }) => s?.name === SAMPLE_STREAMS.appLogs),
);

const removing = ref(false);
const confirmRemove = ref(false);
const ownSession = computed(() => session.loadingOrg.value === org.value);
const justLoaded = computed(() => ownSession.value && session.status.value === "loaded");
const loadError = computed<I18nText | null>(() => {
  if (!ownSession.value || session.status.value !== "failed") return null;
  return raw(session.error.value ?? "") || t("sampleData.toast.loadFailed");
});

const state = computed<"idle" | "loading" | "loaded">(() => {
  if (ownSession.value && session.status.value === "loading") return "loading";
  if (justLoaded.value || alreadyLoaded.value) return "loaded";
  return "idle";
});

const heroTitle = computed(() =>
  state.value === "loaded" ? t("sampleData.hero.loadedTitle") : t("sampleData.hero.title"),
);
const heroBody = computed(() =>
  state.value === "loaded"
    ? t("sampleData.hero.loadedBody")
    : t("sampleData.hero.body", { hours: raw(String(hours.value)) }),
);

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
    id: "pipeline",
    icon: "alt-route",
    tint: "bg-tabs-active-bg text-tabs-active-text",
    label: t("sampleData.included.pipeline"),
    detail: t("sampleData.included.pipelineDetail"),
  },
]);

const openTarget = (id: SampleTourStepId) =>
  resolveTourTarget(org.value, id)
    .then((to) => router.push(to))
    .catch(() => {});

const startTour = () => {
  session.startTour(org.value);
  openTarget(SAMPLE_TOUR_STEPS[0].id);
};

const tours = computed<
  { id: string; icon: IconName; label: I18nText; sublabel: I18nText; go: () => void }[]
>(() => [
  {
    id: "dashboards",
    icon: "dashboard",
    label: t("sampleData.explore.dashboards"),
    sublabel: t("sampleData.explore.dashboardsDesc"),
    go: () => openTarget("dashboard"),
  },
  {
    id: "logs",
    icon: "search",
    label: t("sampleData.explore.logs"),
    sublabel: t("sampleData.explore.logsDesc"),
    go: () => openTarget("logs"),
  },
  {
    id: "traces",
    icon: "account-tree",
    label: t("sampleData.explore.traces"),
    sublabel: t("sampleData.explore.tracesDesc"),
    go: () => openTarget("traces"),
  },
  {
    id: "metrics",
    icon: "bar-chart",
    label: t("sampleData.explore.metrics"),
    sublabel: t("sampleData.explore.metricsDesc"),
    go: () => openTarget("metrics"),
  },
  {
    id: "alerts",
    icon: "notifications",
    label: t("sampleData.explore.alerts"),
    sublabel: t("sampleData.explore.alertsDesc"),
    go: () => openTarget("alert"),
  },
  {
    id: "pipeline",
    icon: "alt-route",
    label: t("sampleData.explore.pipeline"),
    sublabel: t("sampleData.explore.pipelineDesc"),
    go: () => openTarget("pipeline"),
  },
]);

const startLoad = () => session.start(org.value, store.state.zoConfig?.ingest_allowed_upto);

const removeAll = async () => {
  confirmRemove.value = false;
  removing.value = true;
  try {
    await session.remove(org.value);
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
