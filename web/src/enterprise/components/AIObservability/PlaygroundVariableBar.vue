<!-- Copyright 2026 OpenObserve Inc.

  Editor-bench input strip: one field per `{{variable}}` the messages reference,
  an optional expected output, and the two controls that switch the bench into
  table mode.

  `{{expected_output}}` never gets a field here. It is not an input to the
  prompt — it is the answer the prompt is supposed to reach without seeing it.
-->
<template>
  <div
    class="border-border-default flex flex-wrap items-start gap-2.5 border-b px-4 py-2.5"
    data-test="ai-playground-variable-bar"
  >
    <p v-if="!promptVars.length" class="text-text-secondary m-0 self-center text-xs">
      {{ t("aiObservability.playground.noVariables", { token: variableToken }) }}
    </p>

    <div v-for="name in promptVars" :key="name" class="flex items-center gap-1.5">
      <span class="text-accent text-2xs shrink-0 font-mono font-semibold">
        {{ tokenFor(name) }}
      </span>
      <OInput
        class="w-60"
        :model-value="vars[name] ?? ''"
        :placeholder="t('aiObservability.playground.variablePlaceholder', { name })"
        size="sm"
        :data-test="`ai-playground-var-input-${name}`"
        @update:model-value="(value: string | number) => emit('set-var', name, String(value))"
      />
    </div>

    <OButton
      v-if="!showExpected"
      variant="ghost-primary"
      size="xs"
      class="self-center"
      :title="t('aiObservability.playground.expectedPlaceholder')"
      data-test="ai-playground-add-expected"
      @click="showExpected = true"
    >
      {{ t("aiObservability.playground.addExpected") }}
    </OButton>

    <div v-else class="flex items-center gap-1.5">
      <span class="text-text-secondary text-2xs shrink-0 font-mono font-semibold">
        {{ t("aiObservability.playground.expectedLabel") }}
      </span>
      <OInput
        class="w-72"
        :model-value="expected ?? ''"
        :placeholder="t('aiObservability.playground.expectedPlaceholder')"
        size="sm"
        data-test="ai-playground-expected-input"
        @update:model-value="(value: string | number) => emit('set-expected', String(value))"
      />
      <OButton
        variant="ghost-muted"
        size="icon-xs"
        icon-left="close"
        :title="t('aiObservability.playground.removeExpected')"
        data-test="ai-playground-remove-expected"
        @click="clearExpected"
      />
    </div>

    <div class="grow" />

    <OTag
      v-if="provenance"
      variant="default"
      size="sm"
      :label="provenance.label"
      data-test="ai-playground-provenance"
    />

    <OButton
      variant="outline"
      size="xs"
      data-test="ai-playground-sample-btn"
      @click="emit('sample')"
    >
      {{ t("aiObservability.playground.sampleFromDataset") }}
    </OButton>
    <OButton
      variant="outline"
      size="xs"
      icon-left="add"
      data-test="ai-playground-add-row-btn"
      @click="emit('add-row')"
    >
      {{ t("aiObservability.playground.addRow") }}
    </OButton>

    <p
      v-if="usesExpectedToken"
      class="text-status-warning-text text-2xs basis-full"
      data-test="ai-playground-expected-leak-warning"
    >
      {{ t("aiObservability.playground.expectedLeakWarning", { token: expectedToken }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  type PlaygroundProvenance,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  varNames: string[];
  vars: Record<string, string>;
  expected: string | null;
  provenance: PlaygroundProvenance | null;
}>();

const emit = defineEmits<{
  "set-var": [name: string, value: string];
  "set-expected": [value: string | null];
  sample: [];
  "add-row": [];
}>();

const { t } = useI18nTyped();

const variableToken = "{{variables}}";
const expectedToken = `{{${EXPECTED_OUTPUT_TOKEN}}}`;

function tokenFor(name: string) {
  return `{{${name}}}`;
}

const promptVars = computed(() => props.varNames.filter((name) => name !== EXPECTED_OUTPUT_TOKEN));

const usesExpectedToken = computed(() => props.varNames.includes(EXPECTED_OUTPUT_TOKEN));

const showExpected = ref(false);

// An expected value arriving from an entry param opens the field on its own.
watch(
  () => props.expected,
  (value) => {
    if (value) showExpected.value = true;
  },
  { immediate: true },
);

function clearExpected() {
  emit("set-expected", null);
  showExpected.value = false;
}
</script>
