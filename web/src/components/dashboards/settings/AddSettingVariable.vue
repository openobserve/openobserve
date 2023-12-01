<!-- Copyright 2023 Zinc Labs Inc.

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

<template>
  <div>
    <div class="column full-height">
      <DashboardHeader :title="title" backButton @back="close">
      </DashboardHeader>

      <div>
        <q-form greedy ref="addVariableForm" @submit="onSubmit">
          <div class="col">
            <div>
              <q-select
                class="textbox showLabelOnTop"
                filled
                stack-label
                input-debounce="0"
                outlined
                dense
                v-model="variableData.type"
                :options="variableTypes"
                :label="t('dashboard.typeOfVariable')"
                option-value="value"
                map-options
                emit-value
              ></q-select>
            </div>
            <div class="text-body1 text-bold q-mt-lg">
              {{ t("dashboard.addGeneralSettings") }}
            </div>
            <div class="row">
              <div class="textbox col">
                <q-input
                  v-model="variableData.name"
                  class="showLabelOnTop q-mr-sm"
                  :label="t('dashboard.nameOfVariable') + ' *'"
                  dense
                  filled
                  outlined
                  stack-label
                  :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                ></q-input>
              </div>
              <div class="textbox col">
                <q-input
                  v-model="variableData.label"
                  class="showLabelOnTop"
                  :label="t('dashboard.labelOfVariable')"
                  dense
                  filled
                  outlined
                  stack-label
                ></q-input>
              </div>
            </div>
            <div
              class="text-body1 text-bold q-mt-lg"
              v-if="variableData.type !== 'dynamicFilters'"
            >
              {{ t("dashboard.extraOptions") }}
            </div>
            <div v-if="variableData.type == 'query_values'">
              <div class="row">
                <q-select
                  v-model="variableData.query_data.stream_type"
                  :label="t('dashboard.selectStreamType') + ' *'"
                  :options="data.streamType"
                  input-debounce="0"
                  behavior="menu"
                  filled
                  borderless
                  dense
                  stack-label
                  class="textbox showLabelOnTop col no-case q-mr-sm"
                  @update:model-value="streamTypeUpdated"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                ></q-select>
                <q-select
                  v-model="variableData.query_data.stream"
                  :label="t('dashboard.selectIndex') + ' *'"
                  :options="streamsFilteredOptions"
                  input-debounce="0"
                  behavior="menu"
                  use-input
                  filled
                  borderless
                  dense
                  stack-label
                  @filter="streamsFilterFn"
                  @update:model-value="streamUpdated"
                  option-value="name"
                  option-label="name"
                  emit-value
                  class="textbox showLabelOnTop col no-case"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                >
                </q-select>
              </div>
              <q-select
                v-model="variableData.query_data.field"
                :label="t('dashboard.selectField') + ' *'"
                filled
                stack-label
                use-input
                borderless
                dense
                hide-selected
                fill-input
                behavior="menu"
                input-debounce="0"
                :options="fieldsFilteredOptions"
                @filter="fieldsFilterFn"
                class="textbox showLabelOnTop no-case"
                option-value="name"
                option-label="name"
                emit-value
                :rules="[(val: any) => !!val || 'Field is required!']"
              >
              </q-select>
              <div>
                <q-input
                  class="showLabelOnTop"
                  type="number"
                  v-model.number="variableData.query_data.max_record_size"
                  :label="t('dashboard.DefaultSize')"
                  dense
                  filled
                  outlined
                  stack-label
                >
                  <q-btn
                    padding="xs"
                    round
                    flat
                    class="q-ml-sm"
                    no-caps
                    icon="info"
                  >
                    <q-tooltip>{{ t("dashboard.maxRecordSize") }}</q-tooltip>
                  </q-btn>
                </q-input>
              </div>
            </div>
          </div>
          <div class="textbox" v-if="['constant'].includes(variableData.type)">
            <q-input
              class="showLabelOnTop"
              v-model="variableData.value"
              :label="t('dashboard.ValueOfVariable') + ' *'"
              dense
              filled
              outlined
              stack-label
              :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
            ></q-input>
          </div>
          <div class="textbox" v-if="['textbox'].includes(variableData.type)">
            <q-input
              class="showLabelOnTop"
              v-model="variableData.value"
              :label="t('dashboard.DefaultValue')"
              dense
              filled
              outlined
              stack-label
            ></q-input>
          </div>
          <!-- show the auto add variables for the custom fields -->
          <div v-if="variableData.type == 'custom'">
            <div
              v-for="(option, index) in variableData.options"
              :key="index"
              class="row"
            >
              <q-input
                dense
                filled
                outlined
                stack-label
                :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                class="col textbox showLabelOnTop q-mr-sm"
                v-model="variableData.options[index].label"
                :label="'Label ' + (index + 1) + ' *'"
                name="label"
              />
              <q-input
                dense
                filled
                outlined
                stack-label
                :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                class="col textbox showLabelOnTop q-mr-sm"
                v-model="variableData.options[index].value"
                :label="'Value ' + (index + 1) + ' *'"
                name="value"
              />
              <div>
                <q-btn
                  flat
                  style="margin-top: 33px"
                  round
                  @click="removeField(index)"
                  icon="cancel"
                />
              </div>
            </div>
            <div class="flex flex-col">
              <q-btn
                no-caps
                icon="add"
                no-outline
                class="q-mt-md"
                @click="addField()"
                >Add Option</q-btn
              >
            </div>
          </div>
          <div class="flex justify-center q-mt-lg">
            <q-btn
              class="q-mb-md text-bold"
              :label="t('dashboard.cancel')"
              text-color="light-text"
              padding="sm md"
              no-caps
              @click="close"
            />
            <div>
              <q-btn
                type="submit"
                :loading="saveVariableApiCall.isLoading.value"
                class="q-mb-md text-bold no-border q-ml-md"
                color="secondary"
                padding="sm xl"
                no-caps
                >Save</q-btn
              >
            </div>
          </div>
        </q-form>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  reactive,
  onMounted,
  onActivated,
  watch,
  toRef,
  toRaw,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import IndexService from "../../../services/index";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";
