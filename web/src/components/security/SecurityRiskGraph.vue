<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { VueFlow, Position, Handle } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { ENTITY_KINDS, type EntityKind } from "@/utils/security/streamPlan";
import type { RiskGraph, RiskNode } from "@/services/securityInvestigate";
import { TONE_TOKEN, severityRailColor } from "@/utils/security/severity";
import { formatEventCount } from "@/utils/formatters";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const props = withDefaults(defineProps<{ graph: RiskGraph; loading?: boolean }>(), {
  loading: false,
});
const emit = defineEmits<{ "node-select": [kind: EntityKind, value: string] }>();
const { t } = useI18nTyped();

const KIND_ICON: Record<EntityKind, IconName> = { user: "person", ip: "lan", host: "computer" };
const COLUMN: Record<EntityKind, number> = { user: 0, ip: 1, host: 2 };
// Flow coordinates are unitless canvas positions, not CSS lengths.
const CELL_W = 320;
const CELL_H = 110;

const flowNodes = computed(() => {
  const row: Record<EntityKind, number> = { user: 0, ip: 0, host: 0 };
  return props.graph.nodes.map((n: RiskNode) => ({
    id: n.id,
    type: "risk",
    position: { x: COLUMN[n.kind] * CELL_W, y: row[n.kind]++ * CELL_H },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: n,
  }));
});

const flowEdges = computed(() =>
  props.graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "default",
    label: e.events
      ? t("siem.entities.riskGraph.edgeEvents", { n: formatEventCount(e.events) }, e.events)
      : t("siem.entities.riskGraph.edgeCases", { n: e.caseIds.length }, e.caseIds.length),
    style: {
      stroke: `var(${e.caseIds.length ? TONE_TOKEN.high : "--color-border-strong"})`,
      strokeWidth: 1 + Math.min(3, Math.log10(1 + e.events)),
      strokeDasharray: e.events ? undefined : "4 3",
    },
  })),
);

const hasAliases = (n: RiskNode) =>
  n.aliases.length > 1 || (!!n.aliases[0] && n.aliases[0] !== n.value);

function onNodeClick({ node }: { node: { data?: RiskNode } }) {
  if (node?.data) emit("node-select", node.data.kind, node.data.value);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test="security-risk-graph">
    <div
      class="mx-page-edge text-text-secondary mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
    >
      <span v-for="k in ENTITY_KINDS" :key="k" class="flex items-center gap-1">
        <OIcon :name="KIND_ICON[k]" size="xs" />{{ t(`siem.entities.kinds.${k}`) }}
      </span>
      <span>{{ t("siem.entities.riskGraph.legend") }}</span>
      <span
        v-if="graph.total > graph.nodes.length"
        class="ms-auto"
        data-test="security-risk-graph-capped"
      >
        {{ t("siem.entities.riskGraph.showingTop", { n: graph.nodes.length, total: graph.total }) }}
      </span>
    </div>

    <div v-if="loading && !graph.nodes.length" class="flex flex-1 items-center justify-center">
      <OSpinner size="sm" />
    </div>
    <OEmptyState
      v-else-if="!graph.nodes.length"
      size="hero"
      icon="share"
      :title="t('siem.entities.riskGraph.empty')"
      :description="t('siem.entities.riskGraph.emptyHint')"
      data-test="security-risk-graph-empty"
    />
    <div v-else class="mt-2 min-h-100 flex-1" data-test="security-risk-graph-canvas">
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :min-zoom="0.15"
        :max-zoom="2.5"
        fit-view-on-init
        :fit-view-options="{ padding: 0.15 }"
        :nodes-draggable="true"
        class="bg-surface-panel! rounded-default border-border-default h-full w-full border"
        @node-click="onNodeClick"
      >
        <Background />
        <Controls />
        <template #node-risk="{ data }">
          <Handle type="target" :position="Position.Left" class="opacity-0" />
          <div
            class="rounded-default bg-surface-base border-border-default flex w-64 cursor-pointer flex-col gap-1 border border-s-4 p-2.5 shadow-sm"
            :style="{ borderInlineStartColor: severityRailColor(data.tone) }"
            :data-test="`risk-node-${data.id}`"
          >
            <div class="flex items-center gap-1.5">
              <OIcon
                :name="KIND_ICON[data.kind as EntityKind]"
                size="sm"
                class="text-text-secondary"
              />
              <span
                class="text-text-heading min-w-0 flex-1 truncate text-xs font-semibold"
                :class="{ 'font-mono': data.kind !== 'user' }"
                >{{ data.value }}</span
              >
              <OTag
                :variant="data.score ? 'error-soft' : 'default-soft'"
                size="xs"
                :data-test="`risk-node-score-${data.id}`"
                >{{ data.score
                }}<OTooltip
                  :content="
                    t('siem.entities.riskGraph.scoreHint', {
                      detection: data.detectionScore,
                      failure: data.failureScore,
                      neighbour: data.neighbourScore,
                    })
                  "
              /></OTag>
            </div>
            <span v-if="hasAliases(data)" class="text-text-secondary text-2xs truncate font-mono">{{
              data.aliases.join(" · ")
            }}</span>
            <span class="text-text-secondary text-2xs tabular-nums">
              {{
                t("siem.entities.riskGraph.nodeFacts", {
                  events: formatEventCount(data.events),
                  failures: formatEventCount(data.failures),
                })
              }}
              <template v-if="data.cases.length">
                ·
                {{
                  t(
                    "siem.entities.riskGraph.nodeCases",
                    { n: data.cases.length },
                    data.cases.length,
                  )
                }}
              </template>
            </span>
          </div>
          <Handle type="source" :position="Position.Right" class="opacity-0" />
        </template>
      </VueFlow>
    </div>
  </div>
</template>
