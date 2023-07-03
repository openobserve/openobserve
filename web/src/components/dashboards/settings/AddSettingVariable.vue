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
                    <q-select
                        filled
                        :model-value="model"
                        use-input
                        hide-selected
                        fill-input
                        input-debounce="0"
                        :options="data.currentFieldsList"
                        @filter="filterFn"
                        @input-value="setModel"
                        hint="Text autocomplete"
                        style="width: 250px; padding-bottom: 32px"
                    >
                        <template v-slot:no-option>
                        <q-item>
                            <q-item-section class="text-grey">
                            No results
                            </q-item-section>
                        </q-item>
                        </template>
                    </q-select>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onActivated, watch } from "vue";
import { useI18n } from "vue-i18n";
import IndexService from "../../../services/index"
import { useStore } from "vuex";

export default defineComponent({
    name:"AddSettingVariable",
   
    setup(props) {
        const { t } = useI18n();
        const store = useStore();
        const data: any = reactive({
            schemaList: [],
            indexOptions: [],
            streamType: ["logs", "metrics", "traces"],
            currentFieldsList: [],
            selectedStreamFields: []
        });
        const model = ref(null)
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
        const editMode = ref(false)

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

        const filterFn = (val: string, update: any) => {
        update(() => {
          const needle = val.toLocaleLowerCase()
          data.currentFieldsList = data.currentFieldsList.filter((v:any) => v.toLocaleLowerCase().indexOf(needle) > -1)
        })
      }

        const setModel = (val: any) => {
            model.value = val
        }

        watch(() => [variableData.queryData.streamType], () => {

            if (!editMode.value) {
                variableData.queryData.stream = ""
            }

            data.indexOptions = data.schemaList.filter((data: any) => data.stream_type == variableData.queryData.streamType)
            .map((data: any) => {
                return data.name;
            });

            // set the first stream as the selected stream when the api loads the data
            if (!editMode.value &&
            !variableData.queryData.stream &&
            data.indexOptions.length > 0
            ) {
                variableData.queryData.stream = data.indexOptions[0];
            }
        })

        watch(() => [data.schemaList, variableData.queryData.stream, variableData.queryData.streamType],
            () => {
                // console.log("stream:", dashboardPanelData.data.fields.stream);

                const fields: any = data.schemaList.find(
                (it: any) => it.name == variableData.queryData.stream
                );
                data.selectedStreamFields =
                fields?.schema || [];
            }
        );

        // update the current list fields if any of the lists changes
        watch(
        () => [
            data.selectedStreamFields,
        ],
        () => {
            // console.log("updated custom query fields or selected stream fields");

            data.currentFieldsList = [];
            data.currentFieldsList = [
            ... data.selectedStreamFields
            ];
        }
        );


        return {
            variableData,
            t,
            getStreamList,
            data,
            filterStreamFn,
            filteredStreams,
            variableTypes,
            onActivated,
            setModel
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