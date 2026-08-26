<!-- Copyright 2026 OpenObserve Inc.

  ONE tool at a time — either a new one or an existing one opened from the
  Tools menu. The Playground never executes a tool: when the model issues a
  call, the call itself is the output and the run stops there, which is stated
  in the dialog because it is the surprising part.

  There is no list and no add button here. The Tools button means "add one",
  the menu beside it means "look at that one", so the dialog never has to ask
  which tool is being edited.
-->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="title"
    :primary-button-label="t('common.apply')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="invalid"
    data-test="ai-playground-tools-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="apply"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.toolsIntro") }}
      </p>

      <OInput
        :model-value="current.name"
        :label="t('aiObservability.playground.toolName')"
        :placeholder="t('aiObservability.playground.toolNamePlaceholder')"
        size="sm"
        data-test="ai-playground-tool-name"
        @update:model-value="(value: string | number) => set({ name: String(value) })"
      />
      <OInput
        :model-value="current.description"
        :label="t('aiObservability.playground.toolDescription')"
        :placeholder="t('aiObservability.playground.toolDescriptionPlaceholder')"
        size="sm"
        data-test="ai-playground-tool-description"
        @update:model-value="(value: string | number) => set({ description: String(value) })"
      />
      <OTextarea
        :model-value="current.parameters"
        :label="t('aiObservability.playground.toolParameters')"
        :help-text="t('aiObservability.playground.toolParametersHelp')"
        :placeholder="parametersPlaceholder"
        :rows="4"
        size="sm"
        :error="invalid"
        :error-message="t('aiObservability.playground.toolInvalidJson')"
        data-test="ai-playground-tool-parameters"
        @update:model-value="(value: string) => set({ parameters: value })"
      />

      <OButton
        v-if="index !== null"
        variant="ghost-destructive"
        size="sm"
        icon-left="delete"
        class="self-start"
        data-test="ai-playground-tool-remove"
        @click="remove"
      >
        {{ t("aiObservability.playground.removeTool") }}
      </OButton>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import type { PlaygroundTool } from "@/enterprise/views/AIObservability/playgroundDraft";

/** A JSON sample, not prose — and vue-i18n reads `{ … }` in a message as
 *  placeholder syntax, so holding it in the catalogue made the form throw at
 *  message-compile time. */
const parametersPlaceholder = raw('{ "type": "object", "properties": { … } }');

const props = defineProps<{
  open: boolean;
  tools: PlaygroundTool[];
  /** Position of the tool being edited, or null to define a new one. */
  index: number | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  apply: [tools: PlaygroundTool[]];
}>();

const { t } = useI18nTyped();

const current = ref<PlaygroundTool>(blankTool());

// Edits are local until Apply, so Cancel really discards.
watch(
  () => [props.open, props.index] as const,
  ([isOpen, index]) => {
    if (!isOpen) return;
    const existing = index === null ? null : props.tools[index];
    current.value = existing ? { ...existing } : blankTool();
  },
  { immediate: true },
);

const title = computed(() =>
  props.index === null
    ? t("aiObservability.playground.addTool")
    : raw(props.tools[props.index]?.name) || t("aiObservability.playground.toolUnnamed"),
);

const invalid = computed(() => {
  const parameters = current.value.parameters.trim();
  if (!parameters) return false;
  try {
    JSON.parse(parameters);
    return false;
  } catch {
    return true;
  }
});

function blankTool(): PlaygroundTool {
  return { name: "", description: "", parameters: "" };
}

function set(changes: Partial<PlaygroundTool>) {
  current.value = { ...current.value, ...changes };
}

function commit(tools: PlaygroundTool[]) {
  emit("apply", tools);
  emit("update:open", false);
}

function apply() {
  // An unnamed tool cannot be called, so it is not a tool. Applying one that
  // was never named is a cancel, and applying over an existing name clears it.
  const named = current.value.name.trim().length > 0;
  if (props.index === null) {
    commit(named ? [...props.tools, current.value] : [...props.tools]);
    return;
  }
  commit(
    props.tools.flatMap((tool, position) =>
      position === props.index ? (named ? [current.value] : []) : [tool],
    ),
  );
}

function remove() {
  commit(props.tools.filter((_, position) => position !== props.index));
}
</script>
