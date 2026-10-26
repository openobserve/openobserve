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

<!-- The brand panel beside each step: what the option under the pointer or focus gives the user.
     It fills its parent's height. -->
<template>
  <div
    :class="[
      'from-onboarding-panel-start to-onboarding-panel-end text-onboarding-panel-text flex h-full min-h-0 flex-col overflow-hidden bg-linear-to-b ps-14 pt-14 max-lg:ps-8 max-lg:pt-10',
      'rounded-surface pb-14 max-lg:pb-10',
    ]"
    data-test="onboarding-preview"
  >
    <!-- Every text this panel can show sits in one grid cell, and only the current one is visible.
         The cell takes the height of the tallest, at any width and in any language, so nothing
         below it moves while the text changes on hover. -->
    <div class="me-14 grid max-w-136 shrink-0 max-lg:me-8">
      <div
        v-for="(p, i) in texts"
        :key="i"
        :class="['col-start-1 row-start-1', i > 0 && 'invisible']"
        :aria-hidden="i > 0 || undefined"
      >
        <p class="text-onboarding-panel-text text-xs font-bold">{{ p.eyebrow }}</p>
        <h2
          class="text-onboarding-panel-text mt-1.5 text-2xl leading-tight font-semibold text-balance"
          :data-test="i === 0 ? 'onboarding-preview-title' : undefined"
        >
          {{ p.title }}
        </h2>
        <p v-if="p.text" class="text-onboarding-panel-text/90 mt-3.5 text-base">
          {{ p.text }}
        </p>
        <!-- A 10% white fill keeps white text at 4.5:1 on the panel's light-theme top. -->
        <ul v-if="p.signals" class="mt-4 flex flex-wrap gap-2">
          <li
            v-for="s in p.signals"
            :key="s"
            class="bg-onboarding-panel-text/10 text-onboarding-panel-text inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
            :data-test="i === 0 ? `onboarding-preview-signal-${s}` : undefined"
          >
            <OIcon :name="SIGNAL_ICONS[s]" size="sm" />
            {{ t(`onboarding.signals.${s}`) }}
          </li>
        </ul>
        <ul v-if="p.lines" class="mt-4 grid gap-2.5">
          <li v-for="line in p.lines" :key="line" class="flex items-start gap-2 text-base">
            <OIcon name="check" size="sm" class="mt-1 shrink-0" />
            <span>{{ line }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import { SIGNAL_ICONS, type OnboardingSignal } from "./onboardingChoices";

interface PreviewText {
  title: I18nText;
  eyebrow: I18nText;
  lines?: I18nText[];
  text?: I18nText;
  /** What the option collects, as chips under the text. */
  signals?: OnboardingSignal[];
}

const props = defineProps<{
  preview: PreviewText;
  /** The other texts hover can bring in. The text area keeps the tallest one's height. */
  reserve?: PreviewText[];
}>();

const { t } = useI18nTyped();

const texts = computed(() => [props.preview, ...(props.reserve ?? [])]);
</script>
