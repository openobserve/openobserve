<!-- Copyright 2026 OpenObserve Inc.

  Tool definitions for one variant. The Playground never executes a tool — when
  the model issues a call, the call itself is the output and the run stops. That
  is stated in the dialog because it is the surprising part, and it is a product
  decision rather than a gap.
-->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('aiObservability.playground.toolsTitle')"
    :primary-button-label="t('common.apply')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!!invalidIndex"
    data-test="ai-playground-tools-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="apply"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.toolsIntro") }}
      </p>

      <p
        v-if="!draft.length"
        class="border-border-default rounded-default text-text-secondary m-0 border border-dashed px-3 py-4 text-center text-xs"
      >
        {{ t("aiObservability.playground.toolsEmpty") }}
      </p>

      <div
        v-for="(tool, index) in draft"
        :key="index"
        class="border-border-default rounded-default flex flex-col gap-2 border px-3 py-2.5"
        :data-test="`ai-playground-tool-${index}`"
      >
        <div class="flex items-end gap-2">
          <OInput
            class="min-w-0 flex-1"
            :model-value="tool.name"
            :label="t('aiObservability.playground.toolName')"
            :placeholder="t('aiObservability.playground.toolNamePlaceholder')"
            size="sm"
            :data-test="`ai-playground-tool-name-${index}`"
            @update:model-value="(value: string | number) => set(index, { name: String(value) })"
          />
          <OButton
            variant="ghost-destructive"
            size="icon-md"
            icon-left="delete"
            :title="t('aiObservability.playground.removeTool')"
            :data-test="`ai-playground-tool-remove-${index}`"
            @click="remove(index)"
          />
        </div>
        <OInput
          :model-value="tool.description"
          :label="t('aiObservability.playground.toolDescription')"
          :placeholder="t('aiObservability.playground.toolDescriptionPlaceholder')"
          size="sm"
          :data-test="`ai-playground-tool-description-${index}`"
          @update:model-value="
            (value: string | number) => set(index, { description: String(value) })
          "
        />
        <OTextarea
          :model-value="tool.parameters"
          :label="t('aiObservability.playground.toolParameters')"
          :help-text="t('aiObservability.playground.toolParametersHelp')"
          :placeholder="t('aiObservability.playground.toolParametersPlaceholder')"
          :rows="4"
          size="sm"
          fill
          :error="invalidIndex === index + 1"
          :error-message="t('aiObservability.playground.toolInvalidJson')"
          :data-test="`ai-playground-tool-parameters-${index}`"
          @update:model-value="(value: string) => set(index, { parameters: value })"
        />
      </div>

      <OButton
        variant="outline"
        size="sm"
        icon-left="add"
        class="self-start"
        data-test="ai-playground-tool-add"
        @click="add"
      >
        {{ t("aiObservability.playground.addTool") }}
      </OButton>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import type { PlaygroundTool } from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{ open: boolean; tools: PlaygroundTool[] }>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  apply: [tools: PlaygroundTool[]];
}>();

const { t } = useI18nTyped();

const draft = ref<PlaygroundTool[]>([]);

// Edits are local until Apply, so Cancel really discards.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) draft.value = props.tools.map((tool) => ({ ...tool }));
  },
  { immediate: true },
);

/** 1-based index of the first tool with unparseable parameters, or 0. */
const invalidIndex = computed(() => {
  for (let index = 0; index < draft.value.length; index += 1) {
    const parameters = draft.value[index].parameters.trim();
    if (!parameters) continue;
    try {
      JSON.parse(parameters);
    } catch {
      return index + 1;
    }
  }
  return 0;
});

function set(index: number, changes: Partial<PlaygroundTool>) {
  draft.value = draft.value.map((tool, position) =>
    position === index ? { ...tool, ...changes } : tool,
  );
}

function add() {
  draft.value = [...draft.value, { name: "", description: "", parameters: "" }];
}

function remove(index: number) {
  draft.value = draft.value.filter((_, position) => position !== index);
}

function apply() {
  // An unnamed tool cannot be called, so it is not a tool.
  emit(
    "apply",
    draft.value.filter((tool) => tool.name.trim().length > 0),
  );
  emit("update:open", false);
}
</script>
