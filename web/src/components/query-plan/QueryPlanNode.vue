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
      class="node-line flex items-center gap-0 py-0.5 whitespace-pre"
    >
      <!-- Parent prefix indentation -->
      <span
        v-if="parentPrefix"
        data-test="query-plan-node-tree-indent"
        class="text-text-muted font-bold select-none whitespace-pre"
      >{{ parentPrefix }}</span>

      <!-- Tree connector -->
      <span
        data-test="query-plan-node-tree-connector"
        class="text-text-muted font-bold select-none pr-1"
      >{{ connector }}</span>

      <!-- Expand/collapse icon for nodes with children -->
      <span
        v-if="node.children.length > 0"
        class="expand-icon cursor-pointer select-none text-theme-accent text-3xs w-4 inline-block text-center hover:opacity-70"
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
        class="font-semibold text-text-heading pl-1"
      >{{ node.name }}</span>

      <!-- Inline details (clickable to expand if truncated) -->
      <span
        v-if="inlineDetails"
        class="inline-details text-text-secondary font-normal text-xs italic"
        :class="{
          'cursor-pointer hover:text-text-body': hasLongDetails,
          'whitespace-nowrap overflow-hidden [text-overflow:ellipsis] max-w-150 truncated': !detailsExpanded && hasLongDetails,
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
        class="text-text-muted px-2 font-normal select-none"
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
          class="inline-flex items-center gap-1 py-0.5 px-2 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] rounded-default text-2xs font-medium text-theme-accent whitespace-nowrap dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_20%,transparent)]"
        >
          <OIcon name="format-list-numbered" size="xs" />
          {{ formatNumber(node.metrics.output_rows) }} {{ t('search.rows') }}
        </span>
        <span
          v-if="node.metrics.elapsed_compute"
          data-test="query-plan-node-metric-badge"
          class="inline-flex items-center gap-1 py-0.5 px-2 bg-[color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)] rounded-default text-2xs font-medium text-theme-accent whitespace-nowrap dark:bg-[color-mix(in_srgb,var(--color-theme-accent)_20%,transparent)]"
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
      class="pt-0.5 pb-0.5 text-text-secondary text-xs italic whitespace-pre-wrap break-words"
    >
      <span
        class="text-text-muted font-bold select-none whitespace-pre"
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
import { useI18n } from "vue-i18n";
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
    const { t } = useI18n();
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
      t,
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
