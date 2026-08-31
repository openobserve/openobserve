<!-- Copyright 2026 OpenObserve Inc.

  A variant's messages, and every edit that can be made to them.

  What used to sit above them — tools, variables — is shared by the whole bench
  and moved to the strip above it; the schema moved into the header beside the
  parameters it belongs with. What is left is the one thing that really is this
  column's own.
-->
<template>
  <div class="flex flex-col gap-3">
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
  </div>
</template>

<script setup lang="ts">
import PlaygroundMessageList from "./PlaygroundMessageList.vue";
import {
  moveMessage,
  playgroundId,
  withRole,
  type PlaygroundRole,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  variant: PlaygroundVariant;
  /** Every `{{variable}}` on the bench — the completion list offered after `{{`. */
  varNames: string[];
}>();

const emit = defineEmits<{
  change: [variant: PlaygroundVariant];
}>();

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
