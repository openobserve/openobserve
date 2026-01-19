<template>
  <q-card style="min-width: 700px">
    <q-card-section class="q-pt-sm">
      <div class="row items-center">
        <div class="text-bold text-h6 q-pb-none">Query Inspector</div>
        <q-space />
        <q-btn
          icon="close"
          class="q-mb-none"
          flat
          round
          dense
          v-close-popup="true"
          data-test="query-inspector-close-btn"
        />
      </div>
      <div class="text-bold q-pb-xs">Panel : {{ dataTitle }}</div>
      <div class="text-bold">Total Query(s) Executed: {{ totalQueries }}</div>
      <div
        v-for="(query, index) in ((metaData as any)?.queries ?? [])"
        :key="query?.originalQuery"
      >
        <div class="text-bold q-py-xs">Query: {{ index + 1 }}</div>
        <q-table
          class="query-inspector-table"
          :rows="getRows(query)"
          :columns="columns"
          hide-header
          hide-bottom
          flat
          dense
          v-model:pagination="pagination"
          :rows-per-page-options="[0]"
          row-key="index"
          wrap-cells
          data-test="query-inspector"
        >
          <template v-slot:body-cell-value="props">
            <q-td :props="props">
              <div
                v-if="props.row[0] === 'Original Query' || props.row[0] === 'Query'"
                style="
                  max-height: 150px;
                  overflow-y: auto;
                  padding: 2px;
                  font-family: monospace;
                  font-size: 13px;
                  white-space: pre-wrap;
                  word-break: break-all;
                "
                class="inspector-query-editor"
                v-html="colorizedQueries[`${index}-${props.row[0]}`] || props.row[1]"
              >
              </div>
              <div
                v-else
                :class="{
                  'scrollable-content':
                    props.row[0] === 'Original Query' ||
                    props.row[0] === 'Query',
                  'regular-content':
                    props.row[0] !== 'Original Query' &&
                    props.row[0] !== 'Query',
                }"
              >
                {{ props.row[1] }}
              </div>
            </q-td>
          </template>
          <template v-slot:body-cell-label="props">
            <q-td :props="props" class="query-label-cell">
              {{ props.row[0] }}
            </q-td>
          </template>
        </q-table>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, onMounted } from "vue";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import { colorizeQuery } from "@/utils/query/colorizeQuery";

export default defineComponent({
  name: "QueryInspector",
  props: {
    metaData: {
      validator: value => {
        // Custom validation logic
        return typeof value == 'object' || typeof value == undefined;
      },
      required: true
    },
    data: {
      type: Object,
      required: true
    }
  },
  setup(props: any) {
    const queryData = props.metaData?.queries || [] ;
    const store = useStore();

    const columns = [
      {
        name: "label",
        label: "Label",
        field: (row: any) => row[0],
        align: "left" as const,
        style: "width: 150px; font-weight: 600;",
      },
      {
        name: "value",
        label: "Value",
        field: (row: any) => row[1],
        align: "left" as const,
      },
    ];
    const getRows = (query: any) => { 
      const timestampOfStartTime = query?.startTime;
      const formattedStartTime = timestampToTimezoneDate(
        timestampOfStartTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss.SSS"
      );
      const startTimeEntry = `${timestampOfStartTime} (${formattedStartTime} ${store.state.timezone})`;

      const timestampOfEndTime = query?.endTime;
      const formattedEndTime = timestampToTimezoneDate(
        timestampOfEndTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss.SSS"
      );
      const endTimeEntry = `${timestampOfEndTime} (${formattedEndTime} ${store.state.timezone})`;

      const rows: any[] = [
        ["Original Query", query?.originalQuery],
        ["Query", query?.query],
        ["Start Time", startTimeEntry],
        ["End Time", endTimeEntry],
        ["Query Type", query?.queryType],
        ["Variable(s)", ],
        ["Fixed Variable(s)",],
        ["Dynamic Variable(s)",],
      ];

      const variableRows: any[] = [];
      const fixedVariableRows: any[] = [];
      const dynamicVariableRows: any[] = [];

      query?.variables?.forEach((variable: any) => {
        if (variable.type === 'variable') {
          variableRows.push(`${variable.name}: ${variable.value}`);
        } else if (variable.type === 'fixed') {
          fixedVariableRows.push(`${variable.name}: ${variable.value}`);
        } else if (variable.type === 'dynamicVariable') {
          dynamicVariableRows.push(`${variable.name} ${variable.operator} ${variable.value}`);
        }
      });

      rows[5][1] = variableRows.length > 0 ? variableRows.join(', ') : '-';
      rows[6][1] = fixedVariableRows.length > 0 ? fixedVariableRows.join(', ') : '-';
      rows[7][1] = dynamicVariableRows.length > 0 ? dynamicVariableRows.join(', ') : '-';


      return rows;
    };
    const totalQueries = computed(() => queryData.length);
    const dataTitle = computed(() => props.data.title);
    const colorizedQueries = ref<Record<string, string>>({});

    const updateColorizedQueries = async () => {
      const newColorized: Record<string, string> = {};
      for (const [index, query] of queryData.entries()) {
        const lang = query.queryType?.toLowerCase() || 'sql';
        
        // Original Query
        if (query.originalQuery) {
          newColorized[`${index}-Original Query`] = await colorizeQuery(query.originalQuery, lang);
        }
        
        // Query
        if (query.query) {
           newColorized[`${index}-Query`] = await colorizeQuery(query.query, lang);
        }
      }
      colorizedQueries.value = newColorized;
    };

    onMounted(() => {
        updateColorizedQueries();
    });

    watch(() => props.metaData, updateColorizedQueries, { deep: true });

    return {
      queryData,
      getRows,
      totalQueries,
      dataTitle,
      columns,
      pagination: ref({
        rowsPerPage: 0,
      }),

      colorizedQueries
    };
  },
});
</script>

<style lang="scss" scoped>
.query-inspector-table {
  margin-bottom: 5px;

  :deep(.q-table__container) {
    border: none;
    box-shadow: none;
  }

  :deep(.q-table tbody td) {
    border-bottom: 1px solid #e9ecef;
    padding: 5px;
    vertical-align: top;
    background: #ffffff;
  }

  :deep(.q-table tbody tr:last-child td) {
    border-bottom: none;
  }

  :deep(.q-table tbody tr:hover td) {
    background: #f8f9fa;
  }
}

.query-label-cell {
  width: 150px;
  font-weight: 600;
  border-right: 1px solid #dee2e6 !important;
  color: #495057;
  font-size: 14px;
}

.regular-content {
  word-break: break-all;
  white-space: pre-wrap;
  font-size: 14px;
  color: #495057;
  line-height: 1.4;
}

.scrollable-content {
  max-height: 150px;
  overflow-y: auto;
  overflow-x: hidden;
  font-family:
    "Courier New", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  padding: 8px 0;
  color: #495057;
  letter-spacing: 0.5px;
  
  /* Better text rendering */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;

    &:hover {
      background: #a8a8a8;
    }
  }

  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: #c1c1c1 #f1f1f1;
}
</style>
