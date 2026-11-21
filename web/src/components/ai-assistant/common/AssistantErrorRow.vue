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
  <div :data-test="dataTest" :data-tone="tone" class="flex min-w-0 items-start gap-2">
    <span
      aria-hidden="true"
      :class="['inline-flex shrink-0 items-center pt-0.5', TONE_INK[tone]]"
      data-test="assistant-error-row-icon"
    >
      <OIcon :name="TONE_GLYPH[tone]" size="sm" />
    </span>
    <OText variant="body" class="min-w-0 flex-1 break-words" data-test="assistant-error-row-text">
      <slot>{{ message }}</slot>
    </OText>
    <div v-if="retryable || $slots.actions" class="flex shrink-0 items-center gap-1">
      <slot name="actions" />
      <AssistantIconButton
        v-if="retryable"
        :icon="assistantGlyph.regenerate"
        :label="retryLabel ?? t('assistant.outcome.retry')"
        :loading="retrying"
        :disabled="retrying"
        :data-test="`${dataTest}-retry`"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantIconButton from "./AssistantIconButton.vue";
import { assistantGlyph } from "./glyphs";

const TONE_GLYPH = { failed: assistantGlyph.failed, refused: assistantGlyph.refused } as const;
const TONE_INK = {
  failed: "text-assistant-signal-failed",
  refused: "text-text-secondary",
} as const;

withDefaults(
  defineProps<{
    /** The sentence; the default slot replaces it when the text carries a link. */
    message?: I18nText;
    /** `failed` for errors, `refused` for a policy or limit answer that is not a fault. */
    tone?: "failed" | "refused";
    retryable?: boolean;
    retryLabel?: I18nText;
    /** The retry is in flight: the button spins and ignores clicks. */
    retrying?: boolean;
    dataTest?: string;
  }>(),
  {
    message: undefined,
    tone: "failed",
    retryable: false,
    retryLabel: undefined,
    retrying: false,
    dataTest: "assistant-error-row",
  },
);

const emit = defineEmits<{ (e: "retry"): void }>();

defineSlots<{ default?: () => unknown; actions?: () => unknown }>();

const { t } = useI18nTyped();
</script>
