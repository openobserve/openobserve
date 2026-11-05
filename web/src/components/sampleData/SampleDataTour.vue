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
  <template v-if="visible">
    <div v-if="tour!.minimized && current" class="fixed end-4 bottom-4 z-40">
      <OButton
        variant="primary"
        size="sm"
        icon-left="flag"
        class="shadow-lg"
        data-test="sample-tour-pill"
        @click="session.setTourMinimized(false)"
      >
        {{ pillLabel }}
      </OButton>
    </div>

    <section
      v-else
      ref="panel"
      tabindex="-1"
      class="bg-surface-base border-border-default rounded-surface fixed end-4 bottom-4 z-40 flex w-92 max-w-[calc(100vw-2rem)] flex-col gap-3 border p-4 shadow-lg"
      role="dialog"
      :aria-label="t('sampleData.tour.label')"
      data-test="sample-tour-panel"
      :data-step="current?.id ?? 'finale'"
    >
      <div class="flex items-center gap-2">
        <OIcon name="flag" size="sm" class="text-accent" />
        <span class="text-text-secondary flex-1 text-xs" data-test="sample-tour-position">{{
          positionLabel
        }}</span>
        <OButton
          v-if="current"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('sampleData.tour.minimize')"
          data-test="sample-tour-minimize"
          @click="session.setTourMinimized(true)"
        >
          <OIcon name="remove" size="sm" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-sm"
          :aria-label="t('sampleData.tour.close')"
          data-test="sample-tour-close"
          @click="session.stopTour()"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <div class="flex gap-1" aria-hidden="true">
        <span
          v-for="step in openSteps"
          :key="step.id"
          class="h-1 flex-1 rounded-full transition-colors"
          :class="SAMPLE_TOUR_STEPS.indexOf(step) <= index ? 'bg-accent' : 'bg-border-default'"
          :data-test="`sample-tour-dot-${step.id}`"
        />
      </div>

      <template v-if="current">
        <div class="flex flex-col gap-1.5">
          <OTag
            :label="capabilityLabel(current.capability)"
            variant="primary-soft"
            size="sm"
            class="self-start"
          />
          <strong class="text-text-heading text-lg" data-test="sample-tour-title">{{
            stepTitle(current.id)
          }}</strong>
          <p class="text-text-body m-0 text-sm">{{ stepBody(current.id) }}</p>
        </div>
        <div class="bg-surface-subtle rounded-default flex gap-2 p-3">
          <OIcon name="lightbulb" size="sm" class="text-icon-chip-warning-text shrink-0" />
          <span class="text-text-secondary text-xs">{{ stepLook(current.id) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <OButton
            v-if="previousIndex !== undefined"
            variant="outline"
            size="sm"
            icon-left="arrow-back"
            :disabled="navigating"
            data-test="sample-tour-back"
            @click="back"
          >
            {{ t("common.back") }}
          </OButton>
          <span class="flex-1" />
          <OButton
            variant="primary"
            size="sm"
            icon-right="arrow-forward"
            :disabled="navigating"
            data-test="sample-tour-next"
            @click="next"
          >
            {{ t("sampleData.tour.next") }}
          </OButton>
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-1.5" data-test="sample-tour-finale">
          <strong class="text-text-heading text-lg">{{ t("sampleData.tour.finale.title") }}</strong>
          <p class="text-text-body m-0 text-sm">{{ t("sampleData.tour.finale.body") }}</p>
        </div>
        <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
          <li v-for="cap in capabilities" :key="cap">
            <OTag :label="capabilityLabel(cap)" variant="success-soft" size="sm" icon="check" />
          </li>
        </ul>
        <div class="flex flex-col gap-2">
          <OButton
            variant="primary"
            size="sm"
            data-test="sample-tour-connect"
            @click="connectOwnData"
          >
            {{ t("sampleData.tour.finale.connect") }}
          </OButton>
          <div class="flex items-center justify-between gap-2">
            <OButton variant="outline" size="sm" data-test="sample-tour-restart" @click="restart">
              {{ t("sampleData.tour.finale.restart") }}
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              data-test="sample-tour-finish"
              @click="session.stopTour()"
            >
              {{ t("sampleData.tour.finale.finish") }}
            </OButton>
          </div>
        </div>
      </template>
    </section>
  </template>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { useLicenseLocks } from "@/composables/useFeatureLock";
import { useSampleDataPresence } from "@/composables/sampleData/useSampleDataPresence";
import {
  SAMPLE_TOUR_STEPS,
  resolveTourTarget,
  type SampleTourStep,
  type SampleTourStepId,
} from "@/utils/sampleData/tour";
import { requestLogsReapply } from "@/utils/queryHistory/logs";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const session = useSampleDataSession();
const tour = session.tour;
const navigating = ref(false);
const panel = ref<HTMLElement | null>(null);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const active = computed(() => !!tour.value && tour.value.org === org.value);
const presence = useSampleDataPresence(org, active);
// only data that arrives during the tour ends it; an org that already had its own streams keeps it
// a restarted tour is a new object with ownData unset, so key on that, not just on being active
watch(
  () => active.value && presence.ready.value && tour.value?.ownData === undefined,
  (needed) => needed && session.setTourOwnData(presence.hasRealData.value),
  { immediate: true },
);
const visible = computed(
  () =>
    active.value &&
    !store.state.kioskMode &&
    !store.state.printMode &&
    (tour.value?.ownData === true || !presence.hasRealData.value),
);
const index = computed(() => tour.value?.index ?? 0);
const current = computed<SampleTourStep | undefined>(() => SAMPLE_TOUR_STEPS[index.value]);
// a chapter whose page the license locks would land on the lock page, so it is skipped
const { isLocked } = useLicenseLocks();
const stepLocked = (step: SampleTourStep) => {
  try {
    return isLocked(router.resolve({ name: step.route }).meta.licenseFeature);
  } catch {
    return false;
  }
};
const openSteps = computed(() => SAMPLE_TOUR_STEPS.filter((s) => !stepLocked(s)));
const nextIndex = computed(() => {
  const i = SAMPLE_TOUR_STEPS.findIndex((s, at) => at > index.value && !stepLocked(s));
  return i === -1 ? SAMPLE_TOUR_STEPS.length : i;
});
const previousIndex = computed<number | undefined>(() => {
  const i = SAMPLE_TOUR_STEPS.findLastIndex((s, at) => at < index.value && !stepLocked(s));
  return i === -1 ? undefined : i;
});
const capabilities = computed(() => [...new Set(openSteps.value.map((s) => s.capability))]);

// a keyboard user lands in the tour, and the finale drops focus on its way out
watch(panel, (el) => el?.focus());
watch(
  () => !!panel.value && !current.value,
  async (finale) => {
    if (!finale) return;
    await nextTick();
    panel.value?.querySelector<HTMLElement>('[data-test="sample-tour-finish"]')?.focus();
  },
);

const positionLabel = computed(() =>
  current.value
    ? t("sampleData.tour.position", {
        current: raw(String(openSteps.value.indexOf(current.value) + 1)),
        total: raw(String(openSteps.value.length)),
      })
    : t("sampleData.tour.done"),
);
const pillLabel = computed(() =>
  t("sampleData.tour.pill", {
    current: raw(String(current.value ? openSteps.value.indexOf(current.value) + 1 : 0)),
    total: raw(String(openSteps.value.length)),
  }),
);

const stepTitle = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.title`);
const stepBody = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.body`);
const stepLook = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.look`);
const capabilityLabel = (cap: SampleTourStep["capability"]): I18nText =>
  t(`sampleData.tour.capabilities.${cap}`);

let stepRequest = 0;
const cancelPendingStep = () => {
  stepRequest++;
  navigating.value = false;
};
// ending the tour, switching org or leaving must not let a pending step navigate
watch([active, org], cancelPendingStep);
onBeforeUnmount(cancelPendingStep);
// on failure the card goes back to `fallback`, so card and page agree
const showStep = async (fallback: number) => {
  if (!current.value) return;
  const request = ++stepRequest;
  navigating.value = true;
  try {
    const to = await resolveTourTarget(org.value, current.value.id);
    // a newer step was requested while this one resolved
    if (request !== stepRequest) return;
    const target = router.resolve(to);
    const logsToLogs = target.name === "logs" && route.name === "logs";
    // Logs reads its URL only on mount and the tour survives a reload, but a sample load would not
    if (logsToLogs && session.status.value !== "loading") window.location.assign(target.href);
    else {
      await router.push(to);
      if (logsToLogs) requestLogsReapply(true);
    }
  } catch {
    if (request === stepRequest) {
      session.setTourIndex(fallback);
      toast({ variant: "error", message: t("sampleData.tour.stepFailed") });
    }
  } finally {
    if (request === stepRequest) navigating.value = false;
  }
};

const next = async () => {
  const from = index.value;
  session.setTourIndex(nextIndex.value);
  if (current.value) await showStep(from);
  else cancelPendingStep();
};

const back = async () => {
  const from = index.value;
  session.setTourIndex(previousIndex.value ?? from);
  if (current.value) await showStep(from);
};

const restart = async () => {
  const from = index.value;
  session.setTourIndex(0);
  await showStep(from);
};

const connectOwnData = () => {
  session.stopTour();
  router.push({ name: "recommended", query: { org_identifier: org.value } }).catch(() => {});
};

// once the org has data of its own the demo has served its purpose; Home offers the cleanup
watch(
  () => active.value && tour.value?.ownData === false && presence.hasRealData.value,
  (stale) => stale && session.stopTour(),
);
</script>
