<!-- Copyright 2026 OpenObserve Inc.

  A comparison column's header: the dimension's name, and how many rows moved
  each way ON IT.

  The counts belong here rather than in a strip above the table because they are
  per dimension. A single page-level strip can say twelve rows regressed but not
  which scorer regressed them, which is the question that starts the triage.
-->
<template>
  <div class="flex min-w-0 items-center gap-2" :data-test="`ai-experiment-dim-header-${key}`">
    <span class="min-w-0 truncate" :title="raw(String(label))">{{ label }}</span>
    <!-- Silence here reads as a rendering bug. A dimension with no comparison
         policy is never judged in any direction, so it has no counts to show —
         and that is a fact about the scorer's setup, not a gap in the data. -->
    <span
      v-if="!total"
      class="text-text-secondary shrink-0 font-normal"
      :data-test="`ai-experiment-dim-none-${key}`"
    >
      {{ absent.label }}
      <OTooltip :content="absent.hint" side="bottom" max-width="20rem" />
    </span>
    <div v-else class="flex shrink-0 items-center gap-2.5">
      <span
        v-for="entry in entries"
        :key="entry.key"
        class="flex items-center gap-0.5 font-normal"
        :class="entry.tone"
        :data-test="`ai-experiment-dim-${entry.key}-${key}`"
      >
        <OIcon :name="entry.icon" size="xs" class="shrink-0" />
        <span class="tabular-nums">{{ entry.count }}</span>
        <OTooltip :content="entry.tooltip" side="bottom" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  dimensionIdentity,
  dimensionLabel,
  type DimensionMovementCounts,
} from "./experimentRowContent";
import type { ExperimentComparisonSummaryDimension } from "@/services/llm-experiments.service";

const props = defineProps<{
  dimension: ExperimentComparisonSummaryDimension;
  counts: DimensionMovementCounts;
}>();

const { t } = useI18nTyped();

const key = computed(() => dimensionIdentity(props.dimension));
const label = computed(() => dimensionLabel(props.dimension));

const total = computed(
  () => props.counts.improved + props.counts.unchanged + props.counts.regressed,
);

/** Why a dimension reports nothing. `gating` is the server saying this one
 *  declares no comparison policy, which is a different fact from a run where
 *  the two sides simply never overlapped. */
const absent = computed(() =>
  props.dimension.gating
    ? {
        label: t("aiObservability.experiments.comparePage.panel.dimensionNoneCompared"),
        hint: t("aiObservability.experiments.comparePage.panel.dimensionNoneComparedHint"),
      }
    : {
        label: t("aiObservability.experiments.comparePage.panel.dimensionNotCounted"),
        hint: t("aiObservability.experiments.comparePage.panel.dimensionNotCountedHint"),
      },
);

// Improved first, regressed last: the same left-to-right order as the bucket
// strip above, so the two never read in opposite directions. Zeroes stay —
// "0 regressed" is the answer to the question, not the absence of one.
const entries = computed(() => [
  {
    key: "improved" as const,
    count: props.counts.improved,
    icon: "trending-up" as IconName,
    tone: "text-status-positive",
    tooltip: t(
      "aiObservability.experiments.comparePage.panel.dimensionImproved",
      { count: props.counts.improved },
      props.counts.improved,
    ),
  },
  {
    key: "unchanged" as const,
    count: props.counts.unchanged,
    icon: "trending-flat" as IconName,
    tone: "text-text-secondary",
    tooltip: t(
      "aiObservability.experiments.comparePage.panel.dimensionUnchanged",
      { count: props.counts.unchanged },
      props.counts.unchanged,
    ),
  },
  {
    key: "regressed" as const,
    count: props.counts.regressed,
    icon: "trending-down" as IconName,
    tone: "text-status-error-text",
    tooltip: t(
      "aiObservability.experiments.comparePage.panel.dimensionRegressed",
      { count: props.counts.regressed },
      props.counts.regressed,
    ),
  },
]);
</script>
