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
  <div class="query-plan-tree">
    <div
      v-for="(node, index) in tree.children"
      :key="index"
      class="tree-node"
    >
      <QueryPlanNode
        :node="node"
        :is-last="index === tree.children.length - 1"
        :is-analyze="isAnalyze"
        :parent-prefix="''"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { OperatorNode } from "@/utils/queryPlanParser";
import QueryPlanNode from "./QueryPlanNode.vue";

export default defineComponent({
  name: "QueryPlanTree",
  components: {
    QueryPlanNode,
  },
  props: {
    tree: {
      type: Object as PropType<OperatorNode>,
      required: true,
    },
    isAnalyze: {
      type: Boolean,
      default: false,
    },
  },
});
</script>

<style lang="scss" scoped>
.query-plan-tree {
  font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace;
  font-size: 13px;
  line-height: 1.8;
  padding: 16px;
  background-color: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  overflow-x: auto;

  .tree-node {
    margin: 0;
  }
}

.body--dark {
  .query-plan-tree {
    background-color: rgba(255, 255, 255, 0.03);
  }
}
</style>
