<!-- Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test="security-risk-graph">
    <OBanner
      variant="info"
      icon="info"
      dense
      class="mx-page-edge mt-2"
      :content="t('siem.entities.riskGraph.illustrative')"
      data-test="security-risk-graph-illustrative"
    />
    <div class="mx-page-edge mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span
        v-for="item in legend"
        :key="item.label"
        class="text-text-secondary flex items-center gap-1.5"
      >
        <span class="inline-block size-2.5 rounded-full" :style="{ backgroundColor: item.color }" />
        {{ item.label }}
      </span>
      <span v-if="hiddenCount" class="text-text-secondary ms-auto">
        {{ t("siem.entities.riskGraph.showingTop", { n: shownCount, total: rows.length }) }}
      </span>
    </div>

    <OEmptyState
      v-if="!graph.nodes.length"
      size="hero"
      icon="share"
      :title="t('siem.entities.riskGraph.empty')"
      :description="t('siem.entities.riskGraph.emptyHint')"
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
        :elevate-edges-on-select="true"
        class="bg-surface-panel! rounded-default border-border-default h-full w-full border"
        @node-click="onNodeClick"
      >
        <Background pattern-color="#9ca3af" :gap="18" />
        <Controls />

        <template #node-risk="{ data }">
          <Handle
            type="target"
            :position="Position.Left"
            class="!bg-border-strong !size-1.5 !border-0"
          />
          <div
            class="rounded-default bg-surface-base flex w-52 cursor-pointer flex-col gap-1.5 border p-2.5 shadow-sm transition-all hover:[transform:translateY(-0.125rem)] hover:shadow-md"
            :style="{ borderColor: data.accent, borderLeftWidth: '0.25rem' }"
            :data-test="`risk-node-${data.id}`"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="rounded-default flex size-6 shrink-0 items-center justify-center"
                :style="{
                  backgroundColor: `color-mix(in srgb, ${data.accent} 13%, transparent)`,
                  color: data.accent,
                }"
              >
                <OIcon :name="KIND_ICON[data.kind] || 'share'" size="sm" />
              </span>
              <span
                class="text-text-heading min-w-0 flex-1 truncate text-xs font-semibold"
                :class="{ 'font-mono': data.kind !== 'user' }"
                >{{ data.label }}</span
              >
              <span
                class="rounded-default px-1.5 py-0.5 text-xs font-bold text-white tabular-nums"
                :style="{ backgroundColor: data.accent }"
                >{{ data.score }}</span
              >
            </div>
            <span class="text-text-secondary text-2xs tracking-wide uppercase">{{
              t(`siem.entities.riskGraph.tier.${data.tier}`)
            }}</span>
            <div class="text-text-secondary text-3xs flex gap-2 tabular-nums">
              <span>{{ t("siem.entities.riskGraph.baseScore", { n: data.base }) }}</span>
              <span>{{
                t("siem.entities.riskGraph.propagatedScore", { n: data.propagated })
              }}</span>
            </div>
          </div>
          <Handle
            type="source"
            :position="Position.Right"
            class="!bg-border-strong !size-1.5 !border-0"
          />
        </template>
      </VueFlow>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { VueFlow, Position, Handle, MarkerType } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import {
  buildRiskGraph,
  type RiskGraph,
  type RiskKind,
  type RiskRowInput,
  type RiskTier,
} from "@/utils/security/riskGraph";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const TIER_COLOR: Record<RiskTier, string> = {
  critical: "var(--color-badge-error-solid-bg)",
  high: "var(--color-badge-orange-solid-bg)",
  medium: "var(--color-badge-amber-solid-bg)",
  low: "var(--color-badge-success-solid-bg)",
};
const EDGE_COLOR = "var(--color-border-strong)";
const KIND_ICON: Record<string, string> = {
  user: "person",
  ip: "lan",
  host: "computer",
};

// Cap the entity nodes so a large org does not render a wall of cards.
const ENTITY_CAP = 24;
const ENTITY_COLS = 3;
const CELL_W = 236;
const CELL_H = 124;

export default defineComponent({
  name: "SecurityRiskGraph",
  components: { VueFlow, Background, Controls, Handle, OIcon, OEmptyState, OBanner },
  props: {
    rows: { type: Array as () => RiskRowInput[], default: () => [] },
    kind: { type: String as () => RiskKind, required: true },
  },
  emits: ["node-select"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();

    const graph = computed<RiskGraph>(() => buildRiskGraph(props.rows, props.kind, ENTITY_CAP));

    const shownCount = computed(() => graph.value.nodes.length);
    const hiddenCount = computed(() => Math.max(0, props.rows.length - shownCount.value));

    const legend = computed(() => [
      { label: t("siem.entities.riskGraph.tier.critical"), color: TIER_COLOR.critical },
      { label: t("siem.entities.riskGraph.tier.high"), color: TIER_COLOR.high },
      { label: t("siem.entities.riskGraph.tier.medium"), color: TIER_COLOR.medium },
      { label: t("siem.entities.riskGraph.tier.low"), color: TIER_COLOR.low },
    ]);

    const flowNodes = computed(() =>
      graph.value.nodes.map((n, i) => ({
        id: n.id,
        type: "risk",
        position: { x: (i % ENTITY_COLS) * CELL_W, y: Math.floor(i / ENTITY_COLS) * CELL_H },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          id: n.id,
          label: n.label,
          kind: n.kind,
          tier: n.tier,
          accent: TIER_COLOR[n.tier],
          score: Math.round(n.score),
          base: Math.round(n.base),
          propagated: Math.round(n.propagated),
        },
      })),
    );

    const flowEdges = computed(() =>
      graph.value.edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: "default",
        markerEnd: MarkerType.ArrowClosed,
        style: { stroke: EDGE_COLOR, strokeWidth: 1, opacity: 0.2 + e.p * 0.5 },
      })),
    );

    function onNodeClick({ node }: { node: { data?: { label?: string } } }) {
      const label = node?.data?.label;
      if (label) emit("node-select", label);
    }

    return {
      t,
      graph,
      legend,
      flowNodes,
      flowEdges,
      shownCount,
      hiddenCount,
      onNodeClick,
      Position,
      KIND_ICON,
    };
  },
});
</script>
