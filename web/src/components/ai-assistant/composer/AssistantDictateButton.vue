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
  <AssistantIconButton
    :label="t('assistant.voice.dictate')"
    :icon="glyph"
    :size="BAR_CONTROL_SIZE"
    :pressed="phase === 'listening' || phase === 'processing'"
    :loading="phase === 'requesting' || phase === 'processing'"
    :disabled="CROSSED.has(phase)"
    :disabled-reason="disabledReason"
    :class="TONE[phase] ?? ''"
    :data-phase="phase"
    data-test="assistant-dictate"
    @click="(event: MouseEvent) => emit('press', event)"
  >
    <template #tooltip>{{ tooltip }}</template>
  </AssistantIconButton>
</template>

<script lang="ts">
import type { DictationPhase } from "./useAssistantVoice";
import type { I18nText } from "@/types/i18n";

export interface AssistantDictateButtonProps {
  /** The one state machine every composer shows the mic from (D2). */
  phase: DictationPhase;
  /** Why a crossed mic cannot start; it stays focusable so the reason can be read. */
  disabledReason?: I18nText;
}

export interface AssistantDictateButtonEmits {
  (e: "press", event: MouseEvent): void;
}

const CROSSED: ReadonlySet<DictationPhase> = new Set(["denied", "unavailable", "off"]);

const TONE: Partial<Record<DictationPhase, string>> = {
  listening: "text-status-error-text!",
  denied: "text-status-error-text!",
};
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { raw, useI18nTyped } from "@/types/i18n";

import { BAR_CONTROL_SIZE } from "./AssistantComposerBottomRow.vue";
import { holdKeys } from "./useAssistantVoice";

const props = withDefaults(defineProps<AssistantDictateButtonProps>(), {
  disabledReason: undefined,
});

const emit = defineEmits<AssistantDictateButtonEmits>();

const { t } = useI18nTyped();

const glyph = computed(() => {
  if (props.phase === "listening" || props.phase === "processing") return assistantGlyph.stop;
  return CROSSED.has(props.phase) ? assistantGlyph.dictateOff : assistantGlyph.dictate;
});

const tooltip = computed(() => {
  if (props.phase === "off") return t("assistant.voice.offAdmin");
  return props.phase === "listening"
    ? t("assistant.voice.stopTooltip")
    : t("assistant.voice.tooltip", { keys: raw(holdKeys()) });
});
</script>
