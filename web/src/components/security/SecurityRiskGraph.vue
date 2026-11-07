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
    <div class="mx-page-edge mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span
        v-for="item in legend"
        :key="item.label"
        class="text-text-secondary flex items-center gap-1.5"
      >
        <span class="inline-block size-2.5 rounded-full" :style="{ backgroundColor: item.color }" />
        {{ item.label }}
      </span>
      <span class="text-text-secondary flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-5 rounded" :style="{ backgroundColor: PATH_COLOR }" />
        {{ t("siem.entities.riskGraph.attackPath") }}
      </span>
      <span v-if="hiddenCount" class="text-text-secondary ml-auto">
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
            class="!size-1.5 !border-0 !bg-gray-400"
          />
          <div
            class="rounded-default bg-surface-base flex w-52 cursor-pointer flex-col gap-1.5 border p-2.5 shadow-sm transition-all hover:[transform:translateY(-0.125rem)] hover:shadow-md"
            :style="{ borderColor: data.accent, borderLeftWidth: '4px' }"
            :data-test="`risk-node-${data.id}`"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded"
                :style="{ backgroundColor: data.accent + '22', color: data.accent }"
              >
                <OIcon
                  :name="data.crownJewel ? 'star' : KIND_ICON[data.kind] || 'share'"
                  size="sm"
                />
              </span>
              <span
                class="text-text-heading min-w-0 flex-1 truncate text-xs font-semibold"
                :class="{ 'font-mono': data.kind !== 'user' && data.kind !== 'asset' }"
                >{{ data.label }}</span
              >
              <span
                class="rounded px-1.5 py-0.5 text-xs font-bold text-white tabular-nums"
                :style="{ backgroundColor: data.accent }"
                >{{ data.score }}</span
              >
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-text-secondary text-[0.65rem] tracking-wide uppercase">{{
                data.crownJewel
                  ? t("siem.entities.riskGraph.crownJewel")
                  : t(`siem.entities.riskGraph.tier.${data.tier}`)
              }}</span>
              <span
                v-if="data.onPath"
                class="ml-auto flex items-center gap-0.5 text-[0.6rem] font-semibold"
                :style="{ color: PATH_COLOR }"
              >
                <OIcon name="warning" size="xs" />{{ t("siem.entities.riskGraph.attackPath") }}
              </span>
            </div>
            <div
              v-if="data.kind !== 'asset'"
              class="text-text-secondary flex gap-2 text-[0.6rem] tabular-nums"
            >
              <span>base {{ data.base }}</span>
              <span>prop {{ data.propagated }}</span>
              <span>blast {{ data.blast }}</span>
            </div>
          </div>
          <Handle
            type="source"
            :position="Position.Right"
            class="!size-1.5 !border-0 !bg-gray-400"
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
import {
  buildRiskGraph,
  type RiskGraph,
  type RiskKind,
  type RiskNode,
  type RiskRowInput,
  type RiskTier,
} from "@/utils/security/riskGraph";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const TIER_COLOR: Record<RiskTier, string> = {
  critical: "#dc2626",
  high: "#f59e0b",
  medium: "#eab308",
  low: "#22c55e",
};
const ASSET_COLOR = "#6b7280";
const CROWN_COLOR = "#a855f7";
const PATH_COLOR = "#ef4444";
const KIND_ICON: Record<string, string> = {
  user: "person",
  ip: "lan",
  host: "computer",
  asset: "database",
};

// Cap the entity nodes so a large org does not render a wall of cards.
const ENTITY_CAP = 24;
// Entities render in a compact grid on the left; hub then crown jewels to the
// right, so the attack path reads left-to-right without a single tall column.
const ENTITY_COLS = 3;
const CELL_W = 236;
const CELL_H = 124;
const HUB_GAP = 150;
const CROWN_GAP = 320;

function accentOf(n: RiskNode): string {
  if (n.crownJewel) return CROWN_COLOR;
  if (n.kind === "asset") return ASSET_COLOR;
  return TIER_COLOR[n.tier];
}

export default defineComponent({
  name: "SecurityRiskGraph",
  components: { VueFlow, Background, Controls, Handle, OIcon, OEmptyState },
  props: {
    rows: { type: Array as () => RiskRowInput[], default: () => [] },
    kind: { type: String as () => RiskKind, required: true },
  },
  emits: ["node-select"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();

    const graph = computed<RiskGraph>(() => buildRiskGraph(props.rows, props.kind, ENTITY_CAP));

    const shownCount = computed(() => graph.value.nodes.filter((n) => n.kind !== "asset").length);
    const hiddenCount = computed(() => Math.max(0, props.rows.length - shownCount.value));

    const legend = computed(() => [
      { label: t("siem.entities.riskGraph.tier.critical"), color: TIER_COLOR.critical },
      { label: t("siem.entities.riskGraph.tier.high"), color: TIER_COLOR.high },
      { label: t("siem.entities.riskGraph.tier.medium"), color: TIER_COLOR.medium },
      { label: t("siem.entities.riskGraph.tier.low"), color: TIER_COLOR.low },
      { label: t("siem.entities.riskGraph.crownJewel"), color: CROWN_COLOR },
    ]);

    const onPathIds = computed(() => new Set(graph.value.topPath));

    const flowNodes = computed(() => {
      const entities = graph.value.nodes.filter((n) => n.kind !== "asset");
      const hubs = graph.value.nodes.filter((n) => n.kind === "asset" && !n.crownJewel);
      const crowns = graph.value.nodes.filter((n) => n.crownJewel);

      const rows = Math.ceil(entities.length / ENTITY_COLS) || 1;
      const gridH = rows * CELL_H;
      const gridW = ENTITY_COLS * CELL_W;
      const centerY = gridH / 2;
      const pos = new Map<string, { x: number; y: number }>();

      entities.forEach((n, i) => {
        pos.set(n.id, { x: (i % ENTITY_COLS) * CELL_W, y: Math.floor(i / ENTITY_COLS) * CELL_H });
      });
      hubs.forEach((n, i) => {
        pos.set(n.id, { x: gridW + HUB_GAP, y: centerY + (i - (hubs.length - 1) / 2) * CELL_H });
      });
      crowns.forEach((n, i) => {
        pos.set(n.id, {
          x: gridW + HUB_GAP + CROWN_GAP,
          y: centerY + (i - (crowns.length - 1) / 2) * (CELL_H + 30),
        });
      });

      return graph.value.nodes.map((n) => ({
        id: n.id,
        type: "risk",
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          id: n.id,
          label: n.label,
          kind: n.kind,
          crownJewel: n.crownJewel,
          tier: n.tier,
          accent: accentOf(n),
          score: Math.round(n.score),
          base: Math.round(n.base),
          propagated: Math.round(n.propagated),
          blast: Math.round(n.blast),
          onPath: onPathIds.value.has(n.id),
        },
      }));
    });

    const flowEdges = computed(() =>
      graph.value.edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: "default",
        animated: e.onPath,
        markerEnd: MarkerType.ArrowClosed,
        style: {
          stroke: e.onPath ? PATH_COLOR : ASSET_COLOR,
          strokeWidth: e.onPath ? 2.5 : 1,
          opacity: e.onPath ? 1 : 0.2 + e.p * 0.5,
        },
      })),
    );

    function onNodeClick({ node }: { node: { data?: { kind?: string; label?: string } } }) {
      const d = node?.data;
      if (d && d.kind !== "asset" && d.label) emit("node-select", d.label);
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
      PATH_COLOR,
    };
  },
});
</script>
