<!-- Copyright 2026 OpenObserve Inc.

  One cell of output. Four states — idle, streaming, error, done — plus the
  tool-call variant, where the call itself IS the output and the run ended
  there.

  Nothing here is tinted by quality. With n ≤ 10 a red or green score chip
  would read as a verdict the bench cannot support, so colour marks run state
  and nothing else — a score that failed to run is the one exception.
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
        preserve-whitespace
        data-test="ai-playground-output-error"
      >
        {{ raw(cell.error?.message) }}
      </OBanner>
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
        :class="compact ? 'line-clamp-3' : ''"
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

    <!-- Verdicts, under the answer they judge. A scorer that could not run is
         listed with its reason rather than dropped: a missing row would read as
         a scorer that was never asked. -->
    <div
      v-if="cell?.scoring || cell?.scores?.length"
      class="flex flex-col gap-1"
      data-test="ai-playground-output-scores"
    >
      <span v-if="cell.scoring" class="text-text-secondary text-2xs italic">
        {{ t("aiObservability.playground.scoring") }}
      </span>
      <div
        v-for="score in cell.scores ?? []"
        :key="score.scorerId"
        class="flex items-start gap-1.5"
        :data-test="`ai-playground-score-${score.scorerId}`"
      >
        <OTag :variant="scoreVariant(score)" size="sm" :label="raw(scoreLabel(score))" />
        <span
          v-if="score.status !== 'scored'"
          class="text-text-secondary text-2xs min-w-0 flex-1 italic"
        >
          {{ scoreNote(score) }}
        </span>
        <span
          v-else-if="score.reasoning"
          class="text-text-secondary text-2xs line-clamp-2 min-w-0 flex-1"
          :title="score.reasoning"
        >
          {{ raw(score.reasoning) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type {
  PlaygroundCell,
  PlaygroundScore,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(
  defineProps<{
    cell: PlaygroundCell | undefined;
    /** Table-cell rendering: clamped text, terser empty copy. */
    compact?: boolean;
    dataTest?: string;
  }>(),
  {
    compact: false,
    dataTest: "ai-playground-output",
  },
);

const emit = defineEmits<{
  retry: [];
}>();

const { t } = useI18nTyped();

/** Name and value in one chip: with four columns side by side, the scorer and
 *  its verdict have to be readable as a single token. */
function scoreLabel(score: PlaygroundScore): string {
  if (score.status !== "scored") return score.scorerName;
  const value =
    score.numeric !== null
      ? String(Number(score.numeric.toFixed(2)))
      : score.categorical !== null
        ? score.categorical
        : score.boolean !== null
          ? score.boolean
            ? t("common.yes")
            : t("common.no")
          : "";
  return value ? `${score.scorerName}: ${value}` : score.scorerName;
}

/** Never tinted by quality — a pass/fail colour on n ≤ 10 would read as a
 *  verdict the bench cannot support. Colour marks run state only. */
function scoreVariant(score: PlaygroundScore): BadgeVariant {
  if (score.status === "failed") return "error-soft";
  if (score.status === "skipped") return "default-soft";
  return "primary-soft";
}

// Past tense here, unlike the scorer menu: by the time this renders the score
// HAS been skipped, and "will be skipped" reads as something still avoidable.
function scoreNote(score: PlaygroundScore) {
  if (score.status === "failed") return raw(score.error ?? "");
  return score.reason === "requires_trace"
    ? t("aiObservability.playground.scorerNeedsTrace")
    : t("aiObservability.playground.scoreSkippedNoReference");
}

const latencySeconds = computed(() => ((props.cell?.usage?.latencyMs ?? 0) / 1000).toFixed(1));
const costLabel = computed(() => (props.cell?.usage?.costUsd ?? 0).toFixed(4));
</script>
