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
                  :rules="[
                    (val: any) => !!(val.trim()) || 'Field is required!',
                    (val: any) => !val.includes(' ') || 'Only word characters are allowed in variable names'
                ]"
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
              v-if="variableData.type !== 'dynamic_filters'"
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
              <div>
                <div
                  data-test="dashboard-query-values-filter"
                  class="text-body1 text-bold q-mt-lg"
                >
                  Filters
                </div>
                <div class="row items-center">
                  <div
                    class="row no-wrap items-center q-mb-xs"
                    v-for="(filter, index) in variableData.query_data.filter"
                    :key="index"
                  >
                    <q-select
                      filled
                      outlined
                      dense
                      v-model="filter.name"
                      :display-value="filter.name ? filter.name : ''"
                      :options="fieldsFilteredOptions"
                      input-debounce="0"
                      behavior="menu"
                      @update:model-value="filterUpdated(index, $event)"
                      use-input
                      stack-label
                      option-label="name"
                      data-test="dashboard-query-values-filter-name-selector"
                      @filter="fieldsFilterFn"
                      :placeholder="filter.name ? '' : 'Select Field'"
                      class="textbox col no-case q-ml-sm"
                      :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                    >
                      <template v-slot:no-option>
                        <q-item>
                          <q-item-section class="text-italic text-grey"
                            >No Data Found</q-item-section
                          >
                        </q-item>
                      </template>
                    </q-select>
                    <q-select
                      dense
                      filled
                      v-model="filter.operator"
                      :display-value="filter.operator ? filter.operator : ''"
                      style="width: auto"
                      class="operator"
                      data-test="dashboard-query-values-filter-operator-selector"
                      :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                    />
                    <q-input
                      v-model="filter.value"
                      placeholder="Enter Value"
                      dense
                      filled
                      debounce="1000"
                      style="width: 125px"
                      class=""
                      data-test="dashboard-query-values-filter-value"
                      :rules="[(val: any) => !!(val.trim()) || 'Field is required!']"
                    />
                    <q-btn
                      class="q-ml-sm"
                      size="sm"
                      padding="13px 2px"
                      square
                      flat
                      dense
                      @click="removeFilter(index)"
                      icon="close"
                      :data-test="`dashboard-variable-adhoc-close-${index}`"
                    />
                  </div>
                </div>
                <div>
                  <q-btn
                    no-caps
                    icon="add"
                    no-outline
                    class="q-mt-md"
                    @click="addFilter"
                    data-test="dashboard-add-filter-btn"
                  >
                    Add Filter
                  </q-btn>
                </div>

                <!-- show error if filter has cycle -->
                <div v-show="filterCycleError" style="color: red">
                  {{ filterCycleError }}
                </div>
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
import useStreams from "@/composables/useStreams";

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
    const { getStreams, getStream } = useStreams();

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
    ]);

    const variableData: any = reactive({
      name: "",
      label: "",
      type: "",
      query_data: {
        stream_type: "",
        stream: "",
        field: "",
        max_record_size: null,
        filter: [],
      },
      value: "",
      options: [],
    });

    const filterCycleError: any = ref("");

    console.log("variableData", variableData.query_data);

    const addFilter = () => {
      if (!variableData.query_data.filter) {
        variableData.query_data.filter = [];
      }
      variableData.query_data.filter.push({
        name: "",
        operator: "=",
        value: "",
      });
    };

    const filterUpdated = (index: number, filter: any) => {
      variableData.query_data.filter[index].name = filter.name;
    };

    const removeFilter = (index: any) => {
      variableData.query_data.filter.splice(index, 1);
    };

    const editMode = ref(false);

    onMounted(async () => {
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
        // default variable type will be query_values
        variableData.type = "query_values";
        editMode.value = false;
      }
    });

    // check if type is query_values then get stream list and field list
    watch(
      () => [variableData.type],
      async () => {
        if (variableData.type == "query_values") {
          // add query_data object if not have
          if (!variableData?.query_data) {
            variableData.query_data = {
              stream_type: "",
              stream: "",
              field: "",
              max_record_size: null,
            };
          }

          // if variable type is query_values
          // need to get the stream list
          // and followed by the field list
          try {
            // if stream type is exists
            if (variableData?.query_data?.stream_type) {
              // get all streams from current stream type
              const streamList: any = await getStreams(
                variableData?.query_data?.stream_type,
                false
              );
              data.streams = streamList.list ?? [];

              // if stream type and stream is exists
              if (variableData?.query_data?.stream) {
                // get schema of that field using getstream
                const fieldWithSchema: any = await getStream(
                  variableData?.query_data?.stream,
                  variableData.query_data.stream_type,
                  true
                );

                // assign the schema
                data.currentFieldsList = fieldWithSchema?.schema ?? [];
              } else {
                // reset field list array
                data.currentFieldsList = [];
              }
            } else {
              // reset stream and field list
              data.streams = [];
              data.currentFieldsList = [];
            }
          } catch (error: any) {
            $q.notify({
              type: "negative",
              message: error ?? "Failed to get stream fields",
              timeout: 2000,
            });
          }
        }
      }
    );

    const addField = () => {
      variableData.options.push({ label: "", value: "" });
    };

    const removeField = (index: any) => {
      variableData.options.splice(index, 1);
    };

    const saveVariableApiCall = useLoading(async () => await saveData());

    const saveData = async () => {
      const dashId = route.query.dashboard + "";

      // remove query_data if type is not query_values
      if (variableData.type !== "query_values") {
        delete variableData["query_data"];
      }

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
            message: error.message ?? "Variable update failed",
            timeout: 2000,
          });
        }
      } else {
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
            message: error.message ?? "Variable creation failed",
            timeout: 2000,
          });
        }
      }
    };

    // Function to detect cycle in a graph
    // will be called recursively
    function isGraphHasCyclicUtil(
      node: any,
      visited: any,
      recStack: any,
      graph: any,
      path: any
    ) {
      // node should be not visited
      if (!visited[node]) {
        // Mark the current node as visited and part of recursion stack
        visited[node] = true;
        recStack[node] = true;
        path.push(node);

        // Recur for all the vertices adjacent to this vertex
        // recursion call to all it's child node
        for (let i = 0; i < graph[node].length; i++) {
          let child = graph[node][i];

          // if child is not visited and not part of recursion stack
          // if child is already visited and part of recursion stack. so it means there is a cycle in the graph
          if (
            !visited[child] &&
            isGraphHasCyclicUtil(child, visited, recStack, graph, path)
          ) {
            return true;
          } else if (recStack[child]) {
            return true;
          }
        }
      }
      // Remove the vertex from recursion stack and path
      recStack[node] = false;
      path.pop();
      return false;
    }

    // Function to detect cycle in a graph
    function isGraphHasCyclic(graph: any) {
      // Mark all the vertices as not visited and not part of recursion stack

      // visited object is used to check if a vertex is visited or not
      let visited: any = {};
      // recStack object is used to check if a vertex is part of recursion stack
      let recStack: any = {};
      // path array is used to store the path
      let path: any = [];

      // Initialize all vertices as not visited and not part of recursion stack
      for (let node in graph) {
        visited[node] = false;
        recStack[node] = false;
      }

      // Call the recursive helper function to detect cycle in different DFS trees
      for (let node in graph) {
        // Start from all vertices one by one and check if a cycle is formed
        if (isGraphHasCyclicUtil(node, visited, recStack, graph, path)) {
          // Cycle found
          // so, return path
          return path;
        }
      }
      // no cycle found
      return null;
    }

    // A helper function to extract variable names from a string
    function extractVariableNames(str: any, variableNames: any) {
      let regex = /\$(\w+)/g;
      let match;
      let names = [];
      while ((match = regex.exec(str)) !== null) {
        // Only include the variable name if it exists in the list of variables
        if (variableNames.has(match[1])) {
          names.push(match[1]);
        }
      }
      // Remove duplicates by converting to a set and back to an array
      return [...new Set(names)];
    }

    // check if filter has cycle
    const isFilterHasCycle = async () => {
      try {
        // need all variables to check for cycle
        // get all variables data.
        let variablesData: any = JSON.parse(
          JSON.stringify(
            await getDashboard(store, route.query.dashboard, route.query.folder)
          )
        )?.variables?.list;

        // current updated variable data need to merge/update in above variablesData.
        // temporary update variable list
        // if edit mode, then update the variable data
        if (editMode.value) {
          //if name already exists
          const variableIndex = variablesData.findIndex(
            (variable: any) => variable.name == props.variableName
          );

          // Update the variable data in the list
          variablesData[variableIndex] = variableData;
        }
        // else, it's a new variable.
        else {
          variablesData.push(variableData);
        }

        // need list of variable names
        // Create a set of variable names
        let variablesNameList = new Set(
          variablesData.map((variable: any) => variable.name)
        );

        // now, need to check whether filter has cycle or not
        // key: variable name
        // value: list of dependencies(variable names)
        let variablesDependencyGraph: any = {};

        // Initialize all variables has empty dependency list in the variablesDependencyGraph
        for (let variable of variablesData) {
          variablesDependencyGraph[variable.name] = [];
        }

        // Populate the variablesDependencyGraph
        for (let variableData of variablesData) {
          let name = variableData.name;
          for (let filter of variableData.query_data.filter ?? []) {
            // Extract variable names from the filter value
            let extactedDependencies = extractVariableNames(
              filter.value,
              variablesNameList
            );
            // Add the dependencies to the variablesDependencyGraph
            if (variablesDependencyGraph[name]) {
              variablesDependencyGraph[name].push(...extactedDependencies);
            } else {
              variablesDependencyGraph[name] = extactedDependencies;
            }
          }
        }

        // if graph has cycle, it will return the cycle path
        // else it will return null
        const hasCycle = isGraphHasCyclic(variablesDependencyGraph);
        if (hasCycle) {
          // filter has cycle, so show error and return
          filterCycleError.value = `Variables has cycle: ${hasCycle.join(
            "->"
          )}`;
          return true;
        }

        // above conditions passed, so remove filter cycle error and return false
        filterCycleError.value = "";
        return false;
      } catch (err: any) {
        $q.notify({
          type: "negative",
          message:
            err?.message ??
            (editMode.value
              ? "Variable update failed"
              : "Variable creation failed"),
        });
        return true;
      }
    };

    const onSubmit = () => {
      // first, validate form values
      addVariableForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        // check if filter has cycle
        if (await isFilterHasCycle()) {
          // filter has cycle, so show error and return
          return false;
        }

        // above conditions passed, so remove filter cycle error
        filterCycleError.value = "";

        // save the variable
        saveVariableApiCall.execute().catch((err: any) => {
          $q.notify({
            type: "negative",
            message:
              err?.message ??
              (editMode.value
                ? "Variable update failed"
                : "Variable creation failed"),
          });
        });
      });
    };

    // select filters
    const {
      filterFn: streamsFilterFn,
      filteredOptions: streamsFilteredOptions,
    } = useSelectAutoComplete(toRef(data, "streams"), "name");
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(toRef(data, "currentFieldsList"), "name");

    const streamTypeUpdated = async () => {
      // reset the stream and field
      variableData.query_data.stream = "";
      variableData.query_data.field = "";

      // if stream type is exists
      if (variableData.query_data.stream_type) {
        // get all streams from current stream type
        const streamList: any = await getStreams(
          variableData?.query_data?.stream_type,
          false
        );

        // assign the stream list
        data.streams = streamList.list ?? [];
      } else {
        // reset stream list
        data.streams = [];
      }
    };

    const streamUpdated = async () => {
      // reset field list value
      variableData.query_data.field = "";

      try {
        // if stream type and stream is exists
        if (
          variableData.query_data.stream &&
          variableData.query_data.stream_type
        ) {
          // get schema of that field using getstream
          const fieldWithSchema: any = await getStream(
            variableData?.query_data?.stream,
            variableData.query_data.stream_type,
            true
          );

          // assign the schema
          data.currentFieldsList = fieldWithSchema?.schema ?? [];
        } else {
          // reset field list
          data.currentFieldsList = [];
        }
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: error ?? "Failed to get stream fields",
          timeout: 2000,
        });
      }
    };

    const close = () => {
      emit("close");
    };

    return {
      variableData,
      t,
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
      addFilter,
      removeFilter,
      filterUpdated,
      filterCycleError,
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
