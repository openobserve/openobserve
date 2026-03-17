<script lang="ts" setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface Props {
  modelValue: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();
</script>

<template>
  <q-input
    :model-value="props.modelValue"
    @update:model-value="$emit('update:modelValue', String($event || ''))"
    dense
    borderless
    :placeholder="t('dashboard.configPanelSearchPlaceholder')"
    class="col config-panel-search"
    clearable
  >
    <template #prepend>
      <q-icon name="search" size="xs" class="q-ml-xs text-grey-6" />
    </template>
  </q-input>
</template>
