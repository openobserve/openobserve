<script lang="ts" setup>
interface Props {
  modelValue: string;
  isSearchActive?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "search-toggled", active: boolean): void;
  (e: "search-cleared"): void;
}>();

const clearSearch = () => {
  emit("search-cleared");
};
</script>

<template>
  <q-input
    :model-value="props.modelValue"
    @update:model-value="$emit('update:modelValue', String($event || ''))"
    dense
    borderless
    placeholder="Search config..."
    class="col config-panel-search"
    clearable
    autofocus
    @clear="clearSearch"
  >
    <template #prepend>
      <q-icon name="search" size="xs" class="q-ml-xs text-grey-6" />
    </template>
  </q-input>
</template>
