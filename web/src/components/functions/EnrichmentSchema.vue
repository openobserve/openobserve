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

    <!-- eslint-disable vue/v-on-event-hyphenation -->
    <!-- eslint-disable vue/attribute-hyphenation -->


    <template>
        <q-card
        style="width: 60vw"
        class="column full-height no-wrap"
    >
        <q-card-section class="q-ma-none">
        <div class="row items-center no-wrap">
            <div class="col">
            <div
                class="text-body1 tw:font-semibold tw:text-xl"
                data-test="schema-title-text"
            >
                {{ t("logStream.schemaHeader") }}
            </div>
            </div>
            <div class="col-auto">
            <q-btn v-close-popup="true" round
    flat icon="cancel" />
            </div>
        </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-ma-none q-pa-none">
        <div
          v-if="loadingState"
          class="q-pt-md text-center q-w-md q-mx-lg tw:flex tw:justify-center"
          style="max-width: 450px"
        >
          <q-spinner-hourglass color="primary" size="lg" />
        </div>
        <div v-else class="indexDetailsContainer" style="height: 100vh">
          <div
            class="titleContainer tw:flex tw:flex-col tw:items-flex-start tw:gap-5"
          >
            <div
              data-test="stream-details-container"
              class="stream_details_container tw:flex tw:justify-between tw:gap-5 tw:flex-wrap"
            >
              <div data-test="schema-stream-title-text">
                {{ t("alerts.stream_name") }}
                <span class="title q-pl-xs" > {{ schemaData.name }}</span>
              </div>
              <div
                v-if="store.state.zoConfig.show_stream_stats_doc_num"
                data-test="schema-stream-title-text"
              >
                {{ t("logStream.docsCount") }}
                <span class="title q-pl-xs">
                  {{
                    parseInt(schemaData.stats.doc_num).toLocaleString("en-US")
                  }}
                </span>
              </div>
              <div data-test="schema-stream-title-text">
                {{ t("logStream.storageSize") }}
                <span class="title q-pl-xs">
                  {{ formatSizeFromMB(schemaData.stats.storage_size) }}</span
                >
              </div>
              <div
                v-if="isCloud !== 'true'"
                data-test="schema-stream-title-text"
              >
                {{ t("logStream.compressedSize") }}
                <span class="title q-pl-xs">
                  {{ formatSizeFromMB(schemaData.stats.compressed_size) }}</span
                >
              </div>
            </div>
          </div>
          <div class="flex items-center justify-between tw:gap-4 tw:mt-4">
            <div class="tw:text-sm display-total-fields">
                All Fields ({{ schemaData.schema.length }})
            </div>
                <q-input
                  data-test="schema-field-search-input"
                  v-model="filterField"
                  data-cy="schema-index-field-search-input"
                  filled
                  borderless
                  dense
                  debounce="1"
                  :placeholder="t('search.searchField')"
                >
                  <template #prepend>
                    <q-icon name="search" />
                  </template>
                </q-input>
              </div>
          <div>

            <div
              :class="
                store.state.theme === 'dark'
                  ? 'dark-theme-table'
                  : 'light-theme-table'
              "
              style="margin-bottom: 30px"
              class="q-mt-lg"
            >
              <q-table
                ref="qTable"
                data-test="schema-log-stream-field-mapping-table"
                :rows="schemaData.schema"
                :columns="columns"
                :row-key="(row) => 'tr_' + row.name"
                :filter-method="filterFieldFn"
                :pagination="pagination"
                class="q-table"
                id="schemaFieldList"
                :rows-per-page-options="[]"
                dense
                :filter="filterField"
              >
                <template #bottom="scope" >
                  <QTablePagination
                    :scope="scope"
                    :position="'bottom'"
                    :resultTotal="resultTotal"
                    :perPageOptions="perPageOptions"
                    @update:changeRecordPerPage="changePagination"
                  />
                </template>
              </q-table>
            </div>
          </div>
        </div>

      <br /><br /><br />
    </q-card-section>
    </q-card>
    </template>

    <script lang="ts">
    // @ts-nocheck
    import {
    defineComponent,
    ref,
    onMounted,
    } from "vue";
    import { useI18n } from "vue-i18n";
    import { useStore } from "vuex";
    import { useQuasar, date, format } from "quasar";
    import streamService from "../../services/stream";
    import segment from "../../services/segment_analytics";
    import {
    formatSizeFromMB,
    getImageURL,
    timestampToTimezoneDate,
    convertDateToTimestamp,
    } from "@/utils/zincutils";
    import config from "@/aws-exports";
    import ConfirmDialog from "@/components/ConfirmDialog.vue";
    import useStreams from "@/composables/useStreams";
    import { useRouter } from "vue-router";
    import StreamFieldsInputs from "@/components/logstream/StreamFieldInputs.vue";
    import AppTabs from "@/components/common/AppTabs.vue";

    import QTablePagination from "@/components/shared/grid/Pagination.vue";
    import {
    outlinedSchema,
    outlinedPerson,
    outlinedDelete,
    } from "@quasar/extras/material-icons-outlined";
    import DateTime from "@/components/DateTime.vue";
    const defaultStreamData = {
        name: '',
        schema: [],
        stats: {
            doc_num: 0,
            storage_size: 0,
            compressed_size: 0,
        },
    };


    export default defineComponent({
    name: "SchemaEnrichment",
    props: {
        // eslint-disable-next-line vue/require-default-prop
        selectedEnrichmentTable: {
        type: String,
        default: '',
        },
    },
    components: {
        ConfirmDialog,
        StreamFieldsInputs,
        AppTabs,
        QTablePagination,
    },
    setup({ selectedEnrichmentTable }) {
        const { t } = useI18n();
        const store = useStore();
        const q = useQuasar();
        const { getStream } = useStreams();
        const qTable = ref<any>(null);
        const columns = [
            {
                name: "name",
                label: t("logStream.propertyName"),
                align: "left",
                sortable: true,
                field: "name",
                style:'width: 50vw'

            },
            {
                name: "type",
                label: t("logStream.propertyType"),
                align: "left",
                sortable: true,
                field: "type",
            }
            ];
        const schemaRows = ref([]);
        const loadingState = ref(false);
        const schemaData = ref(defaultStreamData);
        const isCloud = config.isCloud;
        const resultTotal = ref<number>(0);
        const selectedPerPage = ref<number>(20);
        const filterField = ref('');
        const perPageOptions : any = [
            { label: "5", value: 5 },
            { label: "10", value: 10 },
            { label: "20", value: 20 },
            { label: "50", value: 50 },
        ];

        onMounted(async () => {
            await getSchemaData();
        })

        const getSchemaData = async () => {
            try {
                loadingState.value = true;
                const streamData = await getStream(selectedEnrichmentTable, 'enrichment_tables', true);
                schemaData.value = streamData;
                resultTotal.value = streamData.schema.length;
                loadingState.value = false;
            } catch (error) {
                console.error(error);
                loadingState.value = false;
            }
        }


        const filterFieldFn = (rows: any, terms: any) => {
            return rows.filter((row: any) => row.name.toLowerCase().includes(terms));
        }
        const pagination: any = ref({
            rowsPerPage: 20,
        });
        const changePagination = (val: { label: string; value: any }) => {
            selectedPerPage.value = val.value;
            pagination.value.rowsPerPage = val.value;
            qTable.value?.setPagination(pagination.value);
        };



        return {
        t,
        q,
        store,
        columns,
        schemaRows,
        loadingState,
        schemaData,
        selectedEnrichmentTable,
        getStream,
        formatSizeFromMB,
        isCloud,
        filterFieldFn,
        changePagination,
        selectedPerPage,
        perPageOptions,
        pagination,
        qTable,
        resultTotal,
        filterField,
        };
    },
    });
    </script>

<style lang="scss" scoped>
.q-card__section--vert {
  padding: 8px 16px;
}
.indexDetailsContainer {
  padding: 1.25rem;
  width: 100%;

  .title {
    margin-bottom: 1rem;
    font-weight: 700;
  }

  .titleContainer {
    background-color: #00000005;
    border: 1px solid $input-field-border-color;
    border-radius: 5px;
    padding: 1rem;
  }

  .q-table {
    border: 1px solid $input-field-border-color;

  }
  .display-total-fields{
    width: 115px;
    height: 30px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: $primary;
    color: white;
  }


}




</style>
