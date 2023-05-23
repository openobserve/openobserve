<template>
    <div class="q-py-sm">
        <div class="row button-group">
            <div>
                <button :class="selectedButtonType === 'auto'? 'selected' : ''" 
                    class='button button-left'
                    @click="onUpdateButton('auto')"
                >
                {{ t('panel.auto') }}
                </button>
            </div>
            <div>
                <button 
                    class="button"
                    :class="selectedButtonType === 'promql'? 'selected' : ''"
                    v-show="dashboardPanelData.data.fields.stream_type == 'metrics'" 
                    @click="onUpdateButton('promql')"
                >
                {{ t('panel.promQL') }}
                </button>
            </div>
            <div>
                <button  
                    :class="selectedButtonType === 'custom-sql'? 'selected' : ''"
                    class='button button-right'
                    @click="onUpdateButton('custom-sql')"
                >
                {{ t('panel.customSql') }}
                </button>
            </div>
        </div>
        <ConfirmDialog
            title="Change Query Mode"
            message="Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off."
            @update:ok="changeToggle()"
            @update:cancel="confirmQueryModeChangeDialog = false"
            v-model="confirmQueryModeChangeDialog"
        />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
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
        const { dashboardPanelData, removeXYFilters } = useDashboardPanelData();
        const confirmQueryModeChangeDialog = ref(false);
        const selectedButtonType = ref("auto");
        const popupSelectedButtonType = ref("auto");


        const onUpdateButton = (selectedQueryType: any) => {
            console.log("on update button: " + selectedQueryType);

            if(selectedQueryType != selectedButtonType.value){
                popupSelectedButtonType.value = selectedQueryType;
                confirmQueryModeChangeDialog.value = true;
            }
        };
        const changeToggle = () => {
            console.log("changetoggle method");
            
            selectedButtonType.value = popupSelectedButtonType.value;
            // dashboardPanelData.data.customQuery = !dashboardPanelData.data.customQuery
            // removeXYFilters()
        };

        watch(() => dashboardPanelData.data.fields.stream_type, () => {
            if(dashboardPanelData.data.fields.stream_type != 'metrics' && selectedButtonType.value == 'promql'
            ){
                selectedButtonType.value = "auto"
            }
        })

        watch(selectedButtonType, () => {
            console.log("selectedButtonType watcher");
            window.dispatchEvent(new Event("resize"))
            
            if (selectedButtonType.value == "auto") {
                dashboardPanelData.data.customQuery = false;
                dashboardPanelData.data.queryType = "sql";
            }
            else if (selectedButtonType.value == "custom-sql") {
                dashboardPanelData.data.customQuery = true;
                dashboardPanelData.data.queryType = "sql";
            }
            else if (selectedButtonType.value == "promql") {
                dashboardPanelData.data.customQuery = true;
                dashboardPanelData.data.queryType = "promql";
                
                // set some defaults for the promql query
                dashboardPanelData.data.query = "";
                dashboardPanelData.data.type = 'line';
            }
            else {
                dashboardPanelData.data.customQuery = false;
                dashboardPanelData.data.queryType = "sql";
            }
        });

        watch(selectedButtonType, () => {
            console.log("watcher");
            
            removeXYFilters();
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
    background-color:  #f0eaea;
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