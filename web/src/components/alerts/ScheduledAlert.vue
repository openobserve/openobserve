<template>
  <div class="scheduled-alerts">
    <div class="scheduled-alert-tabs q-mb-lg">
      <q-tabs
        v-model="tab"
        no-caps
        outside-arrows
        size="sm"
        mobile-arrows
        class="bg-white text-primary"
        @update:model-value="updateTab"
      >
        <q-tab name="custom" :label="t('alerts.custom')" />
        <q-tab name="sql" :label="t('alerts.sql')" />
      </q-tabs>
    </div>
    <template v-if="tab === 'custom'">
      <fields-input
        class="q-mt-md"
        :stream-fields="columns"
        :fields="conditions"
        @add="addField"
        @remove="removeField"
      />
    </template>
    <template v-else>
      <div class="text-bold q-mr-sm q-my-sm">SQL</div>
      <query-editor
        ref="queryEditorRef"
        editor-id="alerts-query-editor"
        class="monaco-editor q-mb-md"
        v-model:query="query"
        @update:query="updateQueryValue"
      />
    </template>

    <div class="q-mt-sm">
      <div class="flex justify-start items-center text-bold q-mb-sm">
        <div style="width: 172px">Aggregation</div>
        <q-toggle
          v-model="_isAggregationEnabled"
          size="sm"
          color="primary"
          class="text-bold q-pl-0"
          :disable="tab === 'sql'"
          @update:model-value="updateAggregation"
        />
      </div>
      <div
        v-if="_isAggregationEnabled && aggregationData"
        class="flex items-center no-wrap q-mr-sm q-mb-sm"
      >
        <div class="text-bold" style="width: 180px">
          {{ t("alerts.groupBy") }}
        </div>
        <div
          class="flex justify-start items-center flex-wrap"
          style="width: calc(100% - 180px)"
        >
          <template
            v-for="(group, index) in aggregationData.group_by"
            :key="group"
          >
            <div class="flex justify-start items-center no-wrap">
              <q-select
                data-test="add-alert-stream-select"
                v-model="aggregationData.group_by[index]"
                :options="filteredFields"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop no-case q-py-none q-mb-sm"
                filled
                borderless
                dense
                use-input
                emit-value
                hide-selected
                placeholder="Select column"
                fill-input
                :input-debounce="400"
                @filter="filterColumns"
                :rules="[(val: any) => !!val || 'Field is required!']"
                style="width: 200px; border: 1px solid rgba(0, 0, 0, 0.05)"
                @update:model-value="updateTrigger"
              />
              <q-btn
                :icon="outlinedDelete"
                class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="sm"
                round
                flat
                :title="t('alert_templates.delete')"
                @click="deleteGroupByColumn(index)"
                style="min-width: auto"
              />
            </div>
          </template>
          <q-btn
            icon="add"
            class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="xs"
            unelevated
            size="sm"
            round
            flat
            :title="t('common.add')"
            @click="addGroupByColumn()"
            style="min-width: auto"
          />
        </div>
      </div>
      <div class="flex justify-start items-center q-mb-md">
        <div class="text-bold" style="width: 180px">
          {{ t("alerts.threshold") + " *" }}
        </div>
        <template v-if="_isAggregationEnabled && aggregationData">
          <div class="threshould-input q-mr-xs">
            <q-select
              data-test="add-alert-stream-select"
              v-model="aggregationData.function"
              :options="aggFunctions"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case q-py-none"
              filled
              borderless
              dense
              use-input
              hide-selected
              fill-input
              :rules="[(val: any) => !!val || 'Field is required!']"
              style="width: 88px; border: 1px solid rgba(0, 0, 0, 0.05)"
              @update:model-value="updateTrigger"
            />
          </div>
          <div class="threshould-input q-mr-xs">
            <q-select
              data-test="add-alert-stream-select"
              v-model="aggregationData.having.column"
              :options="filteredNumericColumns"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case q-py-none"
              filled
              borderless
              dense
              use-input
              emit-value
              hide-selected
              fill-input
              :rules="[(val: any) => !!val || 'Field is required!']"
              @filter="filterNumericColumns"
              style="width: 250px; border: 1px solid rgba(0, 0, 0, 0.05)"
              @update:model-value="updateTrigger"
            />
          </div>
          <div class="threshould-input q-mr-xs">
            <q-select
              data-test="add-alert-stream-select"
              v-model="aggregationData.having.operator"
              :options="triggerOperators"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case q-py-none"
              filled
              borderless
              dense
              use-input
              hide-selected
              fill-input
              :rules="[(val: any) => !!val || 'Field is required!']"
              style="width: 88px; border: 1px solid rgba(0, 0, 0, 0.05)"
              @update:model-value="updateTrigger"
            />
          </div>
          <div
            class="flex items-center"
            style="border: 1px solid rgba(0, 0, 0, 0.05)"
          >
            <div
              style="width: 150px; margin-left: 0 !important"
              class="silence-notification-input"
            >
              <q-input
                data-test="add-alert-delay-input"
                v-model="aggregationData.having.value"
                type="number"
                dense
                filled
                min="0"
                style="background: none"
                placeholder="Value"
                @update:model-value="updateTrigger"
              />
            </div>
          </div>
        </template>
        <template v-else>
          <div class="threshould-input">
            <q-select
              data-test="add-alert-stream-select"
              v-model="triggerData.operator"
              :options="triggerOperators"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop no-case q-py-none"
              filled
              borderless
              dense
              use-input
              hide-selected
              fill-input
              :rules="[(val: any) => !!val || 'Field is required!']"
              style="width: 88px; border: 1px solid rgba(0, 0, 0, 0.05)"
              @update:model-value="updateTrigger"
            />
          </div>
          <div
            class="flex items-center"
            style="border: 1px solid rgba(0, 0, 0, 0.05); border-left: none"
          >
            <div
              style="width: 89px; margin-left: 0 !important"
              class="silence-notification-input"
            >
              <q-input
                data-test="add-alert-delay-input"
                v-model="triggerData.threshold"
                type="number"
                dense
                filled
                min="0"
                style="background: none"
                @update:model-value="updateTrigger"
              />
            </div>
            <div
              style="
                min-width: 90px;
                margin-left: 0 !important;
                height: 40px;
                font-weight: normal;
              "
              :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
              class="flex justify-center items-center"
            >
              {{ t("alerts.times") }}
            </div>
          </div>
        </template>
      </div>
      <div class="flex items-center q-mr-sm">
        <div class="text-bold" style="width: 180px">
          {{ t("alerts.period") + " *" }}
        </div>
        <div
          class="flex items-center q-mr-sm"
          style="border: 1px solid rgba(0, 0, 0, 0.05); width: fit-content"
        >
          <div
            style="width: 87px; margin-left: 0 !important"
            class="silence-notification-input"
          >
            <q-input
              data-test="add-alert-delay-input"
              v-model="triggerData.period"
              type="number"
              dense
              filled
              min="1"
              style="background: none"
              @update:model-value="updateTrigger"
            />
          </div>
          <div
            style="
              min-width: 90px;
              margin-left: 0 !important;
              height: 40px;
              font-weight: normal;
            "
            :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
            class="flex justify-center items-center"
          >
            {{ t("alerts.minutes") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, type Ref } from "vue";
import FieldsInput from "./FieldsInput.vue";
import { useI18n } from "vue-i18n";
import QueryEditor from "@/components/QueryEditor.vue";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";

const props = defineProps([
  "columns",
  "conditions",
  "trigger",
  "sql",
  "query_type",
  "aggregation",
  "isAggregationEnabled",
]);

const emits = defineEmits([
  "field:add",
  "field:remove",
  "update:trigger",
  "update:query_type",
  "update:sql",
  "update:aggregation",
  "update:isAggregationEnabled",
]);

const { t } = useI18n();

const triggerData = ref(props.trigger);

const query = ref(props.sql);

const tab = ref(props.query_type || "custom");

const store = useStore();

const aggFunctions = ["avg", "max", "min", "count"];

const _isAggregationEnabled = ref(props.isAggregationEnabled);

const aggregationData = ref(props.aggregation);

const filteredFields = ref(props.columns);

const getNumericColumns = computed(() => {
  return props.columns.filter((column: any) => {
    return (
      column.type !== "Utf8" &&
      column.value !== store.state.zoConfig.timestamp_column
    );
  });
});

const filteredNumericColumns = ref(getNumericColumns.value);

watch(
  () => props.isAggregationEnabled,
  (val) => {
    if (val) {
      _isAggregationEnabled.value = val;
    }
  }
);

const addField = () => {
  emits("field:add");
};

var triggerOperators: any = ref(["=", "!=", ">=", "<=", ">", "<"]);

const removeField = (field: any) => {
  emits("field:remove", field);
};

const updateQueryValue = (value: string) => {
  query.value = value;
  emits("update:sql", value);
};

const updateTrigger = () => {
  emits("update:trigger", triggerData.value);
};

const updateTab = () => {
  _isAggregationEnabled.value = false;
  emits("update:query_type", tab.value);
};

defineExpose({
  tab,
});

const addGroupByColumn = () => {
  const aggregationDataCopy = { ...aggregationData.value };
  aggregationDataCopy.group_by.push("");
  emits("update:aggregation", aggregationDataCopy);
};

const deleteGroupByColumn = (index: number) => {
  const aggregationDataCopy = { ...aggregationData.value };
  aggregationDataCopy.group_by.splice(index, 1);
  emits("update:aggregation", aggregationDataCopy);
};

const updateAggregation = () => {
  if (!props.aggregation) {
    aggregationData.value = {
      group_by: [""],
      function: "avg",
      having: {
        column: "",
        operator: "=",
        value: "",
      },
    };
  }
  emits("update:aggregation", aggregationData.value);
  emits("update:isAggregationEnabled", _isAggregationEnabled.value);
};

const filterColumns = (val: string, update: Function) => {
  if (val === "") {
    update(() => {
      filteredFields.value = [...props.columns];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredFields.value = props.columns.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  });
};

const filterNumericColumns = (val: string, update: Function) => {
  if (val === "") {
    update(() => {
      filteredNumericColumns.value = [...getNumericColumns.value];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredNumericColumns.value = getNumericColumns.value.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  });
};
</script>

<style lang="scss" scoped>
.scheduled-alert-tabs {
  border: 1px solid $primary;
  width: 210px;
  border-radius: 4px;
  overflow: hidden;
}
</style>
<style lang="scss">
.scheduled-alert-tabs {
  .q-tab--active {
    background-color: $primary;
    color: $white;
  }

  .q-tab__indicator {
    display: none;
  }

  .q-tab {
    height: 28px;
    min-height: 28px;
  }
}
.scheduled-alerts {
  .monaco-editor {
    width: 500px !important;
    height: 100px !important;
    border: 1px solid $border-color;
  }

  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
}
</style>
