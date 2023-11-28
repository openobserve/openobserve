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
  <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col" data-test="add-alert-title">
        <div v-if="beingUpdated" class="text-h6">
          {{ t("alerts.updateTitle") }}
        </div>
        <div v-else class="text-h6">{{ t("alerts.addTitle") }}</div>
      </div>
    </div>

    <q-separator />
    <div>
      <q-form class="add-alert-form" ref="addAlertForm" @submit="onSubmit">
        <div class="row q-pb-sm q-pt-md q-col-gutter-md">
          <div class="col-4 alert-name-input">
            <q-input
              data-test="add-alert-name-input"
              v-model="formData.name"
              :label="t('alerts.name')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />
          </div>
          <div class="col-4 alert-stream-type">
            <q-select
              v-model="formData.stream_type"
              :options="streamTypes"
              :label="t('alerts.stream_type')"
              :popup-content-style="{ textTransform: 'capitalize' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              @update:model-value="updateStreams()"
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
          <div class="col-4">
            <q-select
              data-test="add-alert-stream-select"
              v-model="formData.stream_name"
              :options="filteredStreams"
              :label="t('alerts.stream_name')"
              :loading="isFetchingStreams"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop no-case"
              filled
              borderless
              dense
              use-input
              hide-selected
              fill-input
              @filter="filterStreams"
              @update:model-value="updateAlert(formData.stream_name)"
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
        </div>
        <div class="q-gutter-sm">
          <q-radio
            data-test="add-alert-scheduled-alert-radio"
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.isScheduled"
            :checked="formData.isScheduled"
            val="true"
            :label="t('alerts.scheduled')"
            class="q-ml-none"
          />
          <q-radio
            data-test="add-alert-realtime-alert-radio"
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.isScheduled"
            :checked="!formData.isScheduled"
            val="false"
            :label="t('alerts.realTime')"
            class="q-ml-none"
          />
        </div>

        <!--<q-toggle v-model="formData.isScheduled" :label="t('alerts.isScheduled')" color="input-border" bg-color="input-bg"
                                                          class="q-py-md showLabelOnTop" stack-label outlined filled dense />-->

        <div
          v-if="formData.isScheduled === 'true'"
          class="q-py-sm showLabelOnTop text-bold text-h7"
          data-test="add-alert-query-input-title"
        >
          {{ t("alerts.sql") }}:
        </div>
        <div
          data-test="add-alert-query-input"
          v-show="formData.isScheduled === 'true'"
          ref="editorRef"
          id="editor"
          :label="t('alerts.sql')"
          stack-label
          style="border: 1px solid #dbdbdb; border-radius: 5px"
          @keyup="editorUpdate"
          @focusout="updateCondtions"
          class="showLabelOnTop"
          resize
          :rules="[(val: any) => !!val || 'Field is required!']"
        ></div>

        <div
          class="q-pt-md q-py-sm showLabelOnTop text-bold text-h7"
          data-test="add-alert-condition-title"
        >
          {{ t("alerts.condition") }}:
        </div>
        <div
          class="col-8 row justify-left align-center q-gutter-sm alert-condition"
        >
          <div class="__column" :title="formData.condition.column">
            <q-select
              data-test="add-alert-condition-column-select"
              v-model="formData.condition.column"
              :options="filteredColumns"
              :loading="isFetchingStreams"
              filled
              borderless
              dense
              use-input
              hide-selected
              fill-input
              input-debounce="500"
              behavior="menu"
              :rules="[(val: any) => !!val || 'Field is required!']"
              @filter="filterConditions"
            ></q-select>
          </div>
          <div class="__operator">
            <q-select
              data-test="add-alert-condition-operator-select"
              v-model="formData.condition.operator"
              :options="triggerOperators"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-select>
          </div>
          <div class="__value">
            <q-input
              data-test="add-alert-condition-value-input"
              v-model="formData.condition.value"
              dense
              placeholder="value"
              filled
              :title="formData.condition.value"
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-input>
          </div>
        </div>

        <div v-if="formData.isScheduled === 'true'" class="row q-col-gutter-sm">
          <div class="col-4">
            <div
              class="q-py-sm showLabelOnTop text-bold text-h7"
              data-test="add-alert-duration-title"
            >
              {{ t("alerts.duration") }}:
            </div>
            <div class="col-8 row justify-left align-center q-gutter-sm">
              <div class="" style="width: 80px">
                <q-input
                  data-test="add-alert-duration-input"
                  v-model="formData.duration.value"
                  type="number"
                  dense
                  filled
                  min="0"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                ></q-input>
              </div>
              <div class="" style="minwidth: 100px">
                <q-select
                  data-test="add-alert-duration-select"
                  v-model="formData.duration.unit"
                  :options="relativePeriods"
                  dense
                  filled
                  :rules="[(val: any) => !!val || 'Field is required!']"
                ></q-select>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div
              class="q-py-sm showLabelOnTop text-bold text-h7"
              data-test="add-alert-frequency-title"
            >
              {{ t("alerts.interval") }}:
            </div>
            <div class="col-8 row justify-left align-center q-gutter-sm">
              <div class="" style="width: 80px">
                <q-input
                  data-test="add-alert-frequency-input"
                  v-model="formData.frequency.value"
                  type="number"
                  dense
                  filled
                  min="0"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                ></q-input>
              </div>
              <div class="" style="minwidth: 100px">
                <q-select
                  data-test="add-alert-frequency-select"
                  v-model="formData.frequency.unit"
                  :options="relativePeriods"
                  dense
                  filled
                  :rules="[(val: any) => !!val || 'Field is required!']"
                ></q-select>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div
              class="q-py-sm showLabelOnTop text-bold text-h7"
              data-test="add-alert-delay-title"
            >
              {{ t("alerts.delayNotificationUntil") }}:
            </div>
            <div class="col-8 row justify-left align-center q-gutter-sm">
              <div class="" style="width: 80px">
                <q-input
                  data-test="add-alert-delay-input"
                  v-model="formData.time_between_alerts.value"
                  type="number"
                  dense
                  filled
                  min="0"
                ></q-input>
              </div>
              <div class="" style="minwidth: 100px">
                <q-select
                  data-test="add-alert-delay-select"
                  v-model="formData.time_between_alerts.unit"
                  :options="relativePeriods"
                  dense
                  filled
                ></q-select>
              </div>
            </div>
          </div>
        </div>

        <div class="q-gutter-sm">
          <q-select
            data-test="add-alert-destination-select"
            v-model="formData.destination"
            :label="t('alerts.destination')"
            :options="getFormattedDestinations"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            :rules="[(val: any) => !!val || 'Field is required!']"
          />
        </div>

        <div class="flex justify-center q-mt-lg">
          <q-btn
            data-test="add-alert-cancel-btn"
            v-close-popup="true"
            class="q-mb-md text-bold"
            :label="t('alerts.cancel')"
            text-color="light-text"
            padding="sm md"
            no-caps
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            data-test="add-alert-submit-btn"
            :label="t('alerts.save')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, type Ref } from "vue";

