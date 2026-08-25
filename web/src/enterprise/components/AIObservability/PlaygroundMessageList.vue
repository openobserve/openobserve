<!-- Copyright 2026 OpenObserve Inc.

  The role-tagged message editor for one variant. A message carried in from a
  trace is removable but not editable — you can drop it from the conversation,
  but rewriting it would misrepresent what the model actually saw.
-->
<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="message in variant.messages"
      :key="message.id"
      class="border-border-default rounded-default overflow-hidden border"
      :data-test="`ai-playground-message-${message.role}`"
    >
      <div
        class="border-border-default bg-surface-secondary flex items-center gap-1.5 border-b px-2 py-1"
      >
        <span class="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
          {{ roleLabel(message.role) }}
        </span>
        <span v-if="message.readonly" class="text-text-secondary text-2xs">
          {{ t("aiObservability.playground.readonlyMessage") }}
        </span>
        <div class="grow" />
        <OButton
          variant="ghost-muted"
          size="icon-xs"
          icon-left="close"
          :title="t('aiObservability.playground.removeMessage')"
          :data-test="`ai-playground-message-remove-${message.id}`"
          @click="emit('remove', message.id)"
        />
      </div>

      <div
        v-if="message.readonly"
        class="text-text-secondary px-2.5 py-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
      >
        {{ message.content }}
      </div>
      <OTextarea
        v-else
        :model-value="message.content"
        :placeholder="
          t('aiObservability.playground.messagePlaceholder', { role: roleLabel(message.role) })
        "
        :rows="message.role === 'system' ? 2 : 4"
        size="sm"
        fill
        autogrow
        :data-test="`ai-playground-message-input-${message.id}`"
        @update:model-value="(value: string) => emit('update', message.id, value)"
        @focus="onFocus(message.id, $event)"
      />
    </div>

    <div class="flex gap-1.5">
      <OButton
        variant="outline"
        size="xs"
        icon-left="add"
        data-test="ai-playground-add-user-message"
        @click="emit('add', 'user')"
      >
        {{ t("aiObservability.playground.addUserMessage") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        icon-left="add"
        data-test="ai-playground-add-assistant-message"
        @click="emit('add', 'assistant')"
      >
        {{ t("aiObservability.playground.addAssistantMessage") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import type {
  PlaygroundRole,
  PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

defineProps<{ variant: PlaygroundVariant }>();

const emit = defineEmits<{
  update: [messageId: string, content: string];
  remove: [messageId: string];
  add: [role: PlaygroundRole];
  /** The caret moved into this message — the variable chips insert here. */
  focus: [messageId: string, element: HTMLTextAreaElement];
}>();

const { t } = useI18nTyped();

const ROLE_LABELS = {
  system: "aiObservability.playground.roleSystem",
  user: "aiObservability.playground.roleUser",
  assistant: "aiObservability.playground.roleAssistant",
  tool: "aiObservability.playground.roleTool",
} as const;

function roleLabel(role: PlaygroundRole) {
  return t(ROLE_LABELS[role]);
}

function onFocus(messageId: string, event: FocusEvent) {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement) emit("focus", messageId, element);
}
</script>
