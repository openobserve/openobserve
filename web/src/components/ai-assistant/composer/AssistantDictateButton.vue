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
  <OPopover
    :open="primerOpen"
    side="top"
    align="end"
    :aria-label="t('assistant.voice.primerTitle')"
    content-class="flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 p-3"
    @update:open="(open) => !open && emit('decline')"
  >
    <template #anchor>
      <AssistantIconButton
        :label="t('assistant.voice.dictate')"
        :icon="denied ? assistantGlyph.dictateOff : assistantGlyph.dictate"
        :pressed="pressed"
        :disabled="!!disabledReason"
        :disabled-reason="disabledReason"
        :no-tooltip="primerOpen"
        data-test="assistant-dictate"
        @click="(event) => emit('press', event)"
      >
        <template #tooltip>{{ tooltip }}</template>
      </AssistantIconButton>
    </template>
    <section class="flex flex-col gap-2" data-test="assistant-dictate-primer">
      <OText variant="card-title" as="h2">{{ t("assistant.voice.primerTitle") }}</OText>
      <OText variant="meta" as="p">{{ t("assistant.voice.primerBody") }}</OText>
      <OText v-if="sentence" variant="meta" as="p" data-test="assistant-dictate-primer-engine">
        {{ t("assistant.voice.primerEngine", { engineSentence: sentence }) }}
      </OText>
      <div class="flex justify-end gap-2">
        <OButton
          variant="ghost"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-dictate-primer-decline"
          @click="emit('decline')"
        >
          {{ t("assistant.voice.notNow") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-dictate-primer-accept"
          @click="emit('accept')"
        >
          {{ t("assistant.voice.continue") }}
        </OButton>
      </div>
    </section>
  </OPopover>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantDictateButtonProps {
  pressed: boolean;
  denied: boolean;
  primerOpen: boolean;
  /** The sentence naming where the audio goes. */
  sentence: I18nText | null;
  /** Why the mic cannot start now; it stays focusable so the reason can be read. */
  disabledReason?: I18nText;
}

export interface AssistantDictateButtonEmits {
  (e: "press", event: MouseEvent): void;
  (e: "accept"): void;
  (e: "decline"): void;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import { holdKeys } from "./useAssistantVoice";

const props = withDefaults(defineProps<AssistantDictateButtonProps>(), {
  disabledReason: undefined,
});

const emit = defineEmits<AssistantDictateButtonEmits>();

const { t } = useI18nTyped();

const tooltip = computed(() =>
  props.pressed
    ? t("assistant.voice.stopTooltip")
    : t("assistant.voice.tooltip", { keys: raw(holdKeys()) }),
);
</script>
