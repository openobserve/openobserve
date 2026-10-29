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
  <ODialog
    :open="session.welcomeOpen.value"
    size="lg"
    :show-close="false"
    data-test="sample-welcome-dialog"
    @update:open="(open) => !open && close()"
  >
    <div class="flex min-h-106 flex-col gap-5" :data-view="view">
      <div class="flex items-start gap-3">
        <span
          class="rounded-surface flex size-12 shrink-0 items-center justify-center"
          :class="headerTint"
        >
          <OIcon :name="headerIcon" size="md" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h2 class="text-text-heading m-0 text-2xl" data-test="sample-welcome-title">
            {{ headerTitle }}
          </h2>
          <span class="text-text-secondary text-sm">{{ headerBody }}</span>
        </div>
        <OButton
          variant="ghost"
          size="icon-sm"
          class="-me-1 shrink-0"
          :aria-label="t('common.close')"
          data-test="sample-welcome-close"
          @click="close"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <template v-if="view === 'choose'">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div
            class="border-accent bg-surface-base rounded-surface flex flex-col gap-3 border-2 p-4"
            data-test="sample-welcome-connect-card"
          >
            <div class="flex items-center gap-2">
              <span
                class="bg-ingest-tint-blue text-ingest-accent-blue rounded-default flex size-8 shrink-0 items-center justify-center"
              >
                <OIcon name="cloud-upload" size="sm" />
              </span>
              <strong class="text-text-heading flex-1 text-base">{{
                t("sampleData.welcome.connect.title")
              }}</strong>
            </div>
            <span class="text-text-secondary text-sm">{{ connectBody }}</span>
            <ul class="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
              <li
                v-for="point in connectPoints"
                :key="point"
                class="text-text-body flex items-start gap-2 text-sm"
              >
                <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
                {{ point }}
              </li>
            </ul>
            <OButton
              variant="primary"
              icon-right="arrow-forward"
              class="w-full"
              data-test="sample-welcome-connect"
              @click="connect"
            >
              {{ t("sampleData.welcome.connect.cta") }}
            </OButton>
          </div>

          <div
            class="border-border-default bg-surface-base rounded-surface flex flex-col gap-3 border p-4"
            data-test="sample-welcome-sample-card"
          >
            <div class="flex items-center gap-2">
              <span
                class="bg-ingest-tint-purple text-ingest-accent-purple rounded-default flex size-8 shrink-0 items-center justify-center"
              >
                <OIcon name="science" size="sm" />
              </span>
              <strong class="text-text-heading flex-1 text-base">{{
                t("sampleData.welcome.sample.title")
              }}</strong>
            </div>
            <span class="text-text-secondary text-sm">{{
              t("sampleData.welcome.sample.body")
            }}</span>
            <ul class="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
              <li
                v-for="point in samplePoints"
                :key="point"
                class="text-text-body flex items-start gap-2 text-sm"
              >
                <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
                {{ point }}
              </li>
            </ul>
            <OButton
              variant="outline"
              icon-left="play-arrow"
              class="w-full"
              data-test="sample-welcome-load"
              @click="load"
            >
              {{ t("sampleData.welcome.sample.cta") }}
            </OButton>
          </div>
        </div>

        <div class="flex justify-end">
          <OButton variant="ghost" size="sm" data-test="sample-welcome-skip" @click="close">
            {{ t("sampleData.welcome.skip") }}
          </OButton>
        </div>
      </template>

      <template v-else-if="view === 'progress'">
        <SampleDataProgress stacked />
        <div class="mt-auto flex justify-end">
          <OButton variant="ghost" size="sm" data-test="sample-welcome-background" @click="close">
            {{ t("sampleData.welcome.continueInBackground") }}
          </OButton>
        </div>
      </template>

      <template v-else-if="view === 'ready'">
        <div class="flex flex-col gap-2">
          <span class="text-text-label text-xs">{{ t("sampleData.welcome.ready.covers") }}</span>
          <ul class="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 md:grid-cols-3">
            <li
              v-for="cap in tourCapabilities"
              :key="cap.id"
              class="border-border-default rounded-surface flex items-start gap-3 border p-3"
            >
              <span
                class="bg-surface-subtle text-accent rounded-default flex size-9 shrink-0 items-center justify-center"
              >
                <OIcon :name="cap.icon" size="sm" />
              </span>
              <div class="flex min-w-0 flex-col gap-0.5">
                <strong class="text-text-heading text-sm">{{ cap.label }}</strong>
                <span class="text-text-secondary text-xs">{{ cap.detail }}</span>
              </div>
            </li>
          </ul>
        </div>
        <div class="mt-auto flex flex-wrap items-center justify-end gap-2">
          <OButton variant="ghost" size="sm" data-test="sample-welcome-own-way" @click="close">
            {{ t("sampleData.welcome.ready.ownWay") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            icon-left="dashboard"
            data-test="sample-welcome-open-overview"
            @click="openOverview"
          >
            {{ t("sampleData.openOverview") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            icon-left="flag"
            data-test="sample-welcome-start-tour"
            @click="startTour"
          >
            {{ t("sampleData.welcome.ready.startTour") }}
          </OButton>
        </div>
      </template>

      <template v-else>
        <OBanner variant="error" dense data-test="sample-welcome-error">
          {{ session.error.value || t("sampleData.toast.loadFailed") }}
        </OBanner>
        <div class="mt-auto flex justify-end gap-2">
          <OButton variant="ghost" size="sm" @click="close">{{ t("common.cancel") }}</OButton>
          <OButton variant="primary" size="sm" data-test="sample-welcome-retry" @click="load">
            {{ t("common.retry") }}
          </OButton>
        </div>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import config from "@/aws-exports";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import { orgSummaryQuery } from "@/services/organizations.queries";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { sampleWindowHours } from "@/utils/sampleData/loader";
import { SAMPLE_TOUR_STEPS, resolveTourTarget } from "@/utils/sampleData/tour";
import SampleDataProgress from "@/components/sampleData/SampleDataProgress.vue";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const hours = computed(() => sampleWindowHours(store.state.zoConfig?.ingest_allowed_upto));

const view = computed<"choose" | "progress" | "ready" | "error">(() => {
  if (session.loadingOrg.value !== org.value) return "choose";
  if (session.status.value === "loading") return "progress";
  if (session.status.value === "loaded") return "ready";
  if (session.status.value === "failed") return "error";
  return "choose";
});

const headerIcon = computed<IconName>(() => {
  if (view.value === "ready") return "check-circle";
  if (view.value === "progress") return "progress-activity";
  if (view.value === "choose") return "rocket-launch";
  return "science";
});
const headerTint = computed(() => {
  if (view.value === "ready") return "bg-icon-chip-success-bg text-status-success-text";
  if (view.value === "choose") return "bg-ingest-tint-blue text-ingest-accent-blue";
  return "bg-ingest-tint-purple text-ingest-accent-purple";
});
const headerTitle = computed(() => {
  if (view.value === "progress") return t("sampleData.welcome.progress.title");
  if (view.value === "ready") return t("sampleData.welcome.ready.title");
  if (view.value === "error") return t("sampleData.toast.loadFailed");
  return t("sampleData.welcome.title", { product: raw("OpenObserve") });
});
const headerBody = computed(() => {
  if (view.value === "progress") return t("sampleData.welcome.progress.body");
  if (view.value === "ready") return t("sampleData.welcome.ready.body");
  if (view.value === "error") return t("sampleData.welcome.errorBody");
  return t("sampleData.welcome.subtitle");
});

const connectPoints = computed<I18nText[]>(() => [
  t("sampleData.welcome.connect.point1"),
  t("sampleData.welcome.connect.point2"),
  t("sampleData.welcome.connect.point3"),
]);
const samplePoints = computed<I18nText[]>(() => [
  t("sampleData.welcome.sample.point1", { hours: raw(String(hours.value)) }),
  t("sampleData.welcome.sample.point2"),
  t("sampleData.welcome.sample.point3"),
]);
const connectBody = computed(() =>
  t("sampleData.welcome.connect.body", {
    p1: raw("OpenTelemetry"),
    p2: raw("Kubernetes"),
    p3: raw("Fluent Bit"),
    p4: raw("Prometheus"),
  }),
);

const tourCapabilities = computed(() =>
  [...new Map(SAMPLE_TOUR_STEPS.map((s) => [s.capability, s])).values()].map((s) => ({
    id: s.capability,
    icon: s.icon,
    label: t(`sampleData.tour.capabilities.${s.capability}`),
    detail: t(`sampleData.welcome.ready.capabilities.${s.capability}`),
  })),
);

const close = () => {
  if (org.value) session.markWelcomeSeen(org.value);
  session.closeWelcome();
};

const startTourFor = (target: string) => {
  session.startTour(target);
  resolveTourTarget(target, SAMPLE_TOUR_STEPS[0].id)
    .then((to) => router.push(to))
    .catch(() => {});
};

const load = () => {
  session.markWelcomeSeen(org.value);
  session.start(org.value, store.state.zoConfig?.ingest_allowed_upto);
};

const startTour = () => startTourFor(org.value);

const openOverview = () => {
  close();
  resolveTourTarget(org.value, "dashboard")
    .then((to) => router.push(to))
    .catch(() => {});
};

const connect = () => {
  close();
  router.push({ name: "recommended", query: { org_identifier: org.value } }).catch(() => {});
};

const maybeGreet = async () => {
  const id = org.value;
  if (config.isCloud === "true" || store.state.kioskMode) return;
  if (!id || route.name !== "home" || session.welcomeSeen(id) || session.tour.value) return;
  if (session.status.value === "loading") return;
  try {
    const summary = await queryClient.fetchQuery(orgSummaryQuery(id));
    if (summary?.streams?.num_streams) return;
  } catch {
    return;
  }
  if (id === org.value && route.name === "home") session.openWelcome();
};

// every entry point loads through the session, so this one host announces the result
watch(session.status, (now, before) => {
  if (before !== "loading" || now !== "loaded") return;
  const target = session.loadingOrg.value;
  if (target === org.value) store.dispatch("setIsDataIngested", true);
  if (session.welcomeOpen.value) return;
  toast({
    variant: "success",
    message: t("sampleData.toast.loaded"),
    action: { label: t("sampleData.welcome.ready.startTour"), handler: () => startTourFor(target) },
  });
});

watch([org, () => route.name], maybeGreet);
onMounted(maybeGreet);
</script>
