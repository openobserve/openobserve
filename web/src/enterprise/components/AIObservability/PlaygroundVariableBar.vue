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

    <!-- Shared by every column, so they live here rather than being redrawn per
         bench where the repetition implied per-bench values. Schema stays in the
         column: a variant can run a provider that supports it beside one that
         does not. -->
    <div class="inline-flex items-stretch self-center">
      <OButton
        variant="outline"
        size="xs"
        icon-left="build"
        class="rounded-s-default! rounded-e-none!"
        data-test="ai-playground-tools-btn"
        @click="openTool(null)"
      >
        {{
          tools.length
            ? t("aiObservability.playground.toolsCount", { count: tools.length })
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
            data-test="ai-playground-tools-menu"
          >
            <OIcon name="arrow-drop-down" size="sm" />
          </OButton>
        </template>
        <ODropdownItem
          v-for="(tool, index) in tools"
          :key="index"
          icon-left="build"
          :data-test="`ai-playground-tool-item-${index}`"
          @select="openTool(index)"
        >
          {{ raw(tool.name) || t("aiObservability.playground.toolUnnamed") }}
          <!-- `.stop` keeps the row's own select from firing and opening the
               dialog for the tool that is being deleted. -->
          <template #icon-right>
            <OButton
              variant="ghost-destructive"
              size="icon-xs"
              icon-left="delete"
              class="ms-auto"
              :aria-label="t('aiObservability.playground.removeTool')"
              :data-test="`ai-playground-tool-remove-${index}`"
              @click.stop="removeTool(index)"
            />
          </template>
        </ODropdownItem>
        <ODropdownItem v-if="!tools.length" disabled data-test="ai-playground-tools-none">
          {{ t("aiObservability.playground.toolsEmpty") }}
        </ODropdownItem>

        <!-- Also here, not only on the split button's left half: someone who
             opened the list to see what exists is already looking for the way to
             add one, and the button that does it is behind them. -->
        <OSeparator v-if="tools.length" />
        <ODropdownItem icon-left="add" data-test="ai-playground-tool-add" @select="openTool(null)">
          {{ t("aiObservability.playground.addTool") }}
        </ODropdownItem>
      </ODropdown>
    </div>

    <PlaygroundVariablesMenu
      class="self-center"
      :var-names="varNames"
      :vars="vars"
      :used="usedVarNames"
      @set-var="(name, value) => emit('set-var', name, value)"
      @remove-var="(name) => emit('remove-var', name)"
    />

    <OButton
      variant="outline"
      size="xs"
      icon-left="table-chart"
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

    <PlaygroundToolsDialog
      v-model:open="toolsOpen"
      :tools="tools"
      :index="toolIndex"
      @apply="(next) => emit('set-tools', next)"
    />

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
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import PlaygroundToolsDialog from "./PlaygroundToolsDialog.vue";
import PlaygroundVariablesMenu from "./PlaygroundVariablesMenu.vue";
import {
  EXPECTED_OUTPUT_TOKEN,
  type PlaygroundProvenance,
  type PlaygroundSample,
  type PlaygroundTool,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  varNames: string[];
  vars: Record<string, string>;
  /** Referenced by at least one variant; the rest are declared but unused. */
  usedVarNames: string[];
  /** One list, shared by every column. */
  tools: PlaygroundTool[];
  provenance: PlaygroundProvenance | null;
  sample: PlaygroundSample | null;
  stepping?: boolean;
}>();

const emit = defineEmits<{
  "set-tools": [tools: PlaygroundTool[]];
  "set-var": [name: string, value: string];
  "remove-var": [name: string];
  sample: [];
  "step-sample": [delta: number];
  "clear-sample": [];
}>();

const toolsOpen = ref(false);
const toolIndex = ref<number | null>(null);

/** null defines a new tool; an index opens that one for viewing. */
function openTool(index: number | null) {
  toolIndex.value = index;
  toolsOpen.value = true;
}

function removeTool(index: number) {
  emit(
    "set-tools",
    props.tools.filter((_, at) => at !== index),
  );
}

const { t } = useI18nTyped();

const expectedToken = `{{${EXPECTED_OUTPUT_TOKEN}}}`;

const usesExpectedToken = computed(() => props.varNames.includes(EXPECTED_OUTPUT_TOKEN));
</script>
