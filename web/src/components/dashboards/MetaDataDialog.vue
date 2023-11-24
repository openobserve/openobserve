<template>
  <q-dialog>
    <q-card style="min-width: 500px">
      <q-card-section class="q-pt-md">
        <div class="row items-center q-pb-none">
          <h6 class="text-bold">Metadata Details</h6>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </div>
        <div class="text-bold">Total Query(s) Executed: {{ totalQueries }}</div>
        <div v-for="(query, index) in metaData.queries" :key="query.originalQuery">
          <div class="text-bold q-py-sm">Query: {{ index + 1 }}</div>
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

    const getRows = (query: any) => {
      const rows: any[] = [
        ["Original Query", query.originalQuery],
        ["Query", query.query],
        ["Start Time", new Date(query.startTime / 1000).toLocaleString()],
        ["End Time", new Date(query.endTime / 1000).toLocaleString()],
        ["Query Type", query.queryType],
        ["Variables", ],
      ];

      const variableRows = query.variables.map((variable: any, variableIndex: number) => [
        variable.type === 'variable' ? `${variable.type} -> ${variable.name}: ${variable.value}` : `${variable.type} -> ${variable.name} ${variable.operator} ${variable.value}`,
        '',
      ]);

        rows.push(...variableRows);

      return rows;
    };
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
