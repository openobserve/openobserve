<template>
  <div
    class="functions-toolbar tw-pb-1.5 tw-w-full tw-flex tw-justify-between tw-items-center"
  >
    <div class="tw-flex tw-items-center o2-input">
      <q-icon class="tw-pr-1" name="arrow_back_ios" size="18px" />
      <div class="tw-text-lg tw-w-full">Add Function</div>
      <q-input
        v-model="functionName"
        :label="t('function.name')"
        color="input-border"
        bg-color="input-bg"
        class="q-pa-none tw-w-full q-ml-md"
        stack-label
        outlined
        filled
        dense
        v-bind:readonly="disableName"
        v-bind:disable="disableName"
        :rules="[
          (val: any) => !!val || 'Field is required!',
          isValidMethodName,
        ]"
        tabindex="0"
        style="min-width: 300px"
      />
    </div>
    <div class="add-function-actions flex justify-center">
      <q-btn
        v-close-popup="true"
        class="text-bold tw-border-primary"
        :label="t('common.fullscreen')"
        text-color="primary"
        padding="sm"
        no-caps
        icon="fullscreen"
      />
      <q-btn
        :label="t('function.testFunction')"
        class="text-bold no-border tw-ml-[12px]"
        color="primary"
        padding="sm md"
        type="submit"
        no-caps
        @click="emit('test')"
      />
      <q-btn
        :label="t('function.save')"
        class="text-bold no-border tw-ml-[12px]"
        color="secondary"
        padding="sm md"
        no-caps
        @click="emit('save')"
      />
      <q-btn
        v-close-popup="true"
        class="cancel-btn text-bold tw-ml-[12px] tw-border-3 tw-border-red-600"
        :label="t('function.cancel')"
        text-color="negative"
        padding="sm md"
        no-caps
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  computed,
  watch,
  defineEmits,
} from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  disableName: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["test", "save", "update:name"]);

const isValidMethodName = () => {
  const methodPattern = /^[$A-Z_][0-9A-Z_$]*$/i;
  return methodPattern.test(props.name) || "Invalid method name.";
};

const functionName = computed({
  get: () => props.name,
  set: (value) => emit("update:name", value),
});
</script>
<style scoped lang="scss">
.functions-toolbar {
  :deep(.q-field__bottom) {
    display: none;
  }

  .add-function-actions {
    :deep(.q-btn) {
      padding-top: 4px !important;
      padding-bottom: 4px !important;
      font-size: 13px;
    }
    :deep(.q-btn .q-icon) {
      margin-right: 2px;
    }

    :deep(.block) {
      font-weight: lighter;
    }

    :deep(.cancel-btn)::before {
      border: 1px solid var(--q-negative) !important;
    }
  }
}
</style>
