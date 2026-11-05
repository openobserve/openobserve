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
    class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    data-dd-privacy="mask"
    data-test="ai-label-editor"
    :data-status="state.status"
  >
    <OPopover
      v-model:open="infoOpen"
      side="bottom"
      align="start"
      :aria-label="t('assistant.label.provenance')"
      privacy="mask"
    >
      <template #trigger>
        <OTag
          clickable
          variant="default-soft"
          shape="rounded"
          size="sm"
          :icon="assistantGlyph.assistant"
          :label="mdUp ? labelText : t('assistant.label.short')"
          :aria-label="tagName"
          :class="TOUCH_TARGET_CLASS"
          data-test="ai-label-tag"
        />
      </template>
      <div class="flex max-w-80 min-w-0 flex-col gap-2 p-3" data-test="ai-label-popover">
        <OText variant="label" as="p">{{ labelText }}</OText>
        <OText
          v-if="state.provenance.prompt"
          as="p"
          class="break-words"
          data-test="ai-label-prompt"
        >
          {{ raw(state.provenance.prompt) }}
        </OText>
        <OText v-if="state.provenance.stream" variant="meta" as="p" class="break-words">
          {{ t("assistant.context.chip.stream", { name: raw(state.provenance.stream) }) }}
        </OText>
        <OText v-if="state.provenance.range" variant="meta" as="p" class="break-words">
          {{ rangeLine }}
        </OText>
        <OText variant="meta" as="p" data-test="ai-label-accepted-at">{{ acceptedLine }}</OText>
        <div v-if="state.provenance.prompt" class="flex">
          <OButton
            variant="outline"
            size="sm"
            :class="TOUCH_TARGET_CLASS"
            data-test="ai-label-ask-again"
            @click="askAgain"
          >
            {{ t("assistant.label.askAgain") }}
          </OButton>
        </div>
      </div>
    </OPopover>
    <OButton
      v-if="state.status === 'written'"
      variant="ghost"
      size="sm"
      :icon-left="assistantGlyph.undo"
      :aria-label="t('assistant.label.revertName')"
      :class="TOUCH_TARGET_CLASS"
      data-test="ai-label-revert"
      @click="emit('revert', 'original')"
    >
      {{ t("assistant.label.revert") }}
    </OButton>
    <ODropdown v-else align="start">
      <template #trigger>
        <OButton
          variant="ghost"
          size="sm"
          :icon-left="assistantGlyph.undo"
          :aria-label="t('assistant.label.revertName')"
          :class="TOUCH_TARGET_CLASS"
          data-test="ai-label-revert"
        >
          {{ t("assistant.label.revert") }}
        </OButton>
      </template>
      <ODropdownItem
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="ai-label-revert-ai"
        @select="emit('revert', 'assistant')"
      >
        {{ t("assistant.label.revertAi") }}
      </ODropdownItem>
      <ODropdownItem
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="ai-label-revert-mine"
        @select="emit('revert', 'original')"
      >
        {{ t("assistant.label.revertMine") }}
      </ODropdownItem>
    </ODropdown>
    <OText v-if="state.note" variant="meta" class="min-w-0 break-words" data-test="ai-label-kept">
      {{ t(state.note) }}
    </OText>
  </div>
</template>

<script lang="ts">
import type { AiLabelState } from "@/composables/assistant";

export interface AiLabelProps {
  state: AiLabelState;
}

export interface AiLabelEmits {
  (e: "revert", target: "assistant" | "original"): void;
  /** The prompt that produced the text, for the host to ask with again. */
  (e: "ask-again", prompt: string): void;
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { rangeText } from "@/components/ai-assistant/evidence/evidenceText";
import { useAssistantName } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = defineProps<AiLabelProps>();
const emit = defineEmits<AiLabelEmits>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const { mdUp } = useBreakpoint();
const infoOpen = ref(false);

const labelText = computed(() =>
  props.state.status === "written"
    ? t("assistant.label.written", { product })
    : t("assistant.label.edited", { product }),
);

const rangeLine = computed(() => {
  const range = props.state.provenance.range;
  return range ? rangeText(range) : raw("");
});

// The accessible name starts with the visible short label, so voice control can target it.
const tagName = computed(() =>
  mdUp.value ? labelText.value : t("assistant.label.shortName", { label: labelText.value }),
);

const acceptedLine = computed(() =>
  t("assistant.label.acceptedAt", { time: raw(formatOrgTime(props.state.acceptedAt)) }),
);

function askAgain(): void {
  infoOpen.value = false;
  emit("ask-again", props.state.provenance.prompt);
}
</script>
