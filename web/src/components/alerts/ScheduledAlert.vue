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
      <div class="flex items-center q-mr-sm">
        <div class="text-bold" style="width: 180px">
          {{ t("alerts.period") }}
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
              background: #f2f2f2;
              height: 40px;
              font-weight: normal;
            "
            class="flex justify-center items-center"
          >
            {{ t("alerts.minutes") }}
          </div>
        </div>
      </div>

      <div class="flex justify-start items-center q-mt-sm">
        <div class="text-bold" style="width: 180px">
          {{ t("alerts.threshold") }}
        </div>
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
              min="1"
              style="background: none"
              @update:model-value="updateTrigger"
            />
          </div>
          <div
            style="
              min-width: 90px;
              margin-left: 0 !important;
              background: #f2f2f2;
              height: 40px;
              font-weight: normal;
            "
            class="flex justify-center items-center"
          >
            {{ t("alerts.times") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import FieldsInput from "./FieldsInput.vue";
import { useI18n } from "vue-i18n";
import QueryEditor from "@/components/QueryEditor.vue";

const props = defineProps([
  "columns",
  "conditions",
  "trigger",
  "sql",
  "query_type",
]);

const emits = defineEmits([
  "field:add",
  "field:remove",
  "update:trigger",
  "update:query_type",
  "update:sql",
]);

const { t } = useI18n();

const triggerData = ref(props.trigger);

const query = ref(props.sql);

const tab = ref(props.query_type || "custom");

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
  emits("update:query_type", tab.value);
};

defineExpose({
  selectedTab: tab.value,
});
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
}
</style>
