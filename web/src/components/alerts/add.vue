<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div v-if="beingUpdated" class="text-h6">
          {{ t("alerts.updateTitle") }}
        </div>
        <div v-else class="text-h6">{{ t("alerts.addTitle") }}</div>
      </div>
    </div>

    <q-separator />
    <div>
      <q-form ref="addAlertForm" @submit="onSubmit">
        <q-input
          v-model="formData.name"
          :label="t('alerts.name')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          v-bind:readonly="beingUpdated"
          v-bind:disable="beingUpdated"
          :rules="[(val: any) => !!val || 'Field is required!']"
          tabindex="0"
        />

        <q-select
          v-model="formData.stream_name"
          :options="indexOptions"
          :label="t('alerts.stream_name')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          @update:model-value="updateAlert(formData.stream_name)"
          :rules="[(val: any) => !!val || 'Field is required!']"
        />

        <div class="q-gutter-sm">
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.isScheduled"
            :checked="formData.isScheduled"
            val="true"
            :label="t('alerts.scheduled')"
          />
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.isScheduled"
            :checked="!formData.isScheduled"
            val="false"
            :label="t('alerts.realTime')"
          />
        </div>

        <!--<q-toggle v-model="formData.isScheduled" :label="t('alerts.isScheduled')" color="input-border" bg-color="input-bg"
          class="q-py-md showLabelOnTop" stack-label outlined filled dense />-->

        <div
          v-if="formData.isScheduled === 'true'"
          class="q-py-sm showLabelOnTop text-bold text-h7"
        >
          {{ t("alerts.sql") }}:
        </div>
        <div
          v-if="formData.isScheduled === 'true'"
          ref="editorRef"
          id="editor"
          :label="t('alerts.sql')"
          stack-label
          style="border: 1px solid #dbdbdb; border-radius: 5px"
          @keyup="editorUpdate"
          @Focusout="updateCondtions"
          class="q-py-sm showLabelOnTop"
          resize
          :rules="[(val: any) => !!val || 'Field is required!']"
        ></div>

        <div class="q-py-sm showLabelOnTop text-bold text-h7">
          {{ t("alerts.condition") }}:
        </div>
        <div class="col-8 row justify-left align-center q-gutter-sm">
          <div class="" style="minwidth: 100px">
            <q-select
              v-model="formData.condition.column"
              :options="triggerCols"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-select>
          </div>
          <div class="" style="minwidth: 100px">
            <q-select
              v-model="formData.condition.operator"
              :options="triggerOperators"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-select>
          </div>
          <div class="" style="width: 80px">
            <q-input
              v-model="formData.condition.value"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-input>
          </div>
        </div>

        <div
          v-if="formData.isScheduled === 'true'"
          class="q-py-sm showLabelOnTop text-bold text-h7"
        >
          {{ t("alerts.duration") }}:
        </div>
        <div
          v-if="formData.isScheduled === 'true'"
          class="col-8 row justify-left align-center q-gutter-sm"
        >
          <div class="" style="width: 80px">
            <q-input
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
              v-model="formData.duration.unit"
              :options="relativePeriods"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-select>
          </div>
        </div>

        <div
          v-if="formData.isScheduled === 'true'"
          class="q-py-sm showLabelOnTop text-bold text-h7"
        >
          {{ t("alerts.interval") }}:
        </div>
        <div
          v-if="formData.isScheduled === 'true'"
          class="col-8 row justify-left align-center q-gutter-sm"
        >
          <div class="" style="width: 80px">
            <q-input
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
              v-model="formData.frequency.unit"
              :options="relativePeriods"
              dense
              filled
              :rules="[(val: any) => !!val || 'Field is required!']"
            ></q-select>
          </div>
        </div>

        <div
          v-if="formData.isScheduled === 'true'"
          class="q-py-sm showLabelOnTop text-bold text-h7"
        >
          {{ t("alerts.delayNotificationUntil") }}:
        </div>
        <div
          v-if="formData.isScheduled === 'true'"
          class="col-8 row justify-left align-center q-gutter-sm"
        >
          <div class="" style="width: 80px">
            <q-input
              v-model="formData.time_between_alerts.value"
              type="number"
              dense
              filled
              min="0"
            ></q-input>
          </div>
          <div class="" style="minwidth: 100px">
            <q-select
              v-model="formData.time_between_alerts.unit"
              :options="relativePeriods"
              dense
              filled
            ></q-select>
          </div>
        </div>

        <q-input
          v-model="formData.destination"
          :label="t('alerts.destination')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Field is required!']"
          tabindex="0"
        />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold no-border"
            :label="t('alerts.cancel')"
            text-color="light-text"
            padding="sm md"
            color="accent"
            no-caps
            @click="$emit('cancel:hideform')"
          />
          <q-btn
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
import { defineComponent, ref, onMounted } from "vue";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import alertsService from "../../services/alerts";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import IndexService from "../../services/index";
import { Parser } from "node-sql-parser";

