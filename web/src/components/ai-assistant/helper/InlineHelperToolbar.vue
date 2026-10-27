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
    :class="[
      'flex min-w-0 shrink-0 flex-wrap items-center gap-2',
      inline ? 'self-start px-1 pt-0.5' : 'justify-end px-1 py-0.5',
      inline && reserveEnd && 'me-10',
    ]"
    :data-host="hostId"
    :data-layout="inline ? 'inline' : 'row'"
    data-test="inline-helper-toolbar"
  >
    <AiLabel
      v-if="label"
      :state="label"
      :class="inline ? undefined : 'me-auto'"
      @revert="(target) => emit('revert', target)"
      @ask-again="(prompt) => emit('ask-again', prompt)"
    />
    <AiEntryButton
      verb="generate_query"
      entry-kind="editor_button"
      object-kind="query"
      :build="noPayload"
      :label="t('assistant.helper.door')"
      :tooltip="t('assistant.helper.doorTooltip')"
      :shortcut-id="dockOpen ? undefined : 'assistantHelper'"
      :disabled-reason="blocked ?? undefined"
      :handoff="() => emit('open')"
      data-test="ai-entry-query-generate"
    />
    <span class="sr-only" role="status" data-test="inline-helper-door-status">{{ status }}</span>
  </div>
</template>

<script lang="ts">
import type { AiLabelState, ProposalHostId } from "@/composables/assistant/pure";
import type { I18nText } from "@/types/i18n";

export interface InlineHelperToolbarProps {
  hostId?: ProposalHostId;
  label: AiLabelState | null;
  dockOpen: boolean;
  blocked: I18nText | null;
  status: I18nText;
  /** Beside the editor instead of a row above it, for hosts whose editor pane cannot grow. */
  inline?: boolean;
  /** Leaves room for a host button pinned to the editor's end corner. */
  reserveEnd?: boolean;
}

export interface InlineHelperToolbarEmits {
  (e: "open"): void;
  (e: "revert", target: "assistant" | "original"): void;
  (e: "ask-again", prompt: string): void;
}
</script>

<script setup lang="ts">
import AiEntryButton from "@/components/ai-assistant/entry/AiEntryButton.vue";
import AiLabel from "@/components/ai-assistant/entry/AiLabel.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<InlineHelperToolbarProps>(), {
  hostId: undefined,
  inline: false,
  reserveEnd: false,
});
const emit = defineEmits<InlineHelperToolbarEmits>();

const { t } = useI18nTyped();
const noPayload = () => undefined;
</script>
