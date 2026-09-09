<!-- Copyright 2026 OpenObserve Inc.

  One variant as a full column in the editor bench: header, config, output, run.

  The config scrolls and the output is pinned to the bottom, so the thing you
  are waiting for never scrolls out from under you while you edit the prompt.
  Run sits UNDER the output rather than up in the header: it is the control that
  fills the box directly above it, and a button beside its own result needs no
  explaining.

  The output region is always drawn, empty or not, so a result arriving never
  shifts the column it lands in.
-->
<template>
  <section
    class="border-border-default bg-surface-base rounded-surface @container/variant flex min-h-0 min-w-93.5 flex-1 snap-start flex-col overflow-hidden border"
    :data-test="`ai-playground-variant-${label}`"
  >
    <div class="border-border-default shrink-0 border-b px-2.5 py-1.5">
      <PlaygroundVariantHeader
        :variant="variant"
        :label="label"
        :providers="providers"
        :can-remove="canRemove"
        :can-duplicate="canDuplicate"
        @change="(next) => emit('change', next)"
        @duplicate="emit('duplicate')"
        @reset="emit('reset')"
        @remove="emit('remove')"
        @create-experiment="emit('create-experiment')"
      />
    </div>

    <!-- Draggable, because how much room the prompt versus the answer deserves
         changes with the task: a long system prompt and a one-line reply want
         the opposite split from a short prompt and a wall of JSON. -->
    <OSplitter
      v-model="split"
      horizontal
      :limits="[20, 80]"
      class="min-h-0 flex-1"
      separator-class="bg-transparent before:bg-border-default hover:before:bg-accent before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:transition-colors before:content-['']"
      :separator-style="{ height: '0.5rem', marginTop: '-0.25rem', marginBottom: '-0.25rem' }"
    >
      <template #before>
        <div class="h-full overflow-y-auto px-2.5 py-2.5">
          <PlaygroundVariantConfig
            :variant="variant"
            :var-names="varNames"
            :vars="vars"
            @change="(next) => emit('change', next)"
          />
        </div>
      </template>

      <template #after>
        <div class="flex h-full min-h-0 flex-col gap-2 px-2.5 py-2.5">
          <!-- The actions ride on the label row rather than under the answer:
               below the text they sat wherever the answer happened to end, and
               a long one pushed them out of sight entirely. -->
          <div class="flex shrink-0 items-center gap-1.5">
            <span
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >
              {{ t("aiObservability.playground.output") }}
            </span>
            <div class="grow" />
            <template v-if="cell?.status === 'done'">
              <OButton
                variant="ghost-muted"
                size="icon-xs"
                icon-left="content-copy"
                :title="t('aiObservability.playground.copyOutput')"
                :data-test="`ai-playground-output-copy-${label}`"
                @click="emit('copy')"
              />
              <OButton
                variant="ghost-muted"
                :size="cell.toolCall ? 'xs' : 'icon-xs'"
                icon-left="chat"
                :title="
                  cell.toolCall
                    ? t('aiObservability.playground.toolCallContinueTooltip')
                    : t('aiObservability.playground.addToMessagesTooltip')
                "
                :data-test="`ai-playground-output-add-to-messages-${label}`"
                @click="emit('add-to-messages')"
              >
                <span v-if="cell.toolCall">
                  {{ t("aiObservability.playground.toolCallAddToMessages") }}
                </span>
              </OButton>
              <OButton
                variant="ghost-muted"
                size="icon-xs"
                icon-left="science"
                :title="t('aiObservability.playground.createExperiment')"
                :data-test="`ai-playground-output-create-experiment-${label}`"
                @click="emit('create-experiment')"
              />
            </template>
          </div>
          <div
            class="border-border-default rounded-default bg-surface-subtle min-h-24 min-w-0 flex-1 overflow-y-auto px-2.5 py-2"
          >
            <PlaygroundOutputCell
              :cell="cell"
              :data-test="`ai-playground-output-${label}`"
              @retry="emit('run')"
            />
          </div>
        </div>
      </template>
    </OSplitter>

    <!-- Outside the splitter: dragging the panes must never be able to push Run
         off the bottom of the column. -->
    <div class="border-border-default shrink-0 border-t px-2.5 py-2.5">
      <p
        v-if="runDisabledReason"
        class="text-text-secondary mt-0 mb-1.5 text-center text-xs"
        :data-test="`ai-playground-run-disabled-reason-${label}`"
      >
        {{ runDisabledReason }}
      </p>
      <OButton
        v-if="running"
        variant="cancel-query"
        size="sm-action"
        class="w-full"
        :data-test="`ai-playground-variant-cancel-${label}`"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        v-else
        variant="primary"
        size="sm-action"
        class="w-full"
        :disabled="runDisabled"
        :data-test="`ai-playground-variant-submit-${label}`"
        @click="emit('run')"
      >
        {{ t("aiObservability.playground.runVariant") }}
      </OButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import PlaygroundOutputCell from "./PlaygroundOutputCell.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import PlaygroundVariantConfig from "./PlaygroundVariantConfig.vue";
import PlaygroundVariantHeader from "./PlaygroundVariantHeader.vue";
import type {
  PlaygroundCell,
  PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";

const props = withDefaults(
  defineProps<{
    variant: PlaygroundVariant;
    label: string;
    cell: PlaygroundCell | undefined;
    providers: Provider[];
    varNames: string[];
    vars: Record<string, string>;
    running?: boolean;
    runDisabled?: boolean;
    canRemove?: boolean;
    canDuplicate?: boolean;
    /** Baseline output text, when this column should render as a change. */
  }>(),
  {
    running: false,
    runDisabled: false,
    canRemove: true,
    canDuplicate: true,
  },
);

const { t } = useI18nTyped();

const runDisabledReason = computed(() => {
  if (!props.runDisabled) return "";
  const incompleteTool = props.variant.messages.find(
    (message) =>
      message.role === "tool" &&
      (!message.toolName?.trim() || !message.toolArguments?.trim() || !message.content.trim()),
  );
  if (!incompleteTool) return "";
  if (!incompleteTool.toolName?.trim() || !incompleteTool.toolArguments?.trim()) {
    return t("aiObservability.playground.toolSetupRequired");
  }
  return t("aiObservability.playground.toolResultRequired");
});

/** Percent of the column given to the config. Per column and not persisted —
 *  it is a reading preference for the moment, not part of the draft. */
const split = ref(60);

const emit = defineEmits<{
  change: [variant: PlaygroundVariant];
  run: [];
  cancel: [];
  duplicate: [];
  reset: [];
  remove: [];
  copy: [];
  "add-to-messages": [];
  "create-experiment": [];
}>();
</script>
