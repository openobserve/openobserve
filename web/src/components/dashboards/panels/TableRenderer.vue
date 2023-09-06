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
  <q-table class="my-sticky-virtscroll-table" virtual-scroll v-model:pagination="pagination" :rows-per-page-options="[0]"
    :virtual-scroll-sticky-size-start="48" dense :rows="data.rows || []" :columns="data.columns" row-key="id">
  </q-table>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";

export default defineComponent({
  name: "TableRenderer",
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ rows: [], columns: {} })
    },
  },
  setup(props: any) {
    return {
      pagination: ref({
        rowsPerPage: 0,
      }),
    }
  },
})
</script>

<style lang="scss" scoped>
.my-sticky-virtscroll-table {
  /* height or max-height is important */
  height: calc(100% - 1px);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: auto;

  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
      /* bg color is important for th; just specify one */
      background-color: #fff;
  }

  :deep(thead tr th) {
      will-change: auto !important;
      position: sticky;
      z-index: 1;

  }

  /* this will be the loading indicator */
  :deep(thead tr:last-child th) {
      /* height of all previous header rows */
      top: 48px;
  }

  :deep(thead tr:first-child th) {
      top: 0;
  }

  :deep(.q-virtual-scroll) {
      will-change: auto !important;
  }
}
.my-sticky-virtscroll-table.q-dark {
  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
      /* bg color is important for th; just specify one */
    //   background-color: #fff;
      background-color: $dark-page !important;
  }
}
</style>
