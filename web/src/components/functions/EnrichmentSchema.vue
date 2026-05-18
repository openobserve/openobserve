    <!-- Copyright 2026 OpenObserve Inc.

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
        <ODrawer data-test="enrichment-schema-drawer"
        :open="open"
        size="lg"
        :title="t('logStream.schemaHeader')"
        @update:open="$emit('update:open', $event)"
    >
        <div>
        <div
          v-if="loadingState"
          class="q-pt-md text-center q-w-md q-mx-lg tw:flex tw:justify-center"
          style="max-width: 450px"
        >
          <OSpinner size="md" data-test="enrichment-schema-loading-indicator" />
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
                <OInput
                  data-test="schema-field-search-input"
                  v-model="filterField"
                  data-cy="schema-index-field-search-input"
                  debounce="1"
                  :placeholder="t('search.searchField')"
                >
                  <template #prepend>
                    <OIcon name="search" size="sm" />
                  </template>
                </OInput>
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
              <OTable
                data-test="schema-log-stream-field-mapping-table"
                :data="schemaData.schema"
                :columns="columns"
                row-key="name"
                :global-filter="filterField"
                :show-global-filter="false"
                :page-size-options="[5, 10, 20, 50]"
              />
            </div>
          </div>
        </div>

      <br /><br /><br />
        </div>
    </ODrawer>
    </template>

    <script lang="ts">
    // @ts-nocheck
    import {
    defineComponent,
    ref,
    watch,
    } from "vue";
    import { useI18n } from "vue-i18n";
    import { useStore } from "vuex";
    import { date, format } from "quasar";
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

    import OTable from "@/lib/core/Table/OTable.vue";
        import DateTime from "@/components/DateTime.vue";
    import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
    import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
    import OInput from "@/lib/forms/Input/OInput.vue";
        import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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
        open: {
        type: Boolean,
        default: false,
        },
         
        selectedEnrichmentTable: {
        type: String,
        default: '',
        },
    },
    components: {
        ConfirmDialog,
        StreamFieldsInputs,
        AppTabs,
        OTable,
        ODrawer,
        OButton,
        OInput,
        OSpinner,
        OIcon,
},
    emits: ['update:open'],
    setup(props) {
        const { t } = useI18n();
        const store = useStore();
        const { getStream } = useStreams();
        const columns = [
            {
                id: "name",
                header: t("logStream.propertyName"),
                accessorKey: "name",
                sortable: true,
                meta: { align: "left" },
            },
            {
                id: "type",
                header: t("logStream.propertyType"),
                accessorKey: "type",
                sortable: true,
                meta: { align: "left" },
            },
        ];
        const loadingState = ref(false);
        const schemaData = ref(defaultStreamData);
        const isCloud = config.isCloud;
        const filterField = ref('');

        watch(
            () => props.open,
            async (isOpen) => {
                if (isOpen) await getSchemaData();
            },
        );

        const getSchemaData = async () => {
            try {
                loadingState.value = true;
                const streamData = await getStream(props.selectedEnrichmentTable, 'enrichment_tables', true);
                if (streamData) {
                    schemaData.value = streamData;
                }
            } catch (error) {
                console.error(error);
                schemaData.value = { ...defaultStreamData, stats: { ...defaultStreamData.stats } };
            } finally {
                loadingState.value = false;
            }
        }


        return {
        t,
        q,
        store,
        columns,
        loadingState,
        schemaData,
        selectedEnrichmentTable: props.selectedEnrichmentTable,
        getStream,
        formatSizeFromMB,
        isCloud,
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
