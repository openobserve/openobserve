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
    :on="pressed"
    :pressed="pressed"
    :disabled="mic === 'crossed'"
    :disabled-reason="disabledReason"
    :class="pressed ? ROUND_ACTION_CLASS : ''"
    data-test="assistant-dictate"
    @click="(event: MouseEvent) => emit('press', event)"
  >
    <template #tooltip>{{ tooltip }}</template>
  </AssistantIconButton>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantDictateButtonProps {
  /** `live` presses; `crossed` is unavailable and says why; `off` asks the composer to offer Turn on. */
  mic: "live" | "crossed" | "off";
  /** Dictating now: the slot becomes a filled round Stop in place; the name stays Dictate and `aria-pressed` says the state. */
  pressed: boolean;
  /** Why a crossed mic cannot start; it stays focusable so the reason can be read. */
  disabledReason?: I18nText;
}

export interface AssistantDictateButtonEmits {
  (e: "press", event: MouseEvent): void;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { raw, useI18nTyped } from "@/types/i18n";

import { ROUND_ACTION_CLASS } from "./AssistantComposerBottomRow.vue";
import { holdKeys } from "./useAssistantVoice";

const props = withDefaults(defineProps<AssistantDictateButtonProps>(), {
  disabledReason: undefined,
});

const emit = defineEmits<AssistantDictateButtonEmits>();

const { t } = useI18nTyped();

const glyph = computed(() => {
  if (props.pressed) return assistantGlyph.stop;
  return props.mic === "crossed" ? assistantGlyph.dictateOff : assistantGlyph.dictate;
});

const tooltip = computed(() => {
  if (props.mic === "off") return t("assistant.voice.offAdmin");
  return props.pressed
    ? t("assistant.voice.stopTooltip")
    : t("assistant.voice.tooltip", { keys: raw(holdKeys()) });
});
</script>
