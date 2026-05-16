<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
  <OInput
    :model-value="props.modelValue"
    @update:model-value="$emit('update:modelValue', String($event || ''))"
    :placeholder="t('dashboard.configPanelSearchPlaceholder')"
    class="col config-panel-search"
    clearable
    autofocus
  >
    <template #icon-left>
      <OIcon name="search" size="xs" class="tw:text-[var(--o2-text-muted)]" />
    </template>
  </OInput>
</template>