import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

import alertsService from "../../services/alerts";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import streamService from "../../services/stream";
import { Parser } from "node-sql-parser/build/mysql";
import segment from "../../services/segment_analytics";
const defaultValue: any = () => {
  return {
    name: "",
    sql: "",
    isScheduled: "true",
    stream_name: "",
    stream_type: "logs",
    condition: {
      column: "",
      operator: "",
      value: "",
    },
    duration: {
      value: 0,
      unit: "Minutes",
    },
    frequency: {
      value: 0,
      unit: "Minutes",
    },
    time_between_alerts: {
      value: 0,
      unit: "Minutes",
    },
    destination: "",
  };
};
let callAlert: Promise<{ data: any }>;
export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:list", "cancel:hideform"],
  setup(props) {
    const store: any = useStore();
    let beingUpdated: boolean = false;
    const addAlertForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const { t } = useI18n();
    const q = useQuasar();
    const editorRef: any = ref(null);
    const filteredColumns: any = ref([]);
    const filteredStreams: Ref<string[]> = ref([]);
    let editorobj: any = null;
    var sqlAST: any = ref(null);
    const selectedRelativeValue = ref("1");
    const selectedRelativePeriod = ref("Minutes");
    const relativePeriods: any = ref(["Minutes"]);
    var triggerCols: any = ref([]);
    var triggerOperators: any = ref([
      "=",
      "!=",
      ">=",
      "<=",
      ">",
      "<",
      "Contains",
      "NotContains",
    ]);
    const isFetchingStreams = ref(false);
    const streamTypes = ["logs", "metrics", "traces"];
    const editorUpdate = (e: any) => {
      formData.value.sql = e.target.value;
    };
    const updateCondtions = (e: any) => {
      try {
        const ast = parser.astify(e.target.value);
        if (ast) sqlAST.value = ast;
        else return;

        // If sqlAST.value.columns is not type of array then return
        if (!sqlAST.value) return;
        if (!Array.isArray(sqlAST.value?.columns)) return;

        sqlAST.value.columns.forEach(function (item: any) {
          let val;
          if (item["as"] === undefined || item["as"] === null) {
            val = item["expr"]["column"];
          } else {
            val = item["as"];
          }
          if (!triggerCols.value.includes(val)) {
            triggerCols.value.push(val);
          }
        });
      } catch (e) {
        console.log("Alerts: Error while parsing SQL query");
      }
    };
    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");
    let parser = new Parser();
    onMounted(async () => {
      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs",
        inherit: true,
        rules: [
          {
            token: "comment",
            foreground: "ffa500",
            background: "FFFFFF",
            fontStyle: "italic underline",
          },
          {
            token: "comment.js",
            foreground: "008800",
            fontStyle: "bold",
            background: "FFFFFF",
          },
          { token: "comment.css", foreground: "0000ff", background: "FFFFFF" }, // will inherit fontStyle from `comment` above
        ],
        colors: {
          "editor.foreground": "#000000",
          "editor.background": "#FFFFFF",
          "editorCursor.foreground": "#000000",
          "editor.lineHighlightBackground": "#FFFFFF",
          "editorLineNumber.foreground": "#000000",
          "editor.border": "#FFFFFF",
        },
      });
      editorobj = monaco.editor.create(editorRef.value, {
        value: ``,
        language: "sql",
        minimap: {
          enabled: false,
        },
        theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
      });
      editorobj.onKeyUp((e: any) => {
        if (editorobj.getValue() != "") {
          editorData.value = editorobj.getValue();
          formData.value.sql = editorobj.getValue();
        }
      });
      editorobj.setValue(formData.value.sql);
    });
    const updateAlert = (stream_name: any) => {
      updateEditorContent(stream_name);
    };
    const updateEditorContent = (stream_name: string) => {
      triggerCols.value = [];
      if (stream_name == "") {
        return;
      }
      if (editorData.value != "") {
        editorData.value = editorData.value
          .replace(prefixCode.value, "")
          .trim();
        editorData.value = editorData.value
          .replace(suffixCode.value, "")
          .trim();
      }

      if (!props.isUpdated) {
        prefixCode.value = `select * from`;
        suffixCode.value = "'" + formData.value.stream_name + "'";
        const someCode = `${prefixCode.value} ${editorData.value} ${suffixCode.value}`;
        editorobj.setValue(someCode);
      }

      formData.value.sql = editorobj.getValue();
      const selected_stream: any = schemaList.value.filter(
        (stream) => stream["name"] === stream_name
      );
      selected_stream[0].schema.forEach(function (item: any, index: any) {
        triggerCols.value.push(item.name);
      });
    };
    watch(
      triggerCols.value,
      () => {
        filteredColumns.value = [...triggerCols.value];
      },
      { immediate: true }
    );
    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter(
          (column: any) => column.toLowerCase().indexOf(value) > -1
        );
      });
      return filteredOptions;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) formData.value.stream_name = "";
      if (streams.value[formData.value.stream_type]) {
        schemaList.value = streams.value[formData.value.stream_type];
        indexOptions.value = streams.value[formData.value.stream_type].map(
          (data: any) => {
            return data.name;
          }
        );
        return;
      }
      isFetchingStreams.value = true;
      return streamService
        .nameList(
          store.state.selectedOrganization.identifier,
          formData.value.stream_type,
          true
        )
        .then((res) => {
          streams.value[formData.value.stream_type] = res.data.list;
          schemaList.value = res.data.list;
          indexOptions.value = res.data.list.map((data: any) => {
            return data.name;
          });
          return Promise.resolve();
        })
        .catch(() => Promise.reject())
        .finally(() => (isFetchingStreams.value = false));
    };
    const filterConditions = (val: string, update: any) => {
      filteredColumns.value = filterColumns(triggerCols.value, val, update);
    };
    const filterStreams = (val: string, update: any) => {
      filteredStreams.value = filterColumns(indexOptions.value, val, update);
    };
    return {
      t,
      q,
      disableColor,
      beingUpdated,
      formData,
      addAlertForm,
      store,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorData,
      selectedRelativeValue,
      selectedRelativePeriod,
      relativePeriods,
      editorUpdate,
      updateCondtions,
      updateAlert,
      updateEditorContent,
      filterColumns,
      triggerCols,
      triggerOperators,
      sqlAST,
      schemaList,
      filteredColumns,
      streamTypes,
      streams,
      updateStreams,
      isFetchingStreams,
      filterConditions,
      filteredStreams,
      filterStreams,
    };
  },
  created() {
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...this.modelValue };
    this.beingUpdated = this.isUpdated;
    this.updateStreams(false)?.then(() => {
      this.updateEditorContent(this.formData.stream_name);
    });
    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = this.modelValue;
      this.formData.destination = this.modelValue.destination;
    }
  },
  computed: {
    getFormattedDestinations: function () {
      return this.destinations.map((destination: any) => destination.name);
    },
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },
    onSubmit() {
      if (this.formData.stream_name == "") {
        this.q.notify({
          type: "negative",
          message: "Please select stream name.",
          timeout: 1500,
        });
        return false;
      }
      const dismiss = this.q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.addAlertForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }
        let submitData = {};
        if (
          this.formData.isScheduled === "false" ||
          !this.formData.isScheduled
        ) {
          submitData = {
            name: this.formData.name,
            stream_name: this.formData.stream_name,
            condition: this.formData.condition,
            duration: Number(this.formData.duration.value),
            frequency: Number(this.formData.frequency.value),
            time_between_alerts: Number(
              this.formData.time_between_alerts.value
            ),
            destination: this.formData.destination,
            stream_type: this.formData.stream_type,
          };
        } else {
          submitData = {
            name: this.formData.name,
            query: {
              sql: this.formData.sql,
              from: 0,
              size: 100,
              sql_mode: "full",
            },
            stream_name: this.formData.stream_name,
            condition: this.formData.condition,
            duration: Number(this.formData.duration.value),
            frequency: Number(this.formData.frequency.value),
            time_between_alerts: Number(
              this.formData.time_between_alerts.value
            ),
            destination: this.formData.destination,
            stream_type: this.formData.stream_type,
          };
        }
        this.schemaList.forEach((stream: any) => {
          if (stream.name == this.formData.stream_name) {
            stream.schema.forEach((field: any) => {
              if (field.name == this.formData.condition.column) {
                if (field.type != "Utf8") {
                  this.formData.condition.value = parseInt(
                    this.formData.condition.value
                  );
                }
              }
            });
          }
        });
        callAlert = alertsService.create(
          this.store.state.selectedOrganization.identifier,
          this.formData.stream_name,
          this.formData.stream_type,
          submitData
        );
        callAlert
          .then((res: { data: any }) => {
            const data = res.data;
            this.formData = { ...defaultValue };
            this.$emit("update:list");
            this.addAlertForm.resetValidation();
            dismiss();
            this.q.notify({
              type: "positive",
              message: `Alert saved successfully.`,
            });
          })
          .catch((err: any) => {
            dismiss();
            this.q.notify({
              type: "negative",
              message: err.response?.data?.error || err.response?.data?.message,
            });
          });
        segment.track("Button Click", {
          button: "Save Alert",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.formData.stream_name,
          alert_name: this.formData.name,
          page: "Add/Update Alert",
        });
      });
    },
  },
});
</script>

<style scoped lang="scss">
#editor {
  width: 100%;
  min-height: 5rem;
  // padding-bottom: 14px;
  resize: both;
}
.alert-condition {
  .__column,
  .__value {
    width: 250px;
  }
  .__operator {
    width: 100px;
  }
}
</style>
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}
.add-alert-form {
  .q-field--dense .q-field__control {
    height: 40px !important;
    .q-field__native span {
      overflow: hidden;
    }
  }
  .alert-condition .__column .q-field__control .q-field__native span {
    max-width: 152px;
    text-overflow: ellipsis;
    text-align: left;
    white-space: nowrap;
  }
  .q-field__bottom {
    padding: 8px 0;
  }
}
</style>
