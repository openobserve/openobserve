<template>
  <q-dialog>
    <q-card style="min-width: 700px">
      <q-card-section class="q-pt-md">
        <div class="row items-center">
          <div class="text-bold text-h6 q-pb-lg">Query Inspector</div>
          <q-space />
          <q-btn icon="close" class="q-mb-lg" flat round dense v-close-popup />
        </div>
        <div class="text-bold q-pb-sm">Panel : {{ dataTitle }}</div>
        <div class="text-bold">Total Query(s) Executed: {{ totalQueries }}</div>
        <div v-for="(query, index) in metaData.queries" :key="query.originalQuery">
          <div class="text-bold q-py-sm">Query: {{ index + 1 }}</div>
              <q-table class="my-sticky-virtscroll-table" virtual-scroll  v-model:pagination="pagination"
                :rows-per-page-options="[0]" :virtual-scroll-sticky-size-start="48" dense :rows="getRows(query)"
                hide-bottom hide-header row-key="index" wrap-cells>
              </q-table>
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
    },
    data: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const queryData = props.metaData.queries;
    console.log("queryData", props.data.title);
    
    const getRows = (query: any) => {
      const timestampOfStartTime = query.startTime;
      const formattedStartTime = new Date(timestampOfStartTime / 1000);
      const startTimeEntry = `${timestampOfStartTime} (${formattedStartTime})`;

      const timestampOfEndTime = query.endTime;
      const formattedEndTime = new Date(timestampOfEndTime / 1000);
      const endTimeEntry = `${timestampOfEndTime} (${formattedEndTime})`;

      const rows: any[] = [
        ["Original Query", query.originalQuery],
        ["Query", query.query],
        ["Start Time", startTimeEntry],
        ["End Time", endTimeEntry],
        ["Query Type", query.queryType],
        ["Variable", ],
        ["Fixed Variable",],
        ["Dynamic Variable",],
      ];

      const variableRows = [];
      const fixedVariableRows = [];
      const dynamicVariableRows = [];

      query.variables.forEach((variable: any) => {
        if (variable.type === 'variable') {
          variableRows.push(`${variable.name}: ${variable.value}`);
        } else if (variable.type === 'fixed') {
          fixedVariableRows.push(`${variable.name}: ${variable.value}`);
        } else if (variable.type === 'dynamicVariable') {
          dynamicVariableRows.push(`${variable.name} ${variable.operator} ${variable.value}`);
        }
      });

      rows[5][1] = variableRows.join(', ');
      rows[6][1] = fixedVariableRows.join(', ');
      rows[7][1] = dynamicVariableRows.join(', ');


      return rows;
    };
    const totalQueries = computed(() => queryData.length);
    const dataTitle = computed(() => props.data.title);

    return {
      queryData,
      getRows,
      totalQueries,
      dataTitle,
      pagination: ref({
        rowsPerPage: 0,
      }),
    };
  },
});
</script>

<style lang="scss" scoped></style>
