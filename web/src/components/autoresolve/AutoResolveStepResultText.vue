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
  <div class="flex min-w-0 flex-col items-start gap-1">
    <span
      v-if="expanded"
      class="text-compact wrap-anywhere whitespace-pre-wrap"
      data-test="autoresolve-step-card-result"
      >{{ text }}</span
    >
    <!-- Kept mounted while expanded so its observer re-measures the cut on collapse. -->
    <OTruncatedText
      v-show="!expanded"
      ref="clamp"
      as="span"
      :lines="RESULT_TEXT_LINES"
      :tooltip="false"
      class="text-compact wrap-anywhere whitespace-pre-wrap"
      :data-test="expanded ? undefined : 'autoresolve-step-card-result'"
      >{{ text }}</OTruncatedText
    >
    <OButton
      v-if="expanded || isTruncated"
      variant="ghost-primary"
      size="xs"
      :icon-right="expanded ? 'expand-less' : 'expand-more'"
      :aria-expanded="expanded"
      data-test="autoresolve-step-card-result-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? t("autoresolve.step.showLess") : t("autoresolve.step.showFullResult") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useIsTruncated } from "@/lib/overlay/Tooltip/useIsTruncated";
import { useI18nTyped } from "@/types/i18n";
import { RESULT_TEXT_LINES } from "@/utils/autoresolve/autoresolveText";

defineProps<{ text: string }>();

const { t } = useI18nTyped();

const expanded = ref(false);
const clamp = ref<ComponentPublicInstance | null>(null);
const clampEl = computed(() => (clamp.value?.$el as HTMLElement | undefined) ?? null);
// The cut depends on the card's width, so it is measured, not guessed from the text.
const { isTruncated } = useIsTruncated(clampEl, { clamp: true });
</script>
