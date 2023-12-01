<template>
  <div>
    <fields-input
      class="q-mt-md"
      :stream-fields="columns"
      :fields="conditions"
      @add="addField"
      @remove="removeField"
    />
  </div>
</template>

<script lang="ts" setup>
import FieldsInput from "./FieldsInput.vue";

const props = defineProps(["columns", "conditions"]);

const emits = defineEmits(["field:add", "field:remove", "update:conditions"]);

const addField = (field: any) => {
  emits("field:add", field);
};

const removeField = (field: any) => {
  emits("field:remove", field);
};

</script>

<style lang="scss" scoped></style>
