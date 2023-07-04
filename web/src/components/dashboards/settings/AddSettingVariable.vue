<template>
    <div>
        <div class="column full-height">
            <div class="col q-my-sm">
                <div class="text-body1 text-bold text-dark">
                    {{ variableData.label }}
                </div>
            </div>
            <div class="col">
                <div>
                    <q-select class="textbox" outlined dense v-model="variableData.type" :options="variableTypes"
                        :label="variableTypes[0].label"></q-select>
                </div>
                <q-separator></q-separator>
                <div class="text-body1 text-bold text-dark q-my-sm">
                    {{ t("dashboard.addGeneralSettings") }}
                </div>
                <div class="textbox">
                    <q-input v-model="variableData.name" :label="t('dashboard.nameOfVariable')" dense outlined></q-input>
                </div>
                <div class="textbox">
                    <q-input v-model="variableData.label" :label="t('dashboard.labelOfVariable')" dense outlined></q-input>
                </div>
                <q-separator></q-separator>
                <div class="text-body1 text-bold text-dark q-my-sm">
                    {{ t("dashboard.extraOptions") }}
                </div>
                <q-select v-model="variableData.query_data.stream_type" :label="t('dashboard.selectStreamType')"
                    :options="data.streamType" input-debounce="0" behavior="menu" filled borderless dense class="q-mb-xs"
                    @update:model-value="streamTypeUpdated"></q-select>
                <q-select v-model="variableData.query_data.stream" :label="t('dashboard.selectIndex')"
                    :options="streamsFilteredOptions" input-debounce="0" behavior="menu" use-input filled borderless dense
                    hide-selected fill-input @filter="streamsFilterFn" @update:model-value="streamUpdated"
                    option-value="name" option-label="name" emit-value>
                </q-select>
                <q-select filled use-input hide-selected fill-input input-debounce="0" :options="fieldsFilteredOptions"
                    @filter="fieldsFilterFn" hint="Text autocomplete" style="width: 250px; padding-bottom: 32px"
                    option-value="name" option-label="name">
                </q-select>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onActivated, watch, toRef } from "vue";
import { useI18n } from "vue-i18n";
import IndexService from "../../../services/index";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete"
import { useStore } from "vuex";

export default defineComponent({
    name: "AddSettingVariable",

    setup(props) {
        const { t } = useI18n();
        const store = useStore();
        const data: any = reactive({
            schemaResponse: [],
            streamType: ["logs", "metrics", "traces"],
            streams: [],
            currentFieldsList: [],

            // selected values
            selectedStreamFields: []
        });
        // const model = ref(null)
        // const filteredStreams = ref([]);
        const variableTypes = ref([
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
            type: "",
            query_data: {
                stream_type: "",
                stream: "",
                field: "",
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
                data.schemaResponse = res.data?.list || [];
            });
        };

        // select filters
        const { filterFn: streamsFilterFn, filteredOptions: streamsFilteredOptions } = useSelectAutoComplete(toRef(data, 'streams'), 'name')
        const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } = useSelectAutoComplete(toRef(data, 'currentFieldsList'), 'name')

        const streamTypeUpdated = () => {
            const streamType = variableData.query_data.stream_type;
            const filteredStreams = data.schemaResponse.filter((data: any) => data.stream_type === streamType);
            data.streams = filteredStreams;
        };

        const streamUpdated = () => {
            const stream = variableData.query_data.stream;
            data.currentFieldsList = data.schemaResponse.find((item) => item.name === stream)?.schema || [];
        }

        return {
            variableData,
            t,
            getStreamList,
            data,
            streamsFilterFn,
            fieldsFilterFn,
            streamsFilteredOptions,
            fieldsFilteredOptions,
            variableTypes,
            streamTypeUpdated,
            streamUpdated,
            onActivated,
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