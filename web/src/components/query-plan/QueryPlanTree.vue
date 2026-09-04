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
  <div
    class="query-plan-tree text-compact bg-surface-subtle rounded-default overflow-x-auto p-4 font-mono leading-[1.8]"
  >
    <div
      v-for="(node, index) in tree.children"
      :key="index"
      class="tree-node m-0"
      data-test="query-plan-tree-node"
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
