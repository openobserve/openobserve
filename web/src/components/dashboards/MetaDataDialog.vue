<template>
  <q-dialog>
    <q-card style="min-width: 500px">
      <q-card-section class="q-pt-md">
        <div class="row items-center q-pb-none">
          <h4 class="text-bold">Metadata Details</h4>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </div>
        <div class="text-bold">Total Queries: {{ totalQueries }}</div>
        <div v-for="(query, index) in metaData.queries" :key="query.originalQuery">
          <div class="text-bold q-py-sm">MetaData: {{ index + 1 }}</div>
          <q-card>
            <q-card-section>
              <q-table class="my-sticky-virtscroll-table" virtual-scroll  v-model:pagination="pagination"
                :rows-per-page-options="[0]" :virtual-scroll-sticky-size-start="48" dense :rows="getRows(query)"
                :columns="tableColumns" row-key="index">
              </q-table>
            </q-card-section>
          </q-card>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";

export default defineComponent({
  name: "MetaDataDialog",
  props: {
    metaData: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const queryData = props.metaData.queries;

    const getRows = (query: any) => [
      ["Original Query", query.originalQuery],
      ["Query", query.query],
      ["Start Time", new Date(query.startTime / 1000).toLocaleString()],
      ["End Time", new Date(query.endTime / 1000).toLocaleString()],
      ["Query Type", query.queryType],
      ["Variables", query.variables.map((variable: any) => `${variable.type}` === "variable" ? `${variable.name}: ${variable.value}` : `${variable.name} ${variable.operator} ${variable.value}`).join(", ")],
    ];
    const totalQueries = computed(() => queryData.length);
    const tableColumns = [
      { name: "key", label: "Name", align: "left", field: 0, sortable: true },
      { name: "value", label: "Value", align: "left", field: 1, sortable: true },
    ];

    return {
      queryData,
      tableColumns,
      getRows,
      totalQueries,
      pagination: ref({
        rowsPerPage: 0,
      }),
    };
  },
});
</script>

<style lang="scss" scoped></style>
