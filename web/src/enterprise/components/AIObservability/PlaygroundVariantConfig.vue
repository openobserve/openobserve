<!-- Copyright 2026 OpenObserve Inc.

  Everything about a variant except its output: provider, model, temperature,
  variable chips, messages, and the tools/schema entry points.

  Extracted because it appears twice — inline in the bench card, and inside a
  dialog when the compare table's column header is clicked. Same config, same
  component, so the two can never disagree about what a variant is.
-->
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-start gap-2">
      <OSelect
        class="min-w-0 flex-1"
        :model-value="variant.providerId"
        :options="providerOptions"
        :label="t('aiObservability.playground.provider')"
        :placeholder="t('aiObservability.playground.providerPlaceholder')"
        size="sm"
        searchable
        :data-test="`ai-playground-provider-${variant.id}`"
        @update:model-value="(value: unknown) => patch({ providerId: String(value ?? '') })"
      />
      <OSelect
        class="min-w-0 flex-1"
        :model-value="variant.model"
        :options="modelOptions"
        :label="t('aiObservability.playground.model')"
        :placeholder="t('aiObservability.playground.modelPlaceholder')"
        :help-text="t('aiObservability.playground.modelHelp')"
        size="sm"
        searchable
        creatable
        clearable
        :data-test="`ai-playground-model-${variant.id}`"
        @update:model-value="(value: unknown) => patch({ model: String(value ?? '') })"
      />
      <OInput
        class="w-20 shrink-0"
        :model-value="variant.temperature"
        type="number"
        min="0"
        max="2"
        step="0.1"
        :label="t('aiObservability.playground.temperature')"
        size="sm"
        :data-test="`ai-playground-temperature-${variant.id}`"
        @update:model-value="(value: string | number) => patch({ temperature: String(value) })"
      />
    </div>

    <PlaygroundVariableChips :variant="variant" :fields="fields" @insert="onInsertToken" />

    <PlaygroundMessageList
      :variant="variant"
      @update="onMessageUpdate"
      @remove="onMessageRemove"
      @add="onMessageAdd"
      @focus="onMessageFocus"
    />

    <div class="flex flex-wrap gap-1.5">
      <OButton
        variant="outline"
        size="xs"
        :data-test="`ai-playground-tools-btn-${variant.id}`"
        @click="toolsOpen = true"
      >
        {{
          variant.tools.length
            ? t("aiObservability.playground.toolsCount", { count: variant.tools.length })
            : t("aiObservability.playground.tools")
        }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
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

    <p v-if="variant.stale" class="text-text-secondary m-0 text-xs">
      {{ t("aiObservability.playground.staleNote") }}
    </p>

    <PlaygroundToolsDialog
      v-model:open="toolsOpen"
      :tools="variant.tools"
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
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import PlaygroundMessageList from "./PlaygroundMessageList.vue";
import PlaygroundSchemaDialog from "./PlaygroundSchemaDialog.vue";
import PlaygroundToolsDialog from "./PlaygroundToolsDialog.vue";
import PlaygroundVariableChips from "./PlaygroundVariableChips.vue";
import {
  insertTokenAt,
  playgroundId,
  type PlaygroundRole,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";

const props = defineProps<{
  variant: PlaygroundVariant;
  providers: Provider[];
  /** Row fields in table mode; null in editor-bench mode. */
  fields: string[] | null;
}>();

const emit = defineEmits<{ change: [variant: PlaygroundVariant] }>();

const { t } = useI18nTyped();

const toolsOpen = ref(false);
const schemaOpen = ref(false);

/** The textarea the caret is in, so a chip inserts where the user is looking. */
const focused = ref<{ messageId: string; element: HTMLTextAreaElement } | null>(null);

/** Every config change marks the variant stale — the output on screen stops
 *  describing the config on screen the moment either one moves. */
function patch(changes: Partial<PlaygroundVariant>) {
  emit("change", { ...props.variant, ...changes, stale: true });
}

const providerOptions = computed(() =>
  props.providers.map((provider) => ({ label: raw(provider.name), value: provider.id })),
);

const modelOptions = computed(() => {
  const provider = props.providers.find((candidate) => candidate.id === props.variant.providerId);
  const models = provider?.availableModels ?? provider?.available_models ?? [];
  return models.map((model) => ({ label: raw(model), value: model }));
});

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
