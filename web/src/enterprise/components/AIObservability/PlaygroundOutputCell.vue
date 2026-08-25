<!-- Copyright 2026 OpenObserve Inc.

  One cell of output. Four states — idle, streaming, error, done — plus the
  tool-call variant, where the call itself IS the output and the run ended
  there.

  Nothing here is tinted by quality. With n ≤ 10 and no scoring, any red or
  green would be a verdict the bench cannot support; the only colour is run
  state.
-->
<template>
  <div class="flex flex-col gap-2" :data-test="dataTest">
    <!-- idle -->
    <p
      v-if="!cell || cell.status === 'idle'"
      class="text-text-secondary m-0 text-xs italic"
      data-test="ai-playground-output-idle"
    >
      {{
        compact
          ? t("aiObservability.playground.outputNotRun")
          : t("aiObservability.playground.outputPlaceholder")
      }}
    </p>

    <!-- error -->
    <template v-else-if="cell.status === 'error'">
      <OBanner
        variant="error"
        dense
        :content="raw(cell.error?.message)"
        data-test="ai-playground-output-error"
      />
      <div>
        <OButton
          variant="outline"
          size="xs"
          icon-left="refresh"
          data-test="ai-playground-output-retry"
          @click="emit('retry')"
        >
          {{ t("aiObservability.playground.retry") }}
        </OButton>
      </div>
    </template>

    <!-- tool call — terminal -->
    <div
      v-else-if="cell.toolCall"
      class="border-border-default rounded-default bg-surface-secondary flex flex-col gap-1.5 border px-2.5 py-2"
      data-test="ai-playground-output-tool-call"
    >
      <div class="flex flex-wrap items-center gap-2">
        <OTag variant="primary" size="sm" :label="t('aiObservability.playground.toolCall')" />
        <span class="text-text-heading font-mono text-xs font-semibold">
          {{ cell.toolCall.name }}
        </span>
        <span class="text-text-secondary text-2xs">
          {{ t("aiObservability.playground.toolCallNote") }}
        </span>
      </div>
      <pre
        class="border-border-default rounded-default bg-surface-base text-text-body m-0 overflow-x-auto border px-2.5 py-1.5 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
        >{{ cell.toolCall.name }}({{ cell.toolCall.arguments }})</pre>
    </div>

    <!-- streaming / done -->
    <template v-else>
      <div
        class="text-text-body font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
        :class="[stale ? 'opacity-40' : '', compact ? 'line-clamp-3' : '']"
        data-test="ai-playground-output-text"
      >
        {{ cell.text
        }}<span
          v-if="cell.status === 'streaming'"
          class="bg-accent ml-0.5 inline-block h-3 w-1.5 animate-pulse align-text-bottom"
        />
      </div>
    </template>

    <!-- usage — always secondary, never a signal -->
    <div
      v-if="cell?.usage && cell.status === 'done'"
      class="text-text-secondary text-2xs flex flex-wrap items-center gap-2.5 font-mono"
      data-test="ai-playground-output-usage"
    >
      <span>{{ t("aiObservability.playground.usageLatency", { seconds: latencySeconds }) }}</span>
      <span>
        {{
          t("aiObservability.playground.usageTokens", {
            input: cell.usage.promptTokens,
            output: cell.usage.completionTokens,
          })
        }}
      </span>
      <span>{{ t("aiObservability.playground.usageCost", { cost: costLabel }) }}</span>
    </div>

    <div v-if="showActions && cell?.status === 'done'" class="flex flex-wrap gap-1.5">
      <OButton
        variant="outline"
        size="xs"
        icon-left="content-copy"
        data-test="ai-playground-output-copy"
        @click="emit('copy')"
      >
        {{ t("aiObservability.playground.copyOutput") }}
      </OButton>
      <OButton
        v-if="!cell.toolCall"
        variant="outline"
        size="xs"
        icon-left="add"
        :title="t('aiObservability.playground.addToMessagesTooltip')"
        data-test="ai-playground-output-add-to-messages"
        @click="emit('add-to-messages')"
      >
        {{ t("aiObservability.playground.addToMessages") }}
      </OButton>
      <OButton
        variant="outline"
        size="xs"
        data-test="ai-playground-output-create-experiment"
        @click="emit('create-experiment')"
      >
        {{ t("aiObservability.playground.createExperiment") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { PlaygroundCell } from "@/enterprise/views/AIObservability/playgroundDraft";

const props = withDefaults(
  defineProps<{
    cell: PlaygroundCell | undefined;
    /** Config changed since this ran, so the text no longer describes the config. */
    stale?: boolean;
    /** Table-cell rendering: clamped text, terser empty copy, no action row. */
    compact?: boolean;
    showActions?: boolean;
    dataTest?: string;
  }>(),
  { stale: false, compact: false, showActions: false, dataTest: "ai-playground-output" },
);

const emit = defineEmits<{
  retry: [];
  copy: [];
  "add-to-messages": [];
  "create-experiment": [];
}>();

const { t } = useI18nTyped();

const latencySeconds = computed(() => ((props.cell?.usage?.latencyMs ?? 0) / 1000).toFixed(1));
const costLabel = computed(() => (props.cell?.usage?.costUsd ?? 0).toFixed(4));
</script>
