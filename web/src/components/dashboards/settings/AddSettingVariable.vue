<template>
    <div>
        <div class="column full-height">
            <div class="col q-my-sm">
                <div class="text-body1 text-bold text-dark">
                    {{variableData.label}}
                </div>
            </div>
            <div class="col">
                <div>
                    <q-select
                        class="textbox"
                        outlined
                        dense
                        v-model="variableData.type"
                        :options="variableTypes"
                        :label="variableTypes[0].label"
                    ></q-select>
                </div>
                <q-separator></q-separator>
                    <div class="text-body1 text-bold text-dark q-my-sm">
                        {{t("dashboard.addGeneralSettings")}}
                    </div>
                    <div class="textbox">
                        <q-input v-model="variableData.name" :label="t('dashboard.nameOfVariable')" dense outlined></q-input>
                    </div>
                    <div class="textbox">
                        <q-input v-model="variableData.label" :label="t('dashboard.labelOfVariable')" dense outlined></q-input>
                    </div>
                <q-separator></q-separator>
                    <div class="text-body1 text-bold text-dark q-my-sm">
                        {{t("dashboard.extraOptions")}}
                    </div>
                    <q-select v-model="variableData.queryData.streamType" :label="t('dashboard.selectStreamType')"
                        :options="data.streamType" input-debounce="0" behavior="menu" filled borderless dense
                        class="q-mb-xs"></q-select>
                    <q-select v-model="variableData.queryData.stream" :label="t('dashboard.selectIndex')"
                        :options="filteredStreams" input-debounce="0" behavior="menu" use-input filled borderless
                        dense hide-selected fill-input @filter="filterStreamFn">
                    </q-select>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import IndexService from "../../../services/index"
import { useStore } from "vuex";

export default defineComponent({
    name:"AddSettingVariable",
   
    setup(props) {
        const { t } = useI18n();
        const store = useStore();
        const data = reactive({
            schemaList: [],
            indexOptions: [],
            streamType: ["logs", "metrics", "traces"],
            currentFieldsList: [],
        });
        const filteredStreams = ref([]);
        const variableTypes= ref([
                {
                    label: 'Query',
                    value: 'query'
                },
                {
                    label: 'Constant',
                    value: 'constant'
                },
                {
                    label: 'Textbox',
                    value: 'textbox'
                },
                {
                    label: 'Custom Fields',
                    value: 'custom_fields'
                }
            ])
        const variableData = reactive({
            name: "",
            label: "",
            type : "",
            queryData : {
              streamType : "",
              stream : "",
              streamField : "",
            }
        })

        onMounted(() => {
            getStreamList();
        });

        const getStreamList = () => {
            IndexService.nameList(
                store.state.selectedOrganization.identifier,
                "",
                true
            ).then((res) => {
                data.schemaList = res.data.list;
                // dashboardPanelData.meta.stream.streamResults = res.data.list;
            });
        };

        const filterStreamFn = (val: string, update: any) => {
            update(() => {
                filteredStreams.value = data.indexOptions.filter(
                (streamName: any) =>
                    streamName.toLowerCase().indexOf(val.toLowerCase()) > -1
                );
            });
        };

        return {
            variableData,
            t,
            getStreamList,
            data,
            filterStreamFn,
            filteredStreams,
            variableTypes,
            onActivated
        }
    }
    
})
</script>

<style lang="scss" scoped>
.textbox {
    margin-top: 5px;
    margin-bottom: 5px;
}

</style>