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
      <!-- Split button, same shape as SearchBar's Run Query. Two differences,
           both because these halves are OUTLINE rather than ghost: the divider
           is the shared border (an OSeparator between them would be a third
           line), and the right half drops its own with `border-s-0`. The `!` is
           load-bearing — OButton's `rounded-default` would otherwise win over
           the flattened inner edge. -->
      <div class="inline-flex items-stretch">
        <OButton
          variant="outline"
          size="xs"
          icon-left="function"
          class="rounded-s-default! rounded-e-none!"
          :data-test="`ai-playground-tools-btn-${variant.id}`"
          @click="openTool(null)"
        >
          {{
            variant.tools.length
              ? t("aiObservability.playground.toolsCount", { count: variant.tools.length })
              : t("aiObservability.playground.tools")
          }}
        </OButton>
        <ODropdown align="start" side="bottom">
          <template #trigger>
            <OButton
              variant="outline"
              size="icon-xs-sq"
              class="rounded-e-default! rounded-s-none! border-s-0"
              :aria-label="t('aiObservability.playground.tools')"
              :data-test="`ai-playground-tools-menu-${variant.id}`"
            >
              <OIcon name="arrow-drop-down" size="sm" />
            </OButton>
          </template>
          <ODropdownItem
            v-for="(tool, index) in variant.tools"
            :key="index"
            icon-left="function"
            :data-test="`ai-playground-tool-item-${index}`"
            @select="openTool(index)"
          >
            {{ raw(tool.name) || t("aiObservability.playground.toolUnnamed") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="!variant.tools.length"
            disabled
            :data-test="`ai-playground-tools-none-${variant.id}`"
          >
            {{ t("aiObservability.playground.toolsEmpty") }}
          </ODropdownItem>
        </ODropdown>
      </div>
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
      <PlaygroundVariablesMenu
        :variant="variant"
        :var-names="varNames"
        :vars="vars"
        @set-var="(name, value) => emit('set-var', name, value)"
        @remove-var="(name) => emit('remove-var', name)"
        @insert="onInsertToken"
      />
    </div>

    <PlaygroundMessageList
      :variant="variant"
      :var-names="varNames"
      @update="onMessageUpdate"
      @remove="onMessageRemove"
      @add="onMessageAdd"
      @focus="onMessageFocus"
      @set-tool="onMessageToolChange"
      @set-role="onMessageRoleChange"
      @move="onMessageMove"
    />

    <PlaygroundToolsDialog
      v-model:open="toolsOpen"
      :tools="variant.tools"
      :index="toolIndex"
      @apply="(tools) => patch({ tools })"
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
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import PlaygroundMessageList from "./PlaygroundMessageList.vue";
import PlaygroundSchemaDialog from "./PlaygroundSchemaDialog.vue";
import PlaygroundToolsDialog from "./PlaygroundToolsDialog.vue";
import PlaygroundVariablesMenu from "./PlaygroundVariablesMenu.vue";
import {
  insertTokenAt,
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
  "set-var": [name: string, value: string];
  "remove-var": [name: string];
}>();

const { t } = useI18nTyped();

const toolsOpen = ref(false);
const toolIndex = ref<number | null>(null);

/** null defines a new tool; an index opens that one for viewing. */
function openTool(index: number | null) {
  toolIndex.value = index;
  toolsOpen.value = true;
}
const schemaOpen = ref(false);

/** The textarea the caret is in, so a chip inserts where the user is looking. */
const focused = ref<{ messageId: string; element: HTMLTextAreaElement } | null>(null);

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
  if (focused.value?.messageId === messageId) focused.value = null;
  patch({ messages: props.variant.messages.filter((message) => message.id !== messageId) });
}

function onMessageAdd(role: PlaygroundRole) {
  patch({
    messages: [...props.variant.messages, { id: playgroundId("msg"), role, content: "" }],
  });
}

function onMessageFocus(messageId: string, element: HTMLTextAreaElement) {
  focused.value = { messageId, element };
}

/**
 * Insert at the caret when a message has focus; otherwise append to the last
 * editable user message, which is where a variable almost always belongs.
 */
function onInsertToken(name: string) {
  const token = `{{${name}}}`;
  const active = focused.value;

  if (active) {
    const message = props.variant.messages.find(
      (candidate) => candidate.id === active.messageId && !candidate.readonly,
    );
    if (message) {
      const { content, caret } = insertTokenAt(
        message.content,
        token,
        active.element.selectionStart ?? message.content.length,
        active.element.selectionEnd ?? message.content.length,
      );
      onMessageUpdate(message.id, content);
      requestAnimationFrame(() => {
        active.element.focus();
        active.element.setSelectionRange(caret, caret);
      });
      return;
    }
  }

  const target = [...props.variant.messages]
    .reverse()
    .find((message) => message.role === "user" && !message.readonly);
  if (!target) return;
  onMessageUpdate(
    target.id,
    target.content ? `${target.content.replace(/\s+$/, "")}\n${token}` : token,
  );
}
</script>
