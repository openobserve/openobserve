<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

const { t } = useI18n();

interface Props {
  modelValue: string;
}

const props = defineProps<Props>();

defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();
</script>

<template>
  <OSearchInput
    id="dashboard-config-panel-search-input"
    data-test="dashboard-config-panel-search"
    :model-value="props.modelValue"
    @update:model-value="$emit('update:modelValue', String($event || ''))"
    :placeholder="t('dashboard.configPanelSearchPlaceholder')"
    class="flex flex-col config-panel-search"
    size="xs"
    clearable
    autofocus
  />
</template>
