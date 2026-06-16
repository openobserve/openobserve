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
  <div class="plan-node">
    <!-- Node content -->
    <div
      class="node-line"
      tw:flex tw:items-center tw:gap-0 tw:py-[2px] tw:whitespace-pre
    >
      <!-- Parent prefix indentation -->
      <span
        v-if="parentPrefix"
        tw:text-[rgba(0,0,0,0.3)] tw:font-bold tw:select-none tw:whitespace-pre tw:dark:text-[rgba(255,255,255,0.3)]
      >{{ parentPrefix }}</span>

      <!-- Tree connector -->
      <span
        tw:text-[rgba(0,0,0,0.3)] tw:font-bold tw:select-none tw:pr-1 tw:dark:text-[rgba(255,255,255,0.3)]
      >{{ connector }}</span>

      <!-- Expand/collapse icon for nodes with children -->
      <span
        v-if="node.children.length > 0"
        class="expand-icon"
        tw:cursor-pointer tw:select-none tw:text-(--q-primary) tw:text-[10px] tw:w-4 tw:inline-block tw:text-center tw:hover:opacity-70
        @click="toggleChildrenExpanded"
      >
        {{ childrenExpanded ? '▼' : '▶' }}
      </span>
      <span
        v-else
        tw:w-4 tw:inline-block
      ></span>

      <!-- Operator name -->
      <span
        tw:font-semibold tw:text-[rgba(0,0,0,0.87)] tw:pl-1 tw:dark:text-[rgba(255,255,255,0.87)]
      >{{ node.name }}</span>

      <!-- Inline details (clickable to expand if truncated) -->
      <span
        v-if="inlineDetails"
        class="inline-details"
        :class="{
          'tw:cursor-pointer': hasLongDetails,
          'tw:whitespace-nowrap tw:overflow-hidden tw:[text-overflow:ellipsis] tw:max-w-[600px]': !detailsExpanded && hasLongDetails,
          clickable: hasLongDetails,
        }"
        tw:text-[rgba(0,0,0,0.7)] tw:font-normal tw:text-xs tw:italic tw:dark:text-[rgba(255,255,255,0.7)]
        @click="hasLongDetails ? toggleDetailsExpanded() : null"
      >
        : {{ inlineDetails }}
      </span>

      <!-- Separator between details and metrics -->
      <span
        v-if="inlineDetails && (isAnalyze && hasMetrics)"
        tw:text-[rgba(0,0,0,0.4)] tw:px-2 tw:font-normal tw:select-none tw:dark:text-[rgba(255,255,255,0.4)]
      >·</span>

      <!-- Metrics (for ANALYZE mode) -->
      <span
        v-if="isAnalyze && hasMetrics"
        tw:flex tw:gap-2
      >
        <span
          v-if="node.metrics.output_rows !== undefined"
          tw:inline-flex tw:items-center tw:gap-1 tw:py-[2px] tw:px-2 tw:bg-[rgba(var(--q-primary-rgb),0.1)] tw:rounded tw:text-[11px] tw:font-medium tw:text-(--q-primary) tw:whitespace-nowrap tw:dark:bg-[rgba(var(--q-primary-rgb),0.2)]
        >
          <OIcon name="format-list-numbered" size="xs" />
          {{ formatNumber(node.metrics.output_rows) }} rows
        </span>
        <span
          v-if="node.metrics.elapsed_compute"
          tw:inline-flex tw:items-center tw:gap-1 tw:py-[2px] tw:px-2 tw:bg-[rgba(var(--q-primary-rgb),0.1)] tw:rounded tw:text-[11px] tw:font-medium tw:text-(--q-primary) tw:whitespace-nowrap tw:dark:bg-[rgba(var(--q-primary-rgb),0.2)]
        >
          <OIcon name="schedule" size="xs" />
          {{ node.metrics.elapsed_compute }}
        </span>
      </span>
    </div>

    <!-- Expanded full details (shown when details are expanded) -->
    <div
      v-if="detailsExpanded && hasLongDetails"
      tw:pt-[2px] tw:pb-[2px] tw:text-[rgba(0,0,0,0.7)] tw:text-xs tw:italic tw:whitespace-pre-wrap tw:break-words tw:dark:text-[rgba(255,255,255,0.7)]
    >
      <span
        tw:text-[rgba(0,0,0,0.3)] tw:font-bold tw:select-none tw:whitespace-pre tw:dark:text-[rgba(255,255,255,0.3)]
      >{{ childPrefix }}  </span>
      <span>{{ inlineDetails }}</span>
    </div>

    <!-- Children -->
    <div v-if="childrenExpanded && node.children.length > 0">
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
