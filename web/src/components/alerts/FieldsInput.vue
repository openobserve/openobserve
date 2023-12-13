<template>
  <div>
    <div class="text-bold">Conditions *</div>
    <template v-if="!fields.length">
      <q-btn
        color="primary"
        class="q-mt-sm text-bold add-field"
        label="Add Condition"
        size="sm"
        icon="add"
        style="
          border-radius: 4px;
          text-transform: capitalize;
          background: #f2f2f2 !important;
          color: #000 !important;
        "
        @click="addApiHeader"
      />
    </template>
    <template v-else>
      <div
        v-for="(field, index) in (fields as any)"
        :key="field.uuid"
        class="flex justify-start items-end q-col-gutter-sm q-pb-sm"
      >
        <div class="q-ml-none">
          <q-select
            v-model="field.column"
            :options="filteredFields"
            :popup-content-style="{ textTransform: 'lowercase' }"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            filled
            borderless
            emit-value
            dense
            use-input
            hide-selected
            fill-input
            :input-debounce="400"
            :placeholder="t('alerts.column')"
            @filter="filterColumns"
            behavior="menu"
            :rules="[(val: any) => !!val || 'Field is required!']"
            style="min-width: 250px"
          />
        </div>
        <div class="q-ml-none">
          <q-select
            v-model="field.operator"
            :options="triggerOperators"
            :popup-content-style="{ textTransform: 'capitalize' }"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[(val: any) => !!val || 'Field is required!']"
            style="min-width: 130px"
          />
        </div>
        <div class="q-ml-none flex items-end">
          <q-input
            v-model="field.value"
            :options="streamFields"
            :popup-content-style="{ textTransform: 'capitalize' }"
            :placeholder="t('common.value')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[(val: any) => !!val || 'Field is required!']"
            style="min-width: 250px"
          />
        </div>
        <div class="q-ml-none" style="margin-bottom: 12px">
          <q-btn
            :data-test="`add-destination-header-${field['key']}-delete-btn`"
            :icon="outlinedDelete"
            class="q-ml-xs iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alert_templates.edit')"
            :disable="fields.length === 1"
            @click="deleteApiHeader(field)"
            style="min-width: auto"
          />
          <q-btn
            data-test="add-destination-add-header-btn"
            v-if="index === fields.length - 1"
            icon="add"
            class="q-ml-xs iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alert_templates.edit')"
            @click="addApiHeader()"
            style="min-width: auto"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { defineProps, ref } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

const props = defineProps({
  fields: {
    type: Array,
    default: () => [],
    required: true,
  },
  streamFields: {
    type: Array,
    default: () => [],
    required: true,
  },
});
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
const emits = defineEmits(["add", "remove"]);

const filteredFields = ref(props.streamFields);

const { t } = useI18n();

const deleteApiHeader = (field: any) => {
  emits("remove", field);
};

const addApiHeader = () => {
  emits("add");
};

const filterColumns = (val: string, update: Function) => {
  if (val === "") {
    update(() => {
      filteredFields.value = [...props.streamFields];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredFields.value = props.streamFields.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  });
};
</script>

<style lang="scss">
.add-field {
  .q-icon {
    margin-right: 4px !important;
    font-size: 15px !important;
  }
}
</style>
