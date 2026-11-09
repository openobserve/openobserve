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

<!-- The foot of every step's left column: Skip to App, pinned in view while the column scrolls.
     It carries the column's bottom gap, since a scroll container's padding would show rows below it.
     It is the step's primary button, unless the step has its own (`quiet`). -->
<template>
  <div class="bg-surface-base sticky bottom-0 mt-auto flex justify-end pt-6 pb-5">
    <OButton
      :variant="quiet ? 'outline' : 'primary'"
      icon-right="arrow-forward"
      :loading="skipping"
      data-test="onboarding-view-skip"
      @click="onSkip"
    >
      {{ t("onboarding.skipToApp") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { inject, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

import { ONBOARDING_SKIP } from "./onboardingFlow";

defineProps<{ quiet?: boolean }>();

const { t } = useI18nTyped();
const skip = inject(ONBOARDING_SKIP, async () => {});

const skipping = ref(false);
const onSkip = async () => {
  if (skipping.value) return;
  skipping.value = true;
  try {
    await skip();
  } finally {
    skipping.value = false;
  }
};
</script>
