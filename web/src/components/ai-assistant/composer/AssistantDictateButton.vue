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
    :open="primerOpen || offOpen"
    side="top"
    align="end"
    :aria-label="offOpen ? t('assistant.voice.offAdmin') : t('assistant.voice.primerTitle')"
    :content-class="`${composerPopoverClass(layout.tight)} flex flex-col gap-2 p-3`"
    @update:open="onOpenChange"
  >
    <template #anchor>
      <AssistantIconButton
        :label="t('assistant.voice.dictate')"
        :icon="crossed ? assistantGlyph.dictateOff : assistantGlyph.dictate"
        :pressed="pressed"
        :disabled="mic === 'crossed'"
        :disabled-reason="disabledReason"
        :no-tooltip="primerOpen || offOpen"
        :aria-haspopup="crossed ? 'dialog' : undefined"
        class="h-7! w-7!"
        data-test="assistant-dictate"
        @click="onClick"
      >
        <template #tooltip>{{ tooltip }}</template>
      </AssistantIconButton>
    </template>
    <section v-if="offOpen" class="flex flex-col gap-2" data-test="assistant-dictate-off">
      <OText variant="card-title" as="h2">{{ t("assistant.voice.offAdmin") }}</OText>
      <div class="flex justify-end">
        <OButton
          variant="primary"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-dictate-turn-on"
          @click="turnOn"
        >
          {{ t("assistant.voice.turnOn") }}
        </OButton>
      </div>
    </section>
    <section v-else class="flex flex-col gap-2" data-test="assistant-dictate-primer">
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
  /** `live` presses; `crossed` is unavailable and says why; `off` offers Turn on to an admin. */
  mic: "live" | "crossed" | "off";
  pressed: boolean;
  primerOpen: boolean;
  /** The sentence naming where the audio goes. */
  sentence: I18nText | null;
  /** Why a crossed mic cannot start; it stays focusable so the reason can be read. */
  disabledReason?: I18nText;
}

export interface AssistantDictateButtonEmits {
  (e: "press", event: MouseEvent): void;
  (e: "accept"): void;
  (e: "decline"): void;
  (e: "turn-on"): void;
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import { composerPopoverClass, useComposerLayout } from "./composerUi";
import { holdKeys } from "./useAssistantVoice";

const props = withDefaults(defineProps<AssistantDictateButtonProps>(), {
  disabledReason: undefined,
});

const emit = defineEmits<AssistantDictateButtonEmits>();

const { t } = useI18nTyped();
const layout = useComposerLayout();
const offOpen = ref(false);

const crossed = computed(() => props.mic !== "live");

const tooltip = computed(() => {
  if (props.mic === "off") return t("assistant.voice.offAdmin");
  return props.pressed
    ? t("assistant.voice.stopTooltip")
    : t("assistant.voice.tooltip", { keys: raw(holdKeys()) });
});

function onClick(event: MouseEvent): void {
  if (props.mic === "off") offOpen.value = true;
  else emit("press", event);
}

function onOpenChange(open: boolean): void {
  if (open) return;
  if (offOpen.value) offOpen.value = false;
  else emit("decline");
}

// The mic turns live under the pointer, so the popover has nothing left to say.
function turnOn(): void {
  offOpen.value = false;
  emit("turn-on");
}
</script>
