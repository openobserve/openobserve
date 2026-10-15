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
  <ODrawer
    :open="open"
    size="md"
    :title="t('autoobserve2.howItWorks.title')"
    :primary-button-label="t('autoobserve2.howItWorks.gotIt')"
    data-test="autoobserve2-how-it-works-drawer"
    @update:open="(v) => emit('update:open', v)"
    @click:primary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-6 pb-8">
      <p class="text-text-body text-base leading-relaxed">
        {{ t("autoobserve2.howItWorks.intro") }}
      </p>
      <ol class="flex flex-col gap-5">
        <li
          v-for="(step, i) in STEPS"
          :key="step.title"
          class="flex gap-4"
          :data-test="`autoobserve2-how-step-${i + 1}`"
        >
          <span
            class="bg-icon-chip-primary-bg text-icon-chip-primary-text flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          >
            {{ i + 1 }}
          </span>
          <div class="flex flex-col gap-1">
            <span class="text-text-heading text-base font-semibold">{{ t(step.title) }}</span>
            <p class="text-text-body text-sm leading-relaxed">{{ t(step.body) }}</p>
          </div>
        </li>
      </ol>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();

const STEPS: { title: I18nKey; body: I18nKey }[] = [
  { title: "autoobserve2.howItWorks.s1Title", body: "autoobserve2.howItWorks.s1" },
  { title: "autoobserve2.howItWorks.s2Title", body: "autoobserve2.howItWorks.s2" },
  { title: "autoobserve2.howItWorks.s3Title", body: "autoobserve2.howItWorks.s3" },
  { title: "autoobserve2.howItWorks.s4Title", body: "autoobserve2.howItWorks.s4" },
  { title: "autoobserve2.howItWorks.s5Title", body: "autoobserve2.howItWorks.s5" },
];
</script>
