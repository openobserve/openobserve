<template>
    <div class="q-py-sm">
        <div class="row button-group">
            <div>
                <button :class="selectedButtonType === 'auto' ? 'selected' : ''" class='button button-left'
                    @click="onUpdateButton('auto')">
                    {{ t('panel.auto') }}
                </button>
            </div>
            <div>
                <button class="button" :class="selectedButtonType === 'promql' ? 'selected' : ''"
                    v-show="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type == 'metrics'" @click="onUpdateButton('promql')">
                    {{ t('panel.promQL') }}
                </button>
            </div>
            <div>
                <button :class="selectedButtonType === 'custom-sql' ? 'selected' : ''" class='button button-right'
                    @click="onUpdateButton('custom-sql')">
                    {{ t('panel.customSql') }}
                </button>
            </div>
        </div>
        <ConfirmDialog title="Change Query Mode"
            message="Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off."
            @update:ok="changeToggle()" @update:cancel="confirmQueryModeChangeDialog = false"
            v-model="confirmQueryModeChangeDialog" />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, onActivated, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import ConfirmDialog from "../../ConfirmDialog.vue";

export default defineComponent({
    name: "QueryTypeSelector",
    component: { ConfirmDialog },
    props: [],
    emits: [],
    setup() {
        const router = useRouter();
        const { t } = useI18n();
        const $q = useQuasar();
        const { dashboardPanelData, removeXYFilters, updateXYFieldsForCustomQueryMode } = useDashboardPanelData();
        const confirmQueryModeChangeDialog = ref(false);

        // this is the value of the current button
        const selectedButtonType = ref("auto");

        // this holds the temporary value of the button while user confirms the choice on popup
        const popupSelectedButtonType = ref("auto");

        const ignoreSelectedButtonTypeUpdate = ref(false);

        const initializeSelectedButtonType = async () => {
            // set a variable to ignore updates for selectedButtonType
            ignoreSelectedButtonTypeUpdate.value = true;

            if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery == false && dashboardPanelData.data.queryType == "sql") {
                selectedButtonType.value = "auto"
            } else if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery == true && dashboardPanelData.data.queryType == "sql") {
                selectedButtonType.value = "custom-sql"
            } else if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery == true && dashboardPanelData.data.queryType == "promql") {
                selectedButtonType.value = "promql"
            } else {
                selectedButtonType.value = "auto"
                // if the query type is not present, set the value to "sql"
                if(!dashboardPanelData.data.queryType || dashboardPanelData.data.queryType == "") {
                    dashboardPanelData.data.queryType = "sql"
                }
            }
            await nextTick()

            // set a variable to allow watcher updates for selectedButtonType
            ignoreSelectedButtonTypeUpdate.value = false;
        }

        onMounted(async () => {
            initializeSelectedButtonType()
        })

        onActivated(async () => {
            initializeSelectedButtonType()
        })

        // when the data is loaded, initialize the selectedButtonType
        watch(() => [dashboardPanelData.data.queryType, dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery], () => {
            initializeSelectedButtonType()
        })

        const onUpdateButton = (selectedQueryType: any) => {
            if (selectedQueryType != selectedButtonType.value) {

                // some exceptions
                // If user is switching from auto to custom, promql to auto, or propmql to custom-sql no need for the popup,
                // else show the popup
                if((selectedButtonType.value == "auto" && selectedQueryType == "custom-sql") 
                    || (selectedButtonType.value == "promql" && selectedQueryType == "auto") 
                    || (selectedButtonType.value == "promql" && selectedQueryType == "custom-sql")) {
                    // act like you confirmed without opening the popup
                    popupSelectedButtonType.value = selectedQueryType;
                    changeToggle()
                    dashboardPanelData.layout.showQueryBar = true
                } else {
                    popupSelectedButtonType.value = selectedQueryType;
                    confirmQueryModeChangeDialog.value = true;
                }
            }
        };
        const changeToggle = async () => {
            selectedButtonType.value = popupSelectedButtonType.value;
            await nextTick() // let the watchers execute first
            removeXYFilters()
            updateXYFieldsForCustomQueryMode()
            dashboardPanelData.layout.showQueryBar = true
        };

        watch(() => dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type, () => {
            if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type != 'metrics' && selectedButtonType.value == 'promql'
            ) {
                selectedButtonType.value = "auto"
            }
        })

        watch(selectedButtonType, () => {
            window.dispatchEvent(new Event("resize"))
            if (!ignoreSelectedButtonTypeUpdate.value) {
                if (selectedButtonType.value == "auto") {
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery = false;
                    dashboardPanelData.data.queryType = "sql";
                }
                else if (selectedButtonType.value == "custom-sql") {
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery = true;
                    dashboardPanelData.data.queryType = "sql";
                }
                else if (selectedButtonType.value == "promql") {
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery = true;
                    dashboardPanelData.data.queryType = "promql";

                    // set some defaults for the promql query
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].query = "";
                    dashboardPanelData.data.type = 'line';
                }
                else {
                    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery = false;
                    dashboardPanelData.data.queryType = "sql";
                }
            }
        });


        return {
            t,
            router,
            dashboardPanelData,
            onUpdateButton,
            changeToggle,
            confirmQueryModeChangeDialog,
            selectedButtonType
        };
    },
    components: { ConfirmDialog }
})
</script>

<style lang="scss" scoped>
.selected {
    background-color: var(--q-primary) !important;
    font-weight: bold;
    color: white;
}

.button-group {
    border: 1px solid gray !important;
    border-radius: 9px;
}

.button {
    display: block;
    cursor: pointer;
    background-color: #f0eaea;
    border: none;
    font-size: 14px;
    padding: 3px 10px;
}

.button-left {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
}

.button-right {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
}
</style>