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
