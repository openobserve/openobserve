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

<script setup lang="ts">
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
  });
  dismissed.value = true;
}
</script>

<template>
  <div
    v-if="show"
    class="rounded-surface bg-badge-warning-soft-bg border-badge-warning-ol-border/50 mb-3 flex flex-col gap-2 border px-3 py-3"
    role="status"
    data-test="synthetics-journey-zero-assertion-notice"
  >
    <div class="flex items-center gap-2">
      <OIcon name="fact-check" size="sm" class="text-badge-warning-ol-text" aria-hidden="true" />
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
