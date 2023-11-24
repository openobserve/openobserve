<template>
  <div>
    <div class="text-bold">Conditions</div>
    <div
      v-for="(field, index) in fields"
      :key="field.uuid"
      class="flex justify-start items-end q-col-gutter-sm q-pb-sm"
    >
      <div class="q-ml-none">
        <q-select
          v-model="field.column"
          :options="streamFields"
          :popup-content-style="{ textTransform: 'capitalize' }"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          filled
          borderless
          dense
          use-input
          hide-selected
          fill-input
          input-debounce="500"
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
          icon="delete"
          class="q-ml-xs iconHoverBtn"
          padding="sm"
          unelevated
          size="sm"
          round
          flat
          :title="t('alert_templates.edit')"
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
          @click="addApiHeader(field)"
          style="min-width: auto"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineProps, ref } from "vue";
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();

const deleteApiHeader = (field) => {
  emits("remove", field);
};

const addApiHeader = (field) => {
  emits("add", field);
};
</script>

<style lang="scss" scoped></style>
