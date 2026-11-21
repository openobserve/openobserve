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
  <div
    v-if="count > 1"
    role="group"
    :aria-label="t('assistant.message.versionName', { n: current, count })"
    class="inline-flex items-center gap-0.5"
    data-test="assistant-version-picker"
  >
    <AssistantIconButton
      :label="t('assistant.message.previousVersion')"
      :icon="assistantGlyph.previous"
      :disabled="current <= 1"
      :disabled-reason="t('assistant.message.firstVersion')"
      data-test="assistant-version-prev"
      @click="select(current - 1)"
    />
    <OText variant="meta" nowrap aria-hidden="true" data-test="assistant-version-count">
      {{ t("assistant.message.versionOf", { n: current, count }) }}
    </OText>
    <AssistantIconButton
      :label="t('assistant.message.nextVersion')"
      :icon="assistantGlyph.next"
      :disabled="current >= count"
      :disabled-reason="t('assistant.message.latestVersion')"
      data-test="assistant-version-next"
      @click="select(current + 1)"
    />
  </div>
</template>

<!-- At either end the button stays focusable with its reason, so focus never drops to the page (EB-09 AC 12) -->
<script lang="ts">
export interface AssistantVersionPickerProps {
  /** 1-based attempt shown. */
  current: number;
  count: number;
}

export interface AssistantVersionPickerEmits {
  (e: "select", n: number): void;
}
</script>

<script setup lang="ts">
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<AssistantVersionPickerProps>();

const emit = defineEmits<AssistantVersionPickerEmits>();

const { t } = useI18nTyped();

function select(n: number): void {
  if (n < 1 || n > props.count || n === props.current) return;
  emit("select", n);
}
</script>
