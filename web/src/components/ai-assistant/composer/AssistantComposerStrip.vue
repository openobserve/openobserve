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
    class="flex h-7 min-h-7 min-w-0 items-center gap-1.5 overflow-hidden px-0.5 max-md:h-11 pointer-coarse:h-11"
    data-test="assistant-composer-strip"
  >
    <span
      v-if="notice"
      :title="notice.sentence"
      class="text-text-body flex min-w-0 items-center gap-1.5 text-xs leading-none font-medium whitespace-nowrap"
      data-test="assistant-composer-notice"
      :data-notice="notice.id"
    >
      <OIcon :name="TONE_GLYPH[notice.tone]" size="xs" :class="TONE_CLASS[notice.tone]" />
      <span aria-hidden="true" data-test="assistant-composer-notice-title">{{ notice.title }}</span>
      <template v-for="link in notice.links" :key="link.action">
        <span aria-hidden="true" class="text-text-secondary font-normal">·</span>
        <slot v-if="$slots[`link-${link.action}`]" :name="`link-${link.action}`" />
        <OButton
          v-else
          variant="ghost-primary"
          size="chip"
          class="h-auto! min-h-0! px-0! font-medium"
          :data-test="`assistant-composer-notice-${link.action}`"
          @click="emit('action', link.action)"
        >
          {{ link.label }}
        </OButton>
      </template>
      <span :id="sentenceId" class="sr-only">{{ notice.sentence }}</span>
    </span>
    <div v-else class="flex min-w-0 flex-1 items-center self-stretch overflow-hidden">
      <slot />
    </div>
    <span class="ms-auto flex flex-none items-center">
      <slot name="sees" />
    </span>
  </div>
</template>

<script lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

import type { ComposerNotice, NoticeAction, NoticeTone } from "./composerNotice";

export interface AssistantComposerStripProps {
  notice: ComposerNotice | null;
  /** Lets the field's `aria-describedby` point at the full sentence. */
  sentenceId?: string;
}

export interface AssistantComposerStripEmits {
  (e: "action", action: NoticeAction): void;
}

const TONE_GLYPH: Record<NoticeTone, IconName> = {
  warning: assistantGlyph.warning,
  info: assistantGlyph.info,
  success: assistantGlyph.done,
  paused: assistantGlyph.pause,
};

const TONE_CLASS: Record<NoticeTone, string> = {
  warning: "text-status-warning-text",
  info: "text-status-info-text",
  success: "text-status-success-text",
  paused: "text-text-secondary",
};
</script>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

withDefaults(defineProps<AssistantComposerStripProps>(), { sentenceId: undefined });

const emit = defineEmits<AssistantComposerStripEmits>();
</script>
