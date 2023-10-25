<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <!-- 
    Create a table like SearchResults.vue component.
    1. Props for columns, rows and loading
    2. use virtual scroll
    3. Column should have boolean property to close column. closable: true
    4. Column should have boolean property to hide column. hidden: true
    5. Component should have highlight property to highlight search text
    6. Rows should have boolean property to expand row. expandable: true
   -->
  <div :style="{ height: height }" class="app-table-container">
    <template v-if="!rows.length">
      <h5 class="q-pt-md text-center">No data found</h5>
    </template>
    <template v-else>
      <q-table
        flat
        bordered
        ref="tableRef"
        :title="title"
        :rows="rows"
        :columns="(columns as [])"
        :table-colspan="9"
        row-key="index"
        :virtual-scroll="virtualScroll"
        :virtual-scroll-item-size="48"
        :rows-per-page-options="[0]"
        @virtual-scroll="onScroll"
        class="full-height"
        hide-bottom
      >
        <template v-slot:header="props">
          <q-tr :props="props" class="thead-sticky">
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>
        <template v-slot:body="props">
          <q-tr :props="props" :key="`m_${props.row.index}`">
            <q-td
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              @click="handleDataClick(col.name, props.row)"
            >
              <template v-if="col.slot">
                <slot :name="col.slotName" :column="props" />
              </template>
              <template v-else-if="col.type === 'action'">
                <q-icon :name="col.icon" size="24px" class="cursor-pointer" />
              </template>
              <template v-else>
                {{ col.value }}
              </template>
            </q-td>
          </q-tr>
          <q-tr
            v-show="props.expand"
            :props="props"
            :key="`e_${props.row.index}`"
            class="q-virtual-scroll--with-prev"
          >
            <q-td colspan="100%">
              <div class="text-left">
                This is expand slot for row above: {{ props.row.name }} (Index:
                {{ props.row.index }}).
              </div>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps({
  columns: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    required: false,
    default: false,
  },
  highlight: {
    type: Boolean,
    required: false,
    default: false,
  },
  highlightText: {
    type: String,
    default: "",
  },
  title: {
    type: String,
    default: "",
  },
  virtualScroll: {
    type: Boolean,
    default: true,
  },
  height: {
    type: String,
    default: "100%",
  },
});

const emit = defineEmits(["event-emitted"]);

const handleDataClick = (columnName: string, row: any) => {
  emit("event-emitted", "cell-click", { columnName, row });
};

const onScroll = (e: any) => {
  try {
    emit("event-emitted", "scroll", e);
  } catch (e) {
    console.log("error", e);
  }
};
</script>

<style>
.thead-sticky,
.tfoot-sticky {
  position: sticky;
  top: 0;
  opacity: 1;
  z-index: 1;
}
</style>
