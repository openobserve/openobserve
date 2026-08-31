<!-- Copyright 2026 OpenObserve Inc.

  Editor-bench INPUT strip: one field per `{{variable}}` the messages reference,
  plus the dataset-sampling controls.

  The expected output is deliberately NOT here. It is not an input — the model
  never sees it — so it lives with the outputs it is compared against, in
  PlaygroundExpectedBar. What stays is the warning for a message that references
  `{{expected_output}}`, which is a prompt mistake and so belongs beside the
  prompt's own variables.
-->
<template>
  <div
    class="border-border-default flex flex-wrap items-start gap-2.5 border-b px-4 py-2.5"
    data-test="ai-playground-variable-bar"
  >
    <OTag
      v-if="provenance"
      variant="default"
      size="sm"
      class="self-center"
      :label="provenance.label"
      data-test="ai-playground-provenance"
    />

    <!-- The walker is what replaces the row table: spot-check the neighbouring
         items by stepping, without the page changing out from under you. -->
    <template v-if="sample">
      <span
        class="text-text-secondary self-center text-xs"
        data-test="ai-playground-sample-position"
      >
        {{
          t("aiObservability.playground.samplePosition", {
            dataset: sample.datasetName,
            index: sample.index + 1,
            total: sample.total,
          })
        }}
      </span>
      <div class="inline-flex items-stretch self-center">
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
        class="self-center"
        :title="t('aiObservability.playground.sampleClear')"
        data-test="ai-playground-sample-clear"
        @click="emit('clear-sample')"
      />
    </template>

    <OButton
      variant="outline"
      size="xs"
      class="self-center"
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
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  type PlaygroundProvenance,
  type PlaygroundSample,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  varNames: string[];
  vars: Record<string, string>;
  provenance: PlaygroundProvenance | null;
  sample: PlaygroundSample | null;
  stepping?: boolean;
}>();

const emit = defineEmits<{
  sample: [];
  "step-sample": [delta: number];
  "clear-sample": [];
}>();

const { t } = useI18nTyped();

const expectedToken = `{{${EXPECTED_OUTPUT_TOKEN}}}`;

const usesExpectedToken = computed(() => props.varNames.includes(EXPECTED_OUTPUT_TOKEN));
</script>
