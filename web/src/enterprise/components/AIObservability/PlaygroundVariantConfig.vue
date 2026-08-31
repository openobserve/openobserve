<!-- Copyright 2026 OpenObserve Inc.

  Everything about a variant except its output: provider, model, temperature,
  variable chips, messages, and the tools/schema entry points.

  Extracted because it appears twice — inline in the bench card, and inside a
  dialog when the compare table's column header is clicked. Same config, same
  component, so the two can never disagree about what a variant is.
-->
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-1.5">
      <!-- Schema stays per column while Tools and Variables moved above it: a
           variant can run a provider that supports structured output beside one
           that does not, so one shared schema would break the mixed bench. -->
      <OButton
        variant="outline"
        size="xs"
        icon-left="data-object"
        :data-test="`ai-playground-schema-btn-${variant.id}`"
        @click="schemaOpen = true"
      >
        {{
          variant.responseSchema
            ? t("aiObservability.playground.schemaOn")
            : t("aiObservability.playground.schema")
        }}
      </OButton>
    </div>

    <PlaygroundMessageList
      :variant="variant"
      :var-names="varNames"
      @update="onMessageUpdate"
      @remove="onMessageRemove"
      @add="onMessageAdd"
      @set-tool="onMessageToolChange"
      @set-role="onMessageRoleChange"
      @move="onMessageMove"
    />

    <PlaygroundSchemaDialog
      v-model:open="schemaOpen"
      :schema="variant.responseSchema"
      @apply="(responseSchema) => patch({ responseSchema })"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import PlaygroundMessageList from "./PlaygroundMessageList.vue";
import PlaygroundSchemaDialog from "./PlaygroundSchemaDialog.vue";
import {
  moveMessage,
  playgroundId,
  withRole,
  type PlaygroundRole,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";

const props = defineProps<{
  variant: PlaygroundVariant;
  providers: Provider[];
  /** Every `{{variable}}` on the bench, and the values they are bound to. */
  varNames: string[];
  vars: Record<string, string>;
}>();

const emit = defineEmits<{
  change: [variant: PlaygroundVariant];
}>();

const { t } = useI18nTyped();

const schemaOpen = ref(false);

function patch(changes: Partial<PlaygroundVariant>) {
  emit("change", { ...props.variant, ...changes });
}

function onMessageToolChange(messageId: string, toolName: string) {
  patch({
    messages: props.variant.messages.map((message) =>
      message.id === messageId ? { ...message, toolName } : message,
    ),
  });
}

function onMessageRoleChange(messageId: string, role: PlaygroundRole) {
  patch({
    messages: props.variant.messages.map((message) =>
      message.id === messageId ? withRole(message, role) : message,
    ),
  });
}

function onMessageMove(from: number, to: number) {
  patch({ messages: moveMessage(props.variant.messages, from, to) });
}

function onMessageUpdate(messageId: string, content: string) {
  patch({
    messages: props.variant.messages.map((message) =>
      message.id === messageId ? { ...message, content } : message,
    ),
  });
}

function onMessageRemove(messageId: string) {
  patch({ messages: props.variant.messages.filter((message) => message.id !== messageId) });
}

function onMessageAdd(role: PlaygroundRole) {
  patch({
    messages: [...props.variant.messages, { id: playgroundId("msg"), role, content: "" }],
  });
}
</script>
