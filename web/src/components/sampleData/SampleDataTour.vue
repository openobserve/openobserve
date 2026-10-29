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
          v-for="(step, i) in SAMPLE_TOUR_STEPS"
          :key="step.id"
          class="h-1 flex-1 rounded-full transition-colors"
          :class="i <= index ? 'bg-accent' : 'bg-border-default'"
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
            v-if="index > 0"
            variant="ghost"
            size="sm"
            icon-left="arrow-back"
            data-test="sample-tour-back"
            @click="session.setTourIndex(index - 1)"
          >
            {{ t("common.back") }}
          </OButton>
          <span class="flex-1" />
          <OButton
            :variant="onStepRoute ? 'outline' : 'primary'"
            size="sm"
            icon-left="open-in-new"
            :loading="navigating"
            data-test="sample-tour-show"
            @click="showStep"
          >
            {{ t("sampleData.tour.showMe") }}
          </OButton>
          <OButton
            :variant="onStepRoute ? 'primary' : 'outline'"
            size="sm"
            icon-right="arrow-forward"
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
            icon-left="rocket-launch"
            data-test="sample-tour-connect"
            @click="connectOwnData"
          >
            {{ t("sampleData.tour.finale.connect") }}
          </OButton>
          <div class="flex items-center justify-between gap-2">
            <OButton
              variant="ghost"
              size="sm"
              data-test="sample-tour-restart"
              @click="session.setTourIndex(0)"
            >
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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { useSampleDataPresence } from "@/composables/sampleData/useSampleDataPresence";
import {
  SAMPLE_TOUR_STEPS,
  resolveTourTarget,
  type SampleTourStep,
  type SampleTourStepId,
} from "@/utils/sampleData/tour";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const session = useSampleDataSession();
const tour = session.tour;
const navigating = ref(false);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const active = computed(() => !!tour.value && tour.value.org === org.value);
const presence = useSampleDataPresence(org, active);
const visible = computed(
  () => active.value && !presence.hasRealData.value && !store.state.kioskMode,
);
const index = computed(() => tour.value?.index ?? 0);
const current = computed<SampleTourStep | undefined>(() => SAMPLE_TOUR_STEPS[index.value]);
const onStepRoute = computed(
  () => !!current.value && current.value.routes.includes(String(route.name ?? "")),
);
const capabilities = computed(() => [...new Set(SAMPLE_TOUR_STEPS.map((s) => s.capability))]);

const positionLabel = computed(() =>
  current.value
    ? t("sampleData.tour.position", {
        current: raw(String(index.value + 1)),
        total: raw(String(SAMPLE_TOUR_STEPS.length)),
      })
    : t("sampleData.tour.done"),
);
const pillLabel = computed(() =>
  t("sampleData.tour.pill", {
    current: raw(String(index.value + 1)),
    total: raw(String(SAMPLE_TOUR_STEPS.length)),
  }),
);

const stepTitle = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.title`);
const stepBody = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.body`);
const stepLook = (id: SampleTourStepId): I18nText => t(`sampleData.tour.steps.${id}.look`);
const capabilityLabel = (cap: SampleTourStep["capability"]): I18nText =>
  t(`sampleData.tour.capabilities.${cap}`);

const showStep = async () => {
  if (!current.value) return;
  navigating.value = true;
  try {
    const to = await resolveTourTarget(org.value, current.value.id);
    const target = router.resolve(to);
    // Logs reads its query from the URL only on mount, and the tour itself survives a reload
    if (target.name === "logs" && route.name === "logs") window.location.assign(target.href);
    else await router.push(to);
  } catch {
    // a redundant navigation to the page already open is fine
  } finally {
    navigating.value = false;
  }
};

const next = async () => {
  session.setTourIndex(index.value + 1);
  if (current.value) await showStep();
};

const connectOwnData = () => {
  session.stopTour();
  router.push({ name: "recommended", query: { org_identifier: org.value } }).catch(() => {});
};

// once the org has data of its own the demo has served its purpose; Home offers the cleanup
watch(
  () => active.value && presence.hasRealData.value,
  (stale) => stale && session.stopTour(),
);
</script>
