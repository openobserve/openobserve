<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * "This recording found no test attributes" — the misconfiguration that is
 * otherwise silent.
 *
 * The recorder selects on ONE configured DOM attribute. Playwright defaults to
 * `data-testid`; O2's own frontend uses `data-test`; a customer may use
 * `data-qa`, `data-cy` or `data-automation-id`. When the configured attribute is
 * not the one the application uses, upstream's generator produces NO
 * `test_attribute` candidates at all and every step quietly degrades to
 * role/text/css — the least stable ranks — with no error anywhere.
 *
 * The signal is unambiguous and cheap: a journey against a page that has test
 * attributes will produce at least one `test_attribute` candidate. Zero across
 * an entire recording means the recorder was looking for the wrong attribute, or
 * the application genuinely has none — and both are worth saying out loud rather
 * than discovering months later when a locator rots.
 *
 * Deliberately not an error: a page really may have no test attributes, and the
 * journey still works. This tells the author what they are trading away.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  steps: BrowserStep[];
  /** The attribute the recording actually used, for the message. */
  testIdAttr: string;
}>();

const { t } = useI18n();

const dismissed = ref(false);

/** Steps that identify an element at all — a navigate has nothing to find. */
const locatorSteps = computed(() =>
  props.steps.filter((s) => (s.locator?.candidates?.length ?? 0) > 0),
);

const hasTestAttribute = computed(() =>
  locatorSteps.value.some((s) => s.locator!.candidates.some((c) => c.kind === "test_attribute")),
);

const show = computed(
  () => !dismissed.value && locatorSteps.value.length > 0 && !hasTestAttribute.value,
);
</script>

<template>
  <div
    v-if="show"
    class="rounded-default border-border-default mb-3 flex items-start gap-2 border px-3 py-2"
    data-test="synthetics-journey-testid-misconfigured"
  >
    <OIcon
      name="warning"
      size="sm"
      class="text-status-warning-text mt-0.5 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="text-text-body text-sm font-medium">
        {{ t("synthetics.journey.testIdMissingTitle") }}
      </span>
      <span class="text-text-secondary text-xs">
        {{ t("synthetics.journey.testIdMissingDescription", { attr: testIdAttr }) }}
      </span>
    </div>
    <OButton
      variant="ghost"
      size="xs"
      data-test="synthetics-journey-testid-misconfigured-dismiss"
      @click="dismissed = true"
    >
      {{ t("synthetics.journey.testIdMissingDismiss") }}
    </OButton>
  </div>
</template>
