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

<script>
import useDragAndDrop from "@/plugins/pipelines/useDnD";

export default {
  props: {
    nodeTypes: Array,
    hasInputType: Boolean,
  },
  setup(props) {
    const { onDragStart, pipelineObj } = useDragAndDrop();
    return { node_types: props.nodeTypes, onDragStart, pipelineObj };
  },
};
</script>

<template>
  <div class="nodes">
    <div
      v-for="node in node_types"
      :key="node.io_type"
      class="o2vf_node"
    >
      <q-btn
        borderless
        :class="`o2vf_node_${node.io_type}`"
        flat
        size="md"
        class="q-pa-none btn-fixed-width node-draggable"
        style="width: 170px; justify-content: flex-start;"
        :draggable="true"
        @dragstart="onDragStart($event, node)"
        v-if="node.isSectionHeader==false"
      >
        <q-tooltip
          anchor="center right"
          self="center left"
          :offset="[10, 0]"
          class="custom-tooltip-nodes"
          transition-show="scale"
          transition-hide="scale"
          :delay="300"
        >
          <div class="tooltip-content">
            <div class="tooltip-title">{{ node.label }}</div>
            <div class="tooltip-description">{{ node.tooltip }}</div>
          </div>
        </q-tooltip>
        <div class="node-content">
          <div class="node-icon-section">
            <q-icon size="1.3em" :name="node.icon" />
            <q-separator vertical class="node-separator" />
          </div>
          <div class="node-label tw:w-[70px]">{{ node.label }}</div>
          <div class="drag-dots">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>
      </q-btn>
      <div v-else>
        <div class="q-mb-xs text-subtitle1">
          <div>{{ node.label }}</div>
          <q-separator />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.nodes {
  background: rgba(226, 232, 240, 0.9);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 12px 8px;
  margin: 4px 2px;
  transition: all 0.3s ease;

  &:hover {
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  }
}

.o2vf_node {
  transition: all 0.2s ease;
  border-radius: 8px;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  .node-draggable:hover {
    transform: translate(3px);
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
  }
}

.node-draggable {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.node-content {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  width: 100%;
  padding: 4px 6px 4px 0px;
  gap: 8px;
}

.node-icon-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-separator {
  height: 16px;
}

.drag-handle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  cursor: grab;
  padding: 4px;

  &:hover .dot {
    background: rgba(107, 114, 128, 0.8);
    transform: scale(1.1);
  }

  &:active {
    cursor: grabbing;
  }
}

.drag-dots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 2px;
  width: 8px;
  height: 8px;
}

.dot {
  width: 2px;
  height: 2px;
  background: rgba(107, 114, 128, 0.6);
  border-radius: 50%;
  transition: all 0.2s ease;
}

.node-label {
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 12px;
}

.o2vf_node_input {
  border: 1px solid rgba(96, 165, 250, 0.4);
  color: #1e40af;
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.9);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(239, 246, 255, 1);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
    border-color: rgba(96, 165, 250, 0.6);
  }
}

.o2vf_node_output {
  border: 1px solid rgba(74, 222, 128, 0.4);
  color: #181a1b;
  border-radius: 8px;
  background: rgba(240, 253, 244, 0.9);
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.1);
  transition: all 0.3s ease;
  padding: 8px 16px;

  &:hover {
    background: rgba(240, 253, 244, 1);
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
    border-color: rgba(74, 222, 128, 0.6);
  }
}

.o2vf_node_default {
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #92400e;
  border-radius: 8px;
  background: rgba(255, 251, 235, 0.9);
  box-shadow: 0 2px 8px rgba(217, 119, 6, 0.1);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 251, 235, 1);
    box-shadow: 0 4px 12px rgba(217, 119, 6, 0.2);
    border-color: rgba(245, 158, 11, 0.6);
  }
}

// .custom-tooltip-nodes {
//   background: rgba(30, 35, 40, 0.95) !important;
//   backdrop-filter: blur(10px);
//   border-radius: 6px;
//   box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
//   border: 1px solid rgba(255, 255, 255, 0.1);
//   font-size: 11px;
//   max-width: 180px;
// }

.tooltip-content {
  padding: 6px 10px;
}

.tooltip-title {
  // color: #ffffff;
  font-weight: 500;
  font-size: 11px;
  margin-bottom: 2px;
  text-transform: capitalize;
}

.tooltip-description {
  // color: rgba(255, 255, 255, 0.75);
  font-size: 10px;
  line-height: 1.3;
  text-transform: capitalize;
}
</style>

<style lang="scss">
// Dark mode styles (global scope to override)
.body--dark {
  .nodes {
    background: rgba(15, 23, 42, 0.95) !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
    padding: 12px 8px !important;

    &:hover {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
    }
  }

  .node-draggable:hover {
    background: rgba(255, 255, 255, 0.08) !important;
    backdrop-filter: blur(12px) !important;
  }

  .q-btn.o2vf_node_default,
  .q-btn.node-draggable.o2vf_node_default,
  .q-btn.o2vf_node_default.q-btn--flat,
  .o2vf_node_default,
  .node-draggable.o2vf_node_default {
    background: rgba(120, 53, 15, 0.2) !important;
    border: 1px solid rgba(251, 146, 60, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;

    &:hover {
      background: rgba(120, 53, 15, 0.3) !important;
      border-color: rgba(251, 146, 60, 0.5) !important;
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.2) !important;
    }

    &.q-btn--flat {
      background: rgba(120, 53, 15, 0.2) !important;

      &:hover {
        background: rgba(120, 53, 15, 0.3) !important;
      }
    }
  }

  .o2vf_node_input {
    background: rgba(30, 58, 138, 0.2) !important;
    border: 1px solid rgba(96, 165, 250, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;

    &:hover {
      background: rgba(30, 58, 138, 0.3) !important;
      border-color: rgba(96, 165, 250, 0.5) !important;
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.2) !important;
    }
  }

  .o2vf_node_output {
    background: rgba(20, 83, 45, 0.2) !important;
    border: 1px solid rgba(74, 222, 128, 0.3) !important;
    color: rgba(255, 255, 255, 0.9) !important;

    &:hover {
      background: rgba(20, 83, 45, 0.3) !important;
      border-color: rgba(74, 222, 128, 0.5) !important;
      box-shadow: 0 6px 16px rgba(34, 197, 94, 0.2) !important;
    }
  }

  .dot {
    background: rgba(255, 255, 255, 0.5) !important;
  }

  .drag-handle:hover .dot {
    background: rgba(255, 255, 255, 0.7) !important;
  }
}
</style>
