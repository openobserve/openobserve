<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="plan-node" data-test="query-plan-node">
    <!-- Node content -->
    <div
      class="node-line flex items-center gap-0 py-[2px] whitespace-pre"
    >
      <!-- Parent prefix indentation -->
      <span
        v-if="parentPrefix"
        data-test="query-plan-node-tree-indent"
        class="text-[rgba(0,0,0,0.3)] font-bold select-none whitespace-pre dark:text-[rgba(255,255,255,0.3)]"
      >{{ parentPrefix }}</span>

      <!-- Tree connector -->
      <span
        data-test="query-plan-node-tree-connector"
        class="text-[rgba(0,0,0,0.3)] font-bold select-none pr-1 dark:text-[rgba(255,255,255,0.3)]"
      >{{ connector }}</span>

      <!-- Expand/collapse icon for nodes with children -->
      <span
        v-if="node.children.length > 0"
        class="expand-icon cursor-pointer select-none text-(--q-primary) text-[10px] w-4 inline-block text-center hover:opacity-70"
        data-test="query-plan-node-expand-icon"
        @click="toggleChildrenExpanded"
      >
        {{ childrenExpanded ? '▼' : '▶' }}
      </span>
      <span
        v-else
        data-test="query-plan-node-expand-icon-spacer"
        class="w-4 inline-block"
      ></span>

      <!-- Operator name -->
      <span
        data-test="query-plan-node-operator-name"
        class="font-semibold text-[rgba(0,0,0,0.87)] pl-1 dark:text-[rgba(255,255,255,0.87)]"
      >{{ node.name }}</span>

      <!-- Inline details (clickable to expand if truncated) -->
      <span
        v-if="inlineDetails"
        class="inline-details text-[rgba(0,0,0,0.7)] font-normal text-xs italic dark:text-[rgba(255,255,255,0.7)]"
        :class="{
          'cursor-pointer': hasLongDetails,
          'whitespace-nowrap overflow-hidden [text-overflow:ellipsis] max-w-[600px] truncated': !detailsExpanded && hasLongDetails,
          clickable: hasLongDetails,
        }"
        data-test="query-plan-node-inline-details"
        @click="hasLongDetails ? toggleDetailsExpanded() : null"
      >
        : {{ inlineDetails }}
      </span>

      <!-- Separator between details and metrics -->
      <span
        v-if="inlineDetails && (isAnalyze && hasMetrics)"
        data-test="query-plan-node-separator"
        class="text-[rgba(0,0,0,0.4)] px-2 font-normal select-none dark:text-[rgba(255,255,255,0.4)]"
      >·</span>

      <!-- Metrics (for ANALYZE mode) -->
      <span
        v-if="isAnalyze && hasMetrics"
        data-test="query-plan-node-metrics-inline"
        class="flex gap-2"
      >
        <span
          v-if="node.metrics.output_rows !== undefined"
          data-test="query-plan-node-metric-badge"
          class="inline-flex items-center gap-1 py-[2px] px-2 bg-[rgba(var(--q-primary-rgb),0.1)] rounded text-[11px] font-medium text-(--q-primary) whitespace-nowrap dark:bg-[rgba(var(--q-primary-rgb),0.2)]"
        >
          <OIcon name="format-list-numbered" size="xs" />
          {{ formatNumber(node.metrics.output_rows) }} rows
        </span>
        <span
          v-if="node.metrics.elapsed_compute"
          data-test="query-plan-node-metric-badge"
          class="inline-flex items-center gap-1 py-[2px] px-2 bg-[rgba(var(--q-primary-rgb),0.1)] rounded text-[11px] font-medium text-(--q-primary) whitespace-nowrap dark:bg-[rgba(var(--q-primary-rgb),0.2)]"
        >
          <OIcon name="schedule" size="xs" />
          {{ node.metrics.elapsed_compute }}
        </span>
      </span>
    </div>

    <!-- Expanded full details (shown when details are expanded) -->
    <div
      v-if="detailsExpanded && hasLongDetails"
      data-test="query-plan-node-details"
      class="pt-[2px] pb-[2px] text-[rgba(0,0,0,0.7)] text-xs italic whitespace-pre-wrap break-words dark:text-[rgba(255,255,255,0.7)]"
    >
      <span
        class="text-[rgba(0,0,0,0.3)] font-bold select-none whitespace-pre dark:text-[rgba(255,255,255,0.3)]"
      >{{ childPrefix }}  </span>
      <span>{{ inlineDetails }}</span>
    </div>

    <!-- Children -->
    <div
      v-if="childrenExpanded && node.children.length > 0"
      class="children"
      data-test="query-plan-node-children"
    >
      <QueryPlanNode
        v-for="(child, index) in node.children"
        :key="index"
        :node="child"
        :is-last="index === node.children.length - 1"
        :is-analyze="isAnalyze"
        :parent-prefix="childPrefix"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed } from "vue";
import { OperatorNode } from "@/utils/queryPlanParser";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "QueryPlanNode",
  components: {
    OIcon,
  },
  props: {
    node: {
      type: Object as PropType<OperatorNode>,
      required: true,
    },
    isLast: {
      type: Boolean,
      default: false,
    },
    isAnalyze: {
      type: Boolean,
      default: false,
    },
    parentPrefix: {
      type: String,
      default: '',
    },
  },
  setup(props) {
    const childrenExpanded = ref(true);
    const detailsExpanded = ref(false);

    const connector = computed(() => {
      return props.isLast ? '└─' : '├─';
    });

    const childPrefix = computed(() => {
      const addition = props.isLast ? '  ' : '│ ';
      return props.parentPrefix + addition;
    });

    const hasMetrics = computed(() => {
      return props.isAnalyze && (
        props.node.metrics.output_rows !== undefined ||
        props.node.metrics.elapsed_compute !== undefined
      );
    });

    /**
     * Get inline details - everything after the colon, excluding metrics
     */
    const parseInlineDetails = (fullText: string): string => {
      const colonIndex = fullText.indexOf(':');
      if (colonIndex === -1) return '';

      let details = fullText.substring(colonIndex + 1).trim();

      // Remove metrics section if in analyze mode (we show them separately)
      if (props.isAnalyze && details.includes('metrics=')) {
        const metricsIndex = details.indexOf(', metrics=');
        if (metricsIndex !== -1) {
          details = details.substring(0, metricsIndex).trim();
        }
      }

      return details;
    };

    const inlineDetails = computed(() => {
      return parseInlineDetails(props.node.fullText);
    });

    const hasLongDetails = computed(() => {
      // Consider details "long" if they exceed reasonable single-line length
      return inlineDetails.value.length > 80;
    });

    const toggleChildrenExpanded = () => {
      childrenExpanded.value = !childrenExpanded.value;
    };

    const toggleDetailsExpanded = () => {
      detailsExpanded.value = !detailsExpanded.value;
    };

    const formatNumber = (num: number): string => {
      return num.toLocaleString('en-US');
    };

    return {
      childrenExpanded,
      detailsExpanded,
      connector,
      childPrefix,
      hasMetrics,
      inlineDetails,
      hasLongDetails,
      toggleChildrenExpanded,
      toggleDetailsExpanded,
      formatNumber,
    };
  },
});
</script>

<style>
.plan-node .node-line .inline-details.clickable:hover {
  color: rgba(0, 0, 0, 0.9);
}

.body--dark .plan-node .node-line .inline-details.clickable:hover {
  color: rgba(255, 255, 255, 0.9);
}
</style>
