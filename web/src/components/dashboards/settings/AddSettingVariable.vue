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
                    <q-select class="textbox" filled use-input hide-selected fill-input input-debounce="0" outlined dense
                        v-model="variableData.type" :options="variableTypes" :label="t('dashboard.typeOfVariable')"
                        option-value="value" emit-value></q-select>
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
                <div v-if="variableData.type == 'query'">
                    <q-select v-model="variableData.query_data.stream_type" :label="t('dashboard.selectStreamType')"
                        :options="data.streamType" input-debounce="0" behavior="menu" filled borderless dense
                        class="textbox" @update:model-value="streamTypeUpdated"></q-select>
                    <q-select v-model="variableData.query_data.stream" :label="t('dashboard.selectIndex')"
                        :options="streamsFilteredOptions" input-debounce="0" behavior="menu" use-input filled borderless
                        dense hide-selected fill-input @filter="streamsFilterFn" @update:model-value="streamUpdated"
                        option-value="name" option-label="name" emit-value class="textbox">
                    </q-select>
                    <q-select v-model="variableData.query_data.field" filled use-input hide-selected fill-input
                        input-debounce="0" :options="fieldsFilteredOptions" @filter="fieldsFilterFn"
                        style="width: 250px; padding-bottom: 32px" class="textbox" option-value="name" option-label="name"
                        emit-value>
                    </q-select>
                </div>
            </div>
            <div class="textbox" v-if="['textbox', 'constant'].includes(variableData.type)">
                <q-input v-model="variableData.value" :label="t('dashboard.ValueOfVariable')" dense outlined></q-input>
            </div>
            <!-- show the auto add variables for the custom fields -->
            <div v-if="variableData.type == 'custom_fields'"
                class="flex textbox flex-row justify-evenly space-x-4 items-end">
                <div class="flex flex-col w-full justify-items-center items-stretch">
                    <div v-for="(option, index) in variableData.options" :key="index" class="flex flex-row space-x-4">
                        <q-input outlined class="textbox q-mx-sm" v-model="variableData.options[index].label"
                            :label="'Item ' + (index + 1)" name="label" />
                        <q-input outlined class="textbox q-mx-sm" v-model="variableData.options[index].value" label="Value"
                            name="value" />
                        <div>
                            <q-btn round color="primary" @click="removeField(index)" icon="cancel" />
                        </div>
                    </div>
                </div>
                <div class="flex flex-col">
                    <q-btn @click="addField()">Add Options</q-btn>
                </div>
            </div>
            <div>
                <q-btn @click="saveData()">Save</q-btn>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onActivated, watch, toRef, toRaw } from "vue";
import { useI18n } from "vue-i18n";
import IndexService from "../../../services/index";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete"
import { useStore } from "vuex";
import { addVariable, updateVariable } from "../../../utils/commons"
import { useRoute } from "vue-router";

export default defineComponent({
    name: "AddSettingVariable",
    props: ['variableData'],

    setup(props, { emit }) {
        const { t } = useI18n();
        const store = useStore();
        const data: any = reactive({
            schemaResponse: [],
            streamType: ["logs", "metrics", "traces"],
            streams: [],
            currentFieldsList: [{ label: '', value: '' }],

            // selected values
            selectedStreamFields: []
        });
        const route = useRoute();
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
            },
            value: "",
            options: []
        })

        const editMode = ref(false)

        onMounted(() => {
            getStreamList();

            if (props.variableData) {
                editMode.value = true
                console.log(variableData);
                console.log(props.variableData);

                Object.assign(variableData, props.variableData)
                console.log('-----------------------------------');

                console.log(variableData);
                console.log(props.variableData);

            } else {
                editMode.value = false
            }
        });

        const addField = () => {
            variableData.options.push({ label: '', value: '' })
        }

        const removeField = (index: any) => {
            variableData.options.splice(index, 1)
        }

        const saveData = async () => {
            const dashId = route.query.dashboard + "";
            console.log("dashId", dashId);

            if (editMode.value) {
                console.log(" inside update variable");
                console.log("variableData", variableData);

                await updateVariable(
                    store,
                    dashId,
                    toRaw(variableData)
                );

                emit('save');

            } else {

                console.log("Inside add variable");
                if (variableData.type != 'query') {
                    delete variableData["query_data"];
                }

                await addVariable(
                    store,
                    dashId,
                    variableData
                );

                emit('save');
            }
        }

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
            data.currentFieldsList = data.schemaResponse.find((item: any) => item.name === stream)?.schema || [];
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
            removeField,
            addField,
            saveData,
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