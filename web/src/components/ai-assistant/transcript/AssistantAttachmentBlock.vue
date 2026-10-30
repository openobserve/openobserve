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
  <OTag
    v-if="hidden"
    type="assistantContext"
    value="hidden"
    :label="t('assistant.share.attachmentHidden')"
    data-test="assistant-attachment-hidden"
  />
  <div
    v-else
    class="border-border-default rounded-default min-w-0 border"
    data-test="assistant-attachment-block"
  >
    <OCollapsible
      v-model="open"
      trigger-class="min-h-8 px-2 max-md:min-h-11 pointer-coarse:min-h-11"
    >
      <template #trigger>
        <span class="flex min-w-0 flex-1 items-center gap-2 text-start">
          <OTruncatedText class="text-text-body min-w-0 text-xs font-medium">{{
            label
          }}</OTruncatedText>
          <OText variant="meta" class="shrink-0">{{ size }}</OText>
        </span>
      </template>
      <div class="p-2 pt-0">
        <OCodeBlock
          :code="code"
          :lang="isJson ? 'json' : 'plaintext'"
          :max-lines="12"
          wrap
          :scroll-label="label"
          :highlight-max-chars="ATTACHMENT_HIGHLIGHT_MAX_CHARS"
          :copy-button-class="TOUCH_TARGET_CLASS"
          contrast="aa"
          :copy-message="t('common.copySuccess')"
          data-test="assistant-attachment"
        />
      </div>
    </OCollapsible>
  </div>
</template>

<script lang="ts">
export interface AssistantAttachmentBlockProps {
  /** The block's name as written in the record, e.g. "Log Entry". */
  name: string;
  body: string;
  /** A share hid its attachments (CT-13 AC 3). */
  hidden?: boolean;
}

/** The user's own attachment highlights on the main thread with a linear grammar; past this it is plain text. */
export const ATTACHMENT_HIGHLIGHT_MAX_CHARS = 10_000;

// `30` §2.4: the names today's writers use; anything else shows as written.
const NAME_KEYS: Record<string, string> = {
  "log entry": "assistant.attachment.logEntry",
  cell: "assistant.attachment.cell",
  field: "assistant.attachment.field",
  span: "assistant.attachment.span",
  "query error": "assistant.attachment.queryError",
};

/** The `assistant.attachment.<name>` key of a block name, or `null` for a name no writer of ours uses. */
export function attachmentKey(name: string): string | null {
  return NAME_KEYS[name.trim().toLowerCase()] ?? null;
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatBytes } from "@/utils/formatters";

const props = withDefaults(defineProps<AssistantAttachmentBlockProps>(), { hidden: false });

const { t } = useI18nTyped();
const open = ref(false);

const label = computed(() => {
  const key = attachmentKey(props.name);
  return key ? t(key) : raw(props.name);
});

const parsed = computed<unknown>(() => {
  try {
    return JSON.parse(props.body);
  } catch {
    return undefined;
  }
});

const isJson = computed(() => parsed.value !== undefined);

const code = computed(() => (isJson.value ? JSON.stringify(parsed.value, null, 2) : props.body));

const size = computed(() => raw(formatBytes(new TextEncoder().encode(props.body).length)));
</script>
