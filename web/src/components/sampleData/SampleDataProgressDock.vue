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
  <section
    v-if="loading || done || failed"
    class="bg-surface-base border-border-default rounded-surface fixed end-4 bottom-4 z-40 flex w-92 max-w-[calc(100vw-2rem)] flex-col gap-3 border p-4 shadow-lg"
    data-test="sample-data-progress-dock"
    :data-state="failed ? 'failed' : done ? 'done' : 'loading'"
  >
    <template v-if="loading">
      <div class="flex items-center gap-2">
        <OIcon name="progress-activity" size="sm" class="text-accent animate-spin" />
        <strong role="status" class="text-text-heading flex-1 text-sm">{{
          t("sampleData.welcome.progress.title")
        }}</strong>
        <span class="text-text-secondary text-xs">{{ percent }}</span>
      </div>
      <OProgressBar :value="session.fraction.value" size="sm" />
      <span class="text-text-secondary text-xs" data-test="sample-data-progress-dock-counts">{{
        t("sampleData.progress.counts", {
          logs: raw(session.counts.logs.toLocaleString()),
          spans: raw(session.counts.spans.toLocaleString()),
          metrics: raw(session.counts.metrics.toLocaleString()),
        })
      }}</span>
      <div class="flex justify-end">
        <OButton
          variant="outline"
          size="sm"
          data-test="sample-data-progress-dock-details"
          @click="session.openWelcome()"
        >
          {{ t("sampleData.dock.details") }}
        </OButton>
      </div>
    </template>

    <template v-else-if="failed">
      <div class="flex items-center gap-2">
        <OIcon name="error" size="sm" class="text-status-error-text" />
        <strong role="status" class="text-text-heading flex-1 text-sm">{{
          t("sampleData.toast.loadFailed")
        }}</strong>
        <OButton
          variant="ghost"
          size="icon-sm"
          :aria-label="t('common.close')"
          data-test="sample-data-progress-dock-close"
          @click="dismissed = true"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>
      <span
        v-if="session.forbidden.value || session.error.value"
        class="text-text-secondary text-xs"
        data-test="sample-data-progress-dock-error"
        >{{
          session.forbidden.value ? t("sampleData.loadForbidden") : raw(session.error.value)
        }}</span
      >
      <div v-if="!session.forbidden.value" class="flex justify-end">
        <OButton
          variant="primary"
          size="sm"
          data-test="sample-data-progress-dock-retry"
          @click="retry"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-2">
        <OIcon name="check-circle" size="sm" class="text-status-success-text" />
        <strong role="status" class="text-text-heading flex-1 text-sm">{{
          t("sampleData.welcome.ready.title")
        }}</strong>
        <OButton
          variant="ghost"
          size="icon-sm"
          :aria-label="t('common.close')"
          data-test="sample-data-progress-dock-close"
          @click="dismissed = true"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>
      <div class="flex justify-end">
        <OButton
          variant="primary"
          size="sm"
          data-test="sample-data-progress-dock-tour"
          @click="startTour"
        >
          {{ t("sampleData.welcome.ready.startTour") }}
        </OButton>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const session = useSampleDataSession();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const dismissed = ref(false);
const finishedInBackground = ref(false);
const failedInBackground = ref(false);

// the dialog shows the same progress, so the dock only takes over once it is closed
const ownLoad = computed(
  () =>
    session.loadingOrg.value === org.value &&
    !session.welcomeOpen.value &&
    !store.state.kioskMode &&
    !store.state.printMode,
);
const loading = computed(() => ownLoad.value && session.status.value === "loading");
const done = computed(
  () =>
    ownLoad.value &&
    session.status.value === "loaded" &&
    finishedInBackground.value &&
    !dismissed.value &&
    session.tour.value?.org !== org.value,
);
const failed = computed(
  () =>
    ownLoad.value &&
    session.status.value === "failed" &&
    failedInBackground.value &&
    !dismissed.value,
);
const percent = computed(() => raw(`${Math.round(session.fraction.value * 100)}%`));

// only a load that finishes with the dialog closed needs this notice; the dialog shows its own ready view
watch(session.status, (now, before) => {
  if (now === "loading") {
    dismissed.value = false;
    finishedInBackground.value = false;
    failedInBackground.value = false;
  } else if (before === "loading" && now === "loaded") {
    finishedInBackground.value = !session.welcomeOpen.value;
  } else if (before === "loading" && now === "failed") {
    failedInBackground.value = !session.welcomeOpen.value;
  }
});

const retry = () => {
  session.start(org.value, store.state.zoConfig?.ingest_allowed_upto);
};

const startTour = () => {
  dismissed.value = true;
  session.startTourAndShow(org.value, () => org.value, router);
};
</script>
