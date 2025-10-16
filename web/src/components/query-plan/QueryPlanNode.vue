<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="node-line">
      <!-- Tree connector -->
      <span class="tree-connector">{{ connector }}</span>

      <!-- Expand/collapse icon for nodes with children -->
      <span
        v-if="node.children.length > 0"
        class="expand-icon"
        @click="toggleExpanded"
      >
        {{ expanded ? '▼' : '▶' }}
      </span>
      <span v-else class="expand-icon-spacer"></span>

      <!-- Operator name -->
      <span class="operator-name">{{ node.name }}</span>

      <!-- Metrics (for ANALYZE mode) -->
      <span v-if="isAnalyze && hasMetrics" class="metrics-inline">
        <span v-if="node.metrics.output_rows !== undefined" class="metric-badge">
          <q-icon name="format_list_numbered" size="12px" />
          {{ formatNumber(node.metrics.output_rows) }} rows
        </span>
        <span v-if="node.metrics.elapsed_compute" class="metric-badge">
          <q-icon name="schedule" size="12px" />
          {{ node.metrics.elapsed_compute }}
        </span>
        <span v-if="node.metrics.memory" class="metric-badge">
          <q-icon name="memory" size="12px" />
          {{ node.metrics.memory }}
        </span>
      </span>
    </div>

    <!-- Additional details (collapsed by default if projection is long) -->
    <div v-if="expanded && nodeDetails" class="node-details">
      <span class="tree-indent">{{ childPrefix }}</span>
      <CollapsibleProjection
        v-if="hasProjection"
        :fields-text="nodeDetails"
      />
      <span v-else>{{ nodeDetails }}</span>
    </div>

    <!-- Children -->
    <div v-if="expanded && node.children.length > 0" class="children">
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
import CollapsibleProjection from "./CollapsibleProjection.vue";

export default defineComponent({
  name: "QueryPlanNode",
  components: {
    CollapsibleProjection,
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
    const expanded = ref(true);

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
        props.node.metrics.elapsed_compute !== undefined ||
        props.node.metrics.memory !== undefined
      );
    });

    const nodeDetails = computed(() => {
      // Extract details after the operator name and colon
      const colonIndex = props.node.fullText.indexOf(':');
      if (colonIndex === -1) return '';

      const details = props.node.fullText.substring(colonIndex + 1).trim();

      // Remove metrics section if in analyze mode (we show them inline)
      if (props.isAnalyze && details.includes('metrics=')) {
        const metricsIndex = details.indexOf(', metrics=');
        if (metricsIndex !== -1) {
          return details.substring(0, metricsIndex);
        }
      }

      return details;
    });

    const hasProjection = computed(() => {
      return /Projection.*:\s*\[/i.test(nodeDetails.value);
    });

    const toggleExpanded = () => {
      expanded.value = !expanded.value;
    };

    const formatNumber = (num: number): string => {
      return num.toLocaleString();
    };

    return {
      expanded,
      connector,
      childPrefix,
      hasMetrics,
      nodeDetails,
      hasProjection,
      toggleExpanded,
      formatNumber,
    };
  },
});
</script>

<style lang="scss" scoped>
.plan-node {
  .node-line {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;

    .tree-connector {
      color: rgba(0, 0, 0, 0.3);
      font-weight: bold;
      user-select: none;
    }

    .expand-icon {
      cursor: pointer;
      user-select: none;
      color: var(--q-primary);
      font-size: 10px;
      width: 16px;
      display: inline-block;
      text-align: center;

      &:hover {
        opacity: 0.7;
      }
    }

    .expand-icon-spacer {
      width: 16px;
      display: inline-block;
    }

    .operator-name {
      font-weight: 600;
      color: rgba(0, 0, 0, 0.87);
    }

    .metrics-inline {
      display: flex;
      gap: 8px;
      margin-left: 12px;

      .metric-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background-color: rgba(var(--q-primary-rgb), 0.1);
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        color: var(--q-primary);
        white-space: nowrap;
      }
    }
  }

  .node-details {
    padding-left: 0;
    padding-top: 2px;
    padding-bottom: 2px;
    color: rgba(0, 0, 0, 0.7);
    font-size: 12px;

    .tree-indent {
      color: rgba(0, 0, 0, 0.3);
      font-weight: bold;
      user-select: none;
    }
  }

  .children {
    padding-left: 0;
  }
}

.body--dark {
  .plan-node {
    .node-line {
      .tree-connector {
        color: rgba(255, 255, 255, 0.3);
      }

      .operator-name {
        color: rgba(255, 255, 255, 0.87);
      }

      .metrics-inline {
        .metric-badge {
          background-color: rgba(var(--q-primary-rgb), 0.2);
        }
      }
    }

    .node-details {
      color: rgba(255, 255, 255, 0.7);

      .tree-indent {
        color: rgba(255, 255, 255, 0.3);
      }
    }
  }
}
</style>
