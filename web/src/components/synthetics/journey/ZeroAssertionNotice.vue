<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * The nudge for a journey that verifies nothing.
 *
 * A journey with no assertion can click its way through a broken application and
 * still report a pass — it proves the steps can be performed, not that the
 * application works. That is the failure mode where a monitor quietly stops
 * noticing anything, which is worse than a monitor that is obviously broken.
 *
 * It is a warning and not an error (spec P5.2.4). A monitor that only navigates
 * still proves the site answers, so refusing to save one would be wrong; but the
 * author should have to decline the assertion rather than never be offered it.
 *
 * Dismissible on purpose: an author who has decided is not told twice.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import { getUUIDv7 } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{ steps: BrowserStep[] }>();
const emit = defineEmits<{ "add-assertion": [value: BrowserStep] }>();

const { t } = useI18n();

const dismissed = ref(false);

const hasAssertion = computed(() => props.steps.some((s) => s.action === "assert"));
const show = computed(() => props.steps.length > 0 && !hasAssertion.value && !dismissed.value);

/**
 * The suggested assertion is the one whose absence causes the production
 * failures this design exists to fix: something on the post-login page is
 * visible. It is added empty rather than guessed at — the recorder cannot know
 * what "correct" means for an application, and no vendor pretends otherwise
 * (P5.2.1).
 */
function addAssertion() {
  emit("add-assertion", {
    id: getUUIDv7(true),
    action: "assert",
    name: t("synthetics.journey.assertionSuggestedName"),
    assertion: { kind: "element_visible" },
    code: "",
  });
  dismissed.value = true;
}
</script>

<template>
  <div
    v-if="show"
    class="rounded-surface bg-warning-50 mb-3 flex flex-col gap-2 border border-[var(--color-warning-300)] px-3 py-3"
    role="status"
    data-test="synthetics-journey-zero-assertion-notice"
  >
    <div class="flex items-center gap-2">
      <OIcon name="fact-check" size="sm" class="text-warning-600" aria-hidden="true" />
      <span class="text-text-heading text-sm font-semibold">
        {{ t("synthetics.journey.zeroAssertionTitle") }}
      </span>
    </div>
    <p class="text-text-secondary m-0 text-xs">
      {{ t("synthetics.journey.zeroAssertionDescription") }}
    </p>
    <div class="flex items-center gap-2">
      <OButton
        variant="primary"
        size="sm"
        data-test="synthetics-journey-add-assertion-btn"
        @click="addAssertion"
      >
        {{ t("synthetics.journey.zeroAssertionAdd") }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        data-test="synthetics-journey-zero-assertion-dismiss-btn"
        @click="dismissed = true"
      >
        {{ t("synthetics.journey.zeroAssertionDismiss") }}
      </OButton>
    </div>
  </div>
</template>
