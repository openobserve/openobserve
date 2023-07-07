<template>
    <div>
        <div class="column full-height">
            <div class="col q-my-sm">
                <div class="text-body1 text-bold ">
                    {{ variableData.label }}
                </div>
            </div>
            <div class="col">
                <div>
                    <q-select class="textbox showLabelOnTop" filled stack-label input-debounce="0" outlined dense
                        v-model="variableData.type" :options="variableTypes" :label="t('dashboard.typeOfVariable')"
                        option-value="value" emit-value></q-select>
                </div>
                <div class="text-body1 text-bold q-mt-lg">
                    {{ t("dashboard.addGeneralSettings") }}
                </div>
              <div class="row">
                <div class="textbox col">
                    <q-input v-model="variableData.name" class="showLabelOnTop q-mr-sm" :label="t('dashboard.nameOfVariable') + ' *'" dense filled outlined stack-label :rules="[(val: any) => !!val || 'Field is required!']"></q-input>
                </div>
                <div class="textbox col">
                    <q-input v-model="variableData.label" class="showLabelOnTop" :label="t('dashboard.labelOfVariable')" dense filled outlined stack-label></q-input>
                </div>
              </div>
                <div class="text-body1 text-bold q-mt-lg">
                    {{ t("dashboard.extraOptions") }}
                </div>
                <div v-if="variableData.type == 'query'">
                  <div class="row">
                    <q-select v-model="variableData.query_data.stream_type" :label="t('dashboard.selectStreamType') + ' *'"
                        :options="data.streamType" input-debounce="0" behavior="menu" filled borderless dense stack-label
                        class="textbox showLabelOnTop col no-case q-mr-sm" @update:model-value="streamTypeUpdated" :rules="[(val: any) => !!val || 'Field is required!']"></q-select>
                    <q-select v-model="variableData.query_data.stream" :label="t('dashboard.selectIndex') + ' *'"
                        :options="streamsFilteredOptions" input-debounce="0" behavior="menu" use-input filled borderless
                        dense stack-label hide-selected fill-input @filter="streamsFilterFn" @update:model-value="streamUpdated"
                        option-value="name" option-label="name" emit-value class="textbox showLabelOnTop col no-case" :rules="[(val: any) => !!val || 'Field is required!']">
                    </q-select>
                  </div>
                    <q-select v-model="variableData.query_data.field" :label="t('dashboard.selectField') + ' *'" 
                        filled stack-label use-input borderless dense hide-selected fill-input behavior="menu"
                        input-debounce="0" :options="fieldsFilteredOptions" @filter="fieldsFilterFn"
                        class="textbox showLabelOnTop no-case" option-value="name" option-label="name"
                        emit-value :rules="[(val: any) => !!val || 'Field is required!']">
                    </q-select>
                </div>
            </div>
            <div class="textbox" v-if="['textbox', 'constant'].includes(variableData.type)">
                <q-input class="showLabelOnTop" v-model="variableData.value" :label="t('dashboard.ValueOfVariable') + ' *'" dense filled outlined stack-label :rules="[(val: any) => !!val || 'Field is required!']"></q-input>
            </div>
            <!-- show the auto add variables for the custom fields -->
            <div v-if="variableData.type == 'custom_fields'">
                    <div v-for="(option, index) in variableData.options" :key="index" class="flex flex-row space-x-4">
                        <q-input dense filled outlined stack-label :rules="[(val: any) => !!val || 'Field is required!']" class="textbox showLabelOnTop q-mr-sm" v-model="variableData.options[index].label"
                            :label="'Label'  + (index + 1) + ' *'" name="label" />
                        <q-input dense filled outlined stack-label :rules="[(val: any) => !!val || 'Field is required!']" class="textbox showLabelOnTop q-mr-sm" v-model="variableData.options[index].value" :label="'Value'+ ' *'"
                            name="value" />
                        <div>
                            <q-btn flat style="margin-top: 33px" round @click="removeField(index)" icon="cancel" />
                        </div>
                    </div>
                <div class="flex flex-col">
                    <q-btn @click="addField()">Add Options</q-btn>
                </div>
            </div>
            <div class="flex justify-center q-mt-lg">
            <q-btn
                  v-close-popup
                  class="q-mb-md text-bold"
                  :label="t('dashboard.cancel')"
                  text-color="light-text"
                  padding="sm md"
                  no-caps
                />
              <div>
                <q-btn :loading="saveVariableApiCall.isLoading.value" @click="saveVariableApiCall.execute()" 
                  class="q-mb-md text-bold no-border q-ml-md"
                  color="secondary"
                  padding="sm xl" no-caps>Save</q-btn>
              </div>
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
import { addVariable, getDashboard, updateVariable } from "../../../utils/commons"
import { useRoute } from "vue-router";
import { useLoading } from "../../../composables/useLoading"

export default defineComponent({
    name: "AddSettingVariable",
    props: ['variableName'],

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

        onMounted(async () => {
            getStreamList();

            if (props.variableName) {
                editMode.value = true
                // Fetch dashboard data
                const data = JSON.parse(JSON.stringify(await getDashboard(store, route.query.dashboard)))?.variables?.list
                 // Find the variable to edit
                const edit = data.find((it:any) => it.name === props.variableName);
                // Assign edit data to variableData
                Object.assign(variableData, edit)

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

        const saveVariableApiCall = useLoading(() => saveData())

        const saveData = async () => {
            const dashId = route.query.dashboard + "";

            if (editMode.value) {

                await updateVariable(
                    store,
                    dashId,
                    props.variableName,
                    toRaw(variableData)
                );

                emit('save');

            } else {

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
            saveVariableApiCall
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