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

<!-- Step 2: the rows of one choice. Hover or focus shows the row's text in the side panel. -->
<template>
  <div
    class="grid h-full grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-md:h-auto max-md:min-h-full max-md:grid-cols-1 md:grid-rows-1"
    data-test="onboarding-step-rows"
  >
    <section class="flex px-13 pt-8 max-md:px-4 max-md:pt-6 md:overflow-y-auto md:max-lg:px-8">
      <div class="mx-auto flex w-full max-w-176 flex-col">
        <div class="mb-2 flex min-h-8.5 items-center gap-3">
          <OButton
            variant="ghost-muted"
            size="sm"
            icon-left="arrow-back"
            data-test="onboarding-step-rows-back"
            @click="emit('back')"
          >
            {{ t("onboarding.back") }}
          </OButton>
          <span class="text-text-secondary text-compact">{{ choice.name }}</span>
        </div>
        <h1 class="text-text-heading text-2xl leading-tight font-semibold text-balance">
          {{ choice.question }}
        </h1>

        <ul class="mt-6 grid gap-2">
          <li v-for="row in choice.rows" :key="row.id">
            <OnboardingChoiceButton
              :icon="row.icon"
              :name="row.name"
              :description="row.description"
              :previewed="previewId === row.id"
              :data-test="`onboarding-step-rows-row-${row.id}`"
              @mouseenter="previewId = row.id"
              @focus="previewId = row.id"
              @click="emit('open', { row })"
            />
            <!-- Lines up with the row's text: the row's padding and icon, less the link's own padding. -->
            <OButton
              v-if="row.agent"
              variant="ghost-primary"
              size="xs"
              icon-left="terminal"
              class="ms-14 mt-0.5"
              :data-test="`onboarding-step-rows-agent-${row.id}`"
              @click="emit('agent')"
            >
              {{ t("onboarding.agentLink") }}
            </OButton>
          </li>
        </ul>
        <OnboardingStepFooter />
      </div>
    </section>

    <aside class="max-md:hidden" :aria-label="t('onboarding.whatYouGet')">
      <!-- Pinned at the top of the scroll area: the viewport minus the app header, the content card's
           bottom gap (0.5rem) and its top and bottom border hairlines. -->
      <!-- eslint-disable-next-line local/no-hardcoded-px -- the card's two hairline borders -->
      <div class="sticky top-0 h-[calc(100dvh-var(--navbar-height)-0.5rem-2px)]">
        <OnboardingPreview
          :preview="preview"
          :example="NO_SHOT_ROWS.has(`${choice.id}-${previewId}`) ? undefined : choice.id"
          :example-row="previewId"
          :reserve="reserve"
        />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

import OnboardingChoiceButton from "./OnboardingChoiceButton.vue";
import OnboardingPreview from "./OnboardingPreview.vue";
import { NO_SHOT_ROWS } from "./examples/onboardingExamples";
import type { OnboardingChoice, OnboardingRow } from "./onboardingChoices";
import OnboardingStepFooter from "./OnboardingStepFooter.vue";

const props = defineProps<{ choice: OnboardingChoice }>();
const emit = defineEmits<{ open: [payload: { row: OnboardingRow }]; back: []; agent: [] }>();

const { t } = useI18nTyped();

const previewId = ref(props.choice.rows[0].id);

// Every row's text, so the panel's text area never changes height on hover.
const reserve = computed(() =>
  props.choice.rows.map((r) => ({ eyebrow: props.choice.name, title: r.name, text: r.about })),
);

const preview = computed(() => {
  const row = props.choice.rows.find((r) => r.id === previewId.value) ?? props.choice.rows[0];
  return { eyebrow: props.choice.name, title: row.name, text: row.about };
});
</script>
