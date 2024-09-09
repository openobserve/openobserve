<!-- Copyright 2023 Zinc Labs Inc.

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

<script setup>
import {
  Handle,
  Position,
  useHandleConnections,
  useNodesData,
} from "@vue-flow/core";

const connections = useHandleConnections({
  type: "target",
  useHandleConnections: true,
});

const nodesData = useNodesData(() => connections.value[0]?.source);
</script>

<template>
  <Handle
    id="4"
    type="target"
    :style="{ height: '6px', width: '6px', filter: 'invert(100%)' }"
  />
  Custom Node
</template>

<style lang="scss">
.vue-flow__node-custom {
  padding: 10px;
  border-radius: 3px;
  width: 150px;
  font-size: 12px;
  text-align: center;
  border-width: 1px;
  border-style: solid;
  color: var(--vf-node-text);
  background-color: var(--vf-node-bg);
  border-color: var(--vf-node-color);
}
</style>