const defaultValue: any = () => {
  return {
    name: "",
    sql: "",
    isScheduled: "true",
    stream_name: "",
    condition: {
      column: "",
      operator: "",
      value: "",
    },
    duration: {
      value: 0,
      unit: "",
    },
    frequency: {
      value: 0,
      unit: "",
    },
    time_between_alerts: {
      value: 0,
      unit: "",
    },
    destination: "",
  };
};

let callAlert: Promise<{ data: any }>;

export default defineComponent({
  name: "ComponentAddUpdateUser",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:list", "cancel:hideform"],
  setup() {
    const store: any = useStore();
    let beingUpdated: boolean = false;
    const addAlertForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const { t } = useI18n();
    const $q = useQuasar();
    const editorRef: any = ref(null);
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

    const editorUpdate = (e: any) => {
      formData.sql = e.target.value;
    };

    const updateCondtions = (e: any) => {
      const ast = parser.astify(e.target.value);
      sqlAST = ast;
      sqlAST.columns.forEach(function (item: any, index: any) {
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
    };
    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");

    let parser = new Parser();

    onMounted(async () => {
      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          {
            token: "comment",
            foreground: "ffa500",
            fontStyle: "italic underline",
          },
          { token: "comment.js", foreground: "008800", fontStyle: "bold" },
          { token: "comment.css", foreground: "0000ff" }, // will inherit fontStyle from `comment` above
        ],
        colors: {
          "editor.foreground": "#000000",
        },
      });
      editorobj = monaco.editor.create(editorRef.value, {
        value: ``,
        language: "sql",
        minimap: {
          enabled: false,
        },
        theme: "myCustomTheme",
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
      prefixCode.value = `select * from`;
      suffixCode.value = "'" + formData.value.stream_name + "'";
      const someCode = `${prefixCode.value} ${editorData.value} ${suffixCode.value}`;
      editorobj.setValue(someCode);
      formData.value.sql = editorobj.getValue();
      const selected_stream: any = schemaList.value.filter(
        (stream) => stream["name"] === stream_name
      );
      selected_stream[0].schema.forEach(function (item: any, index: any) {
        triggerCols.value.push(item.name);
      });
    };

    return {
      t,
      $q,
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
      triggerCols,
      triggerOperators,
      sqlAST,
      schemaList,
    };
  },

  created() {
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...this.modelValue };
    this.beingUpdated = this.isUpdated;

    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = this.modelValue;
    }

    IndexService.nameList(
      this.store.state.selectedOrganization.identifier,
      "",
      true
    ).then((res) => {
      this.schemaList = res.data.list;
      this.indexOptions = res.data.list.map((data: any) => {
        return data.name;
      });
    });
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.$q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },

    onSubmit() {
      if (this.formData.stream_name == "") {
        this.$q.notify({
          type: "negative",
          message: "Please select stream name.",
          timeout: 1500,
        });
        return false;
      }

      const dismiss = this.$q.notify({
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
          };
        }

        callAlert = alertsService.create(
          this.store.state.selectedOrganization.identifier,
          this.formData.stream_name,
          submitData
        );

        callAlert.then((res: { data: any }) => {
          const data = res.data;
          this.formData = { ...defaultValue };

          this.$emit("update:list");
          this.addAlertForm.resetValidation();
          dismiss();
          this.$q.notify({
            type: "positive",
            message: `Alert saved successfully.`,
          });
        });
      });
    },
  },
});
</script>

<style scoped>
#editor {
  width: 100%;
  min-height: 5rem;
  padding-bottom: 14px;
  resize: both;
}
</style>
