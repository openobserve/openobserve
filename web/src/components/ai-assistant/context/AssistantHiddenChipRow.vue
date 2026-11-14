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
  <div class="flex min-w-0 items-center gap-1" data-test="assistant-context-hidden-row">
    <img
      v-if="imageSrc"
      :src="imageSrc"
      alt=""
      class="rounded-default size-4 shrink-0 object-cover"
    />
    <OIcon
      v-else
      :name="chip.withheldAt ? assistantGlyph.withheld : chipGlyph[chip.kind]"
      size="xs"
      class="text-text-secondary shrink-0"
    />
    <OTruncatedText class="min-w-0 flex-1 text-sm">{{ label }}</OTruncatedText>
    <AssistantIconButton
      :label="t('assistant.context.remove', { label: chip.label })"
      :icon="assistantGlyph.close"
      size="sm"
      data-test="assistant-context-hidden-remove"
      @click="emit('remove')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph, chipGlyph } from "@/components/ai-assistant/common/glyphs";
import type { ContextChip } from "@/composables/assistant";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{ chip: ContextChip; imageSrc?: string }>();
const emit = defineEmits<{ remove: [] }>();

const { t } = useI18nTyped();
const label = computed(() => String(props.chip.label));
</script>