import { useStore } from "vuex";
import {
  addVariable,
  getDashboard,
  updateVariable,
} from "../../../utils/commons";
import { useRoute } from "vue-router";
import { useLoading } from "../../../composables/useLoading";
import DashboardHeader from "./common/DashboardHeader.vue";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "AddSettingVariable",
  props: ["variableName"],
  components: { DashboardHeader },
  emits: ["close", "save"],
  setup(props, { emit }) {
    const $q = useQuasar();
    const { t } = useI18n();
    const store = useStore();
    const addVariableForm: Ref<any> = ref(null);
    const data: any = reactive({
      schemaResponse: [],
      streamType: ["logs", "metrics", "traces"],
      streams: [],
      currentFieldsList: [],

      // selected values
      selectedStreamFields: [],
    });
    const route = useRoute();
    const title = ref("Add Variable");
    // const model = ref(null)
    // const filteredStreams = ref([]);
    const variableTypes = ref([
      {
        label: t("dashboard.queryValues"),
        value: "query_values",
      },
      {
        label: t("dashboard.constant"),
        value: "constant",
      },
      {
        label: t("dashboard.textbox"),
        value: "textbox",
      },
      {
        label: t("dashboard.custom"),
        value: "custom",
      },
      {
        label: t("dashboard.ad-hoc-variable"),
        value: "dynamicFilters",
      },
    ]);

    const variableData: any = reactive({
      name: "",
      label: "",
      type: "query_values",
      query_data: {
        stream_type: "",
        stream: "",
        field: "",
        max_record_size: null,
      },
      value: "",
      options: [],
    });

    const editMode = ref(false);

    onMounted(async () => {
      getStreamList();

      if (props.variableName) {
        editMode.value = true;
        title.value = "Edit Variable";
        // Fetch dashboard data
        const data = JSON.parse(
          JSON.stringify(
            await getDashboard(store, route.query.dashboard, route.query.folder)
          )
        )?.variables?.list;
        // Find the variable to edit
        const edit = (data || []).find(
          (it: any) => it.name === props.variableName
        );
        // Assign edit data to variableData
        Object.assign(variableData, edit);
      } else {
        editMode.value = false;
      }
    });

    const addField = () => {
      variableData.options.push({ label: "", value: "" });
    };

    const removeField = (index: any) => {
      variableData.options.splice(index, 1);
    };

    const saveVariableApiCall = useLoading(() => saveData());

    const saveData = async () => {
      const dashId = route.query.dashboard + "";

      if (editMode.value) {
        try {
          await updateVariable(
            store,
            dashId,
            props.variableName,
            toRaw(variableData),
            route.query.folder ?? "default"
          );
          emit("save");
        } catch (error: any) {
          $q.notify({
            type: "negative",
            message: error.message,
            timeout: 2000,
          });
        }
      } else {
        if (variableData.type !== "query_values") {
          delete variableData["query_data"];
        }

        try {
          await addVariable(
            store,
            dashId,
            variableData,
            route.query.folder ?? "default"
          );
          emit("save");
        } catch (error: any) {
          $q.notify({
            type: "negative",
            message: error.message,
            timeout: 2000,
          });
        }
      }
    };
    const onSubmit = () => {
      addVariableForm.value.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        saveVariableApiCall.execute().catch((err: any) => {
          $q.notify({
            type: "negative",
            message: JSON.stringify(
              err.response.data["error"] || "Dashboard creation failed."
            ),
          });
        });
      });
    };
    const getStreamList = () => {
      IndexService.nameList(
        store.state.selectedOrganization.identifier,
        "",
        true
      ).then((res) => {
        data.schemaResponse = res.data?.list || [];
        if (editMode.value) {
          // set the dropdown values
          streamTypeUpdated();
          streamUpdated();
        }
      });
    };

    // select filters
    const {
      filterFn: streamsFilterFn,
      filteredOptions: streamsFilteredOptions,
    } = useSelectAutoComplete(toRef(data, "streams"), "name");
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(toRef(data, "currentFieldsList"), "name");

    const streamTypeUpdated = () => {
      const streamType = variableData?.query_data?.stream_type;
      const filteredStreams = data.schemaResponse.filter(
        (data: any) => data.stream_type === streamType
      );
      data.streams = filteredStreams;
    };

    const streamUpdated = () => {
      const stream = variableData?.query_data?.stream;
      data.currentFieldsList =
        data.schemaResponse.find((item: any) => item.name === stream)?.schema ||
        [];
    };

    const close = () => {
      emit("close");
    };

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
      saveVariableApiCall,
      close,
      title,
      onSubmit,
      addVariableForm,
    };
  },
});
</script>

<style lang="scss" scoped>
:deep(.no-case .q-field__native > :first-child) {
  text-transform: none !important;
}

.textbox {
  margin-top: 5px;
  margin-bottom: 5px;
}
</style>
