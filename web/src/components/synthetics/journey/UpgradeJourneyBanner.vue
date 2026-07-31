<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * The in-place upgrade from a version-1 journey to version 2.
 *
 * This exists because saving is now refused for a journey containing a retired
 * action (spec Q-10): hard sleeps and unreplayable steps are the single largest
 * source of the flakiness the schema change exists to remove. Refusing without
 * offering the remedy would just be an error message, so the remedy is offered
 * right where the refusal happens (Q-10.b).
 *
 * The lift is previewed before it is applied (P2.6.3). Dropping a step or
 * removing a sleep is a real behaviour change, and an author should read it
 * before committing rather than discover it from a diff — which is exactly why
 * the lift is a pure function that can be run to produce a preview without a
 * round trip (D-11).
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import { liftJourney } from "@/utils/synthetics/liftJourney";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

const props = defineProps<{ steps: BrowserStep[] }>();
const emit = defineEmits<{ upgrade: [value: BrowserStep[]] }>();

const { t } = useI18n();

const preview = computed(() => liftJourney(props.steps));
const needsUpgrade = computed(() => !preview.value.noop);
const showDetail = ref(false);

function apply() {
  emit("upgrade", preview.value.steps);
  showDetail.value = false;
}
</script>

<template>
  <div
    v-if="needsUpgrade"
    class="rounded-surface bg-warning-50 mb-3 flex flex-col gap-2 border border-[var(--color-warning-300)] px-3 py-3"
    role="status"
    data-test="synthetics-journey-upgrade-banner"
  >
    <div class="flex items-center gap-2">
      <OIcon name="arrow-upward" size="sm" class="text-warning-600" aria-hidden="true" />
      <span class="text-text-heading text-sm font-semibold">
        {{ t("synthetics.journey.upgradeTitle") }}
      </span>
      <OBadge variant="default" size="sm">
        {{ t("synthetics.journey.upgradeChangeCount", { count: preview.changes.length }) }}
      </OBadge>
    </div>

    <p class="text-text-secondary m-0 text-xs">
      {{ t("synthetics.journey.upgradeDescription") }}
    </p>

    <ul
      v-if="showDetail"
      class="text-text-body m-0 flex list-disc flex-col gap-1 pl-4 text-xs"
      data-test="synthetics-journey-upgrade-changes"
    >
      <li v-for="(change, i) in preview.changes" :key="`${change.stepId}-${i}`">
        <span class="font-semibold">{{ change.stepName }}</span>
        — {{ change.detail }}
      </li>
    </ul>

    <div class="flex items-center gap-2">
      <OButton
        variant="primary"
        size="sm"
        data-test="synthetics-journey-upgrade-apply-btn"
        @click="apply"
      >
        {{ t("synthetics.journey.upgradeApply") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        data-test="synthetics-journey-upgrade-preview-btn"
        @click="showDetail = !showDetail"
      >
        {{
          showDetail ? t("synthetics.journey.upgradeHide") : t("synthetics.journey.upgradePreview")
        }}
      </OButton>
    </div>
  </div>
</template>
