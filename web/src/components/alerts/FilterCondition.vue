<template>
    <div class=" tw-flex tw-items-start tw-gap-2 tw-flex-no-wrap ">
      <div class="tw-text-sm tw-w-[20px] tw-mr-2 tw-mt-2">
        {{
        index == 0 && depth == 0 ? 'if' : computedLabel
           }}
      </div>
        <div
          data-test="alert-conditions-select-column"
          class="q-ml-none tw-mb-2"
        >
          <q-select
            v-model="condition.column"
            :options="filteredFields"
            :popup-content-style="{ textTransform: 'lowercase' }"
            borderless
            emit-value
            dense
            use-input
            hide-selected
            fill-input
            hide-bottom-space
            :input-debounce="400"
            :placeholder="t('alerts.column')"
            @filter="filterColumns"
            behavior="menu"
            :rules="[(val: any) => !!val || 'Field is required!']"
            @update:model-value="emits('input:update', 'conditions', condition)"
          >
          <q-tooltip v-if="condition.column && store.state.isAiChatEnabled">
            {{ condition.column }}
          </q-tooltip>
        </q-select>
        </div>
        <div
          data-test="alert-conditions-operator-select"
          class="q-ml-none"
        >
          <q-select
            v-model="condition.operator"
            :options="triggerOperators"
            :popup-content-style="{ textTransform: 'capitalize' }"
            stack-label
            borderless
            dense
            hide-bottom-space
            :rules="[(val: any) => !!val || 'Field is required!']"
            :class="store.state.isAiChatEnabled ? 'tw-w-[70px]' : 'xl:tw-min-w-[200px] lg:tw-min-w-[90px] lg:tw-w-fit'"
            @update:model-value="emits('input:update', 'conditions', condition)"
          >
          <q-tooltip v-if="condition.operator && store.state.isAiChatEnabled">
            {{ condition.operator }}
          </q-tooltip>
        </q-select>
        </div>
        <div
          data-test="alert-conditions-value-input"
          class="q-ml-none"
        >
          <q-input
            v-model="condition.value"
            :options="streamFields"
            :popup-content-style="{ textTransform: 'capitalize' }"
            :placeholder="t('common.value')"
            stack-label
            borderless
            dense
            hide-bottom-space
            :rules="[(val: any) => !!val || 'Field is required!']"
            :class="store.state.isAiChatEnabled ? 'tw-w-[110px]' : 'xl:tw-min-w-[200px] lg:tw-w-fit lg:tw-min-w-[80px]'"
            @update:model-value="emits('input:update', 'conditions', condition)"

          >
          <q-tooltip v-if="condition.value && store.state.isAiChatEnabled">
            {{ condition.value }}
          </q-tooltip>
        </q-input>
        </div>
    </div>
  </template>
  
  <script setup lang="ts">
  const props = defineProps({
        condition: {
        type: Object,
        default: () => {},
        required: true,
        },
    streamFields: {
        type: Array,
        default: () => [],
        required: true,
    },
    index: {
        type: Number,
        default: 0,
        required: true,
    },
    label: {
        type: String,
        default: '',
        required: true,
    },
    depth: {
        type: Number,
        default: 0,
        required: true,
    },
    });

import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";

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
const emits = defineEmits(["add", "remove", "input:update", "add-group"]);

const filteredFields = ref(props.streamFields);

const store = useStore();

const { t } = useI18n();

const deleteApiHeader = (field: any) => {
  emits("remove", field);
  emits("input:update", "conditions", field);
};

const addApiHeader = (groupId: string) => {
  emits("add", groupId);
};

const addGroupApiHeader = (groupId: string) => {
  emits("add-group", groupId);
};

const computedLabel = computed(() => {
  return props.label;
});


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

  <style > 
</style>
  