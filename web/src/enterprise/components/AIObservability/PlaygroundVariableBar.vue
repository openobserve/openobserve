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

    <!-- The walker is what replaces the row table: spot-check the neighbouring
         items by stepping, without the page changing out from under you. -->
    <template v-if="sample">
      <span class="text-text-secondary text-xs" data-test="ai-playground-sample-position">
        {{
          t("aiObservability.playground.samplePosition", {
            dataset: sample.datasetName,
            index: sample.index + 1,
            total: sample.total,
          })
        }}
      </span>
      <div class="inline-flex items-stretch">
        <OButton
          variant="outline"
          size="icon-xs-sq"
          icon-left="chevron-left"
          class="rounded-s-default! rounded-e-none!"
          :disabled="stepping || sample.index <= 0"
          :title="t('aiObservability.playground.samplePrev')"
          data-test="ai-playground-sample-prev"
          @click="emit('step-sample', -1)"
        />
        <OButton
          variant="outline"
          size="icon-xs-sq"
          icon-left="chevron-right"
          class="rounded-e-default! rounded-s-none! border-s-0"
          :disabled="stepping || sample.index >= sample.total - 1"
          :title="t('aiObservability.playground.sampleNext')"
          data-test="ai-playground-sample-next"
          @click="emit('step-sample', 1)"
        />
      </div>
      <OButton
        variant="ghost-muted"
        size="icon-xs-sq"
        icon-left="close"
        :title="t('aiObservability.playground.sampleClear')"
        data-test="ai-playground-sample-clear"
        @click="emit('clear-sample')"
      />
    </template>

    <OButton
      variant="outline"
      size="xs"
      data-test="ai-playground-sample-btn"
      @click="emit('sample')"
    >
      {{
        sample
          ? t("aiObservability.playground.sampleAgain")
          : t("aiObservability.playground.sampleFromDataset")
      }}
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
  type PlaygroundSample,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  varNames: string[];
  vars: Record<string, string>;
  expected: string | null;
  provenance: PlaygroundProvenance | null;
  sample: PlaygroundSample | null;
  stepping?: boolean;
}>();

const emit = defineEmits<{
  "set-expected": [value: string | null];
  sample: [];
  "step-sample": [delta: number];
  "clear-sample": [];
}>();

const { t } = useI18nTyped();

const expectedToken = `{{${EXPECTED_OUTPUT_TOKEN}}}`;

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
