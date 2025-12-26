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
  <div :style="{ height: height }" class="app-table-container">
    <template v-if="!rows.length">
      <div class="q-pt-md text-center text-subtitle">
        <NoData />
      </div>
    </template>
    <template v-else>
      <q-table
        flat
        ref="tableRef"
        :title="title"
        :rows="rows"
        :columns="columns as []"
        :table-colspan="9"
        row-key="index"
        :virtual-scroll="virtualScroll"
        :rows-per-page-options="[0]"
        @virtual-scroll="onScroll"
        class="full-height"
        hide-bottom
      >
        <template v-slot:header="props">
          <q-tr
            :props="props"
            class="thead-sticky tw:bg-[var(--o2-table-header-bg)]!"
          >
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
              class="tw:bg-[var(--o2-table-header-bg)]!"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>
        <template v-slot:body="props">
          <q-tr
            :props="props"
            :key="`m_${props.row.index}`"
            class="cursor-pointer hover:tw:bg-[var(--o2-hover-accent)]!"
          >
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
                <q-icon :name="col.icon" size="1.5rem" class="cursor-pointer tw:text-[var(--o2-icon-color)] hover:tw:text-[var(--o2-primary-btn-bg)]" />
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
import NoData from "../shared/grid/NoData.vue";

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

// TODO OK: action_play is hardcoded here because of Session List component
// it should be a prop and be handled by the component that uses the table
const handleDataClick = (columnName: string, row: any) => {
  emit("event-emitted", "cell-click", { columnName: "action_play", row });
};

const onScroll = (e: any) => {
  try {
    emit("event-emitted", "scroll", e);
  } catch (e) {
    console.log("error", e);
  }
};
</script>

<style lang="scss">
.app-table-container {
  .thead-sticky,
  .tfoot-sticky {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
    background: #f5f5f5;
  }

  .q-table--dark .thead-sticky,
  .q-table--dark .tfoot-sticky {
    background: #565656 !important;
  }
}
</style>
