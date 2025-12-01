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
      <!-- Parent prefix indentation -->
      <span v-if="parentPrefix" class="tree-indent">{{ parentPrefix }}</span>

      <!-- Tree connector -->
      <span class="tree-connector">{{ connector }}</span>

      <!-- Expand/collapse icon for nodes with children -->
      <span
        v-if="node.children.length > 0"
        class="expand-icon"
        @click="toggleChildrenExpanded"
      >
        {{ childrenExpanded ? '▼' : '▶' }}
      </span>
      <span v-else class="expand-icon-spacer"></span>

      <!-- Operator name -->
      <span class="operator-name">{{ node.name }}</span>

      <!-- Inline details (clickable to expand if truncated) -->
      <span
        v-if="inlineDetails"
        class="inline-details"
        :class="{ truncated: !detailsExpanded && hasLongDetails, clickable: hasLongDetails }"
        @click="hasLongDetails ? toggleDetailsExpanded() : null"
      >
        : {{ inlineDetails }}
      </span>

      <!-- Separator between details and metrics -->
      <span v-if="inlineDetails && (isAnalyze && hasMetrics)" class="separator">·</span>

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
      </span>
    </div>

    <!-- Expanded full details (shown when details are expanded) -->
    <div v-if="detailsExpanded && hasLongDetails" class="node-details">
      <span class="tree-indent">{{ childPrefix }}  </span>
      <span>{{ inlineDetails }}</span>
    </div>

    <!-- Children -->
    <div v-if="childrenExpanded && node.children.length > 0" class="children">
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

export default defineComponent({
  name: "QueryPlanNode",
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
      return num.toLocaleString();
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

<style lang="scss" scoped>
.plan-node {
  .node-line {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 2px 0;
    white-space: pre;

    .tree-indent {
      color: rgba(0, 0, 0, 0.3);
      font-weight: bold;
      user-select: none;
      white-space: pre;
    }

    .tree-connector {
      color: rgba(0, 0, 0, 0.3);
      font-weight: bold;
      user-select: none;
      padding-right: 4px;
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
      padding-left: 4px;
    }

    .inline-details {
      color: rgba(0, 0, 0, 0.7);
      font-weight: 400;
      font-size: 12px;
      font-style: italic;
      padding-left: 0;

      &.clickable {
        cursor: pointer;

        &:hover {
          color: rgba(0, 0, 0, 0.9);
        }
      }

      &.truncated {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 600px;
      }
    }

    .separator {
      color: rgba(0, 0, 0, 0.4);
      padding: 0 8px;
      font-weight: 400;
      user-select: none;
    }

    .metrics-inline {
      display: flex;
      gap: 8px;
      margin-left: 0;

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
    font-style: italic;
    white-space: pre-wrap;
    word-break: break-word;

    .tree-indent {
      color: rgba(0, 0, 0, 0.3);
      font-weight: bold;
      user-select: none;
      white-space: pre;
    }
  }

  .children {
    padding-left: 0;
  }
}

.body--dark {
  .plan-node {
    .node-line {
      .tree-indent {
        color: rgba(255, 255, 255, 0.3);
      }

      .tree-connector {
        color: rgba(255, 255, 255, 0.3);
      }

      .operator-name {
        color: rgba(255, 255, 255, 0.87);
      }

      .inline-details {
        color: rgba(255, 255, 255, 0.7);
        font-style: italic;

        &.clickable:hover {
          color: rgba(255, 255, 255, 0.9);
        }
      }

      .separator {
        color: rgba(255, 255, 255, 0.4);
      }

      .metrics-inline {
        .metric-badge {
          background-color: rgba(var(--q-primary-rgb), 0.2);
        }
      }
    }

    .node-details {
      color: rgba(255, 255, 255, 0.7);
      font-style: italic;

      .tree-indent {
        color: rgba(255, 255, 255, 0.3);
      }
    }
  }
}
</style>
