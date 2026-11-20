<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OButton from "./OButton.vue";
import OButtonGroup from "./OButtonGroup.vue";
import type { SplitButtonEmits, SplitButtonProps, SplitButtonSlots } from "./OSplitButton.types";

const props = withDefaults(defineProps<SplitButtonProps>(), {
  icon: undefined,
  variant: "secondary",
  size: "md",
  menuLabel: undefined,
  loading: false,
  disabled: false,
  stale: false,
  shortcut: undefined,
});

const emit = defineEmits<SplitButtonEmits>();
defineSlots<SplitButtonSlots>();
const { t } = useI18nTyped();
</script>

<template>
  <OButtonGroup :size="props.size" data-o2-split>
    <OButton
      :variant="variant"
      :icon="icon"
      :label="label"
      :loading="loading"
      :disabled="disabled"
      :stale="stale"
      :shortcut="shortcut"
      @click="emit('click', $event)"
    />
    <ODropdown align="end">
      <template #trigger>
        <OButton
          :variant="variant"
          icon-only
          icon="arrow-drop-down"
          :disabled="disabled || loading"
          :aria-label="menuLabel ?? t('common.moreOptions')"
        />
      </template>
      <slot name="menu" />
    </ODropdown>
  </OButtonGroup>
</template>
