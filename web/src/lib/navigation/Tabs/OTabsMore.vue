<script setup lang="ts">
// Internal to OTabs: the "More ▾" tab that holds the tabs past the sixth (guideline N2).
import type { TabsOverflowItem, TabsSize } from "./OTabs.types";
import { computed } from "vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  items: TabsOverflowItem[];
  activeName: string | number;
  size: TabsSize;
}>();

const emit = defineEmits<{ (e: "select", item: TabsOverflowItem): void }>();

const { t } = useI18nTyped();

const activeItem = computed(() => props.items.find((item) => item.name === props.activeName));
</script>

<template>
  <ODropdown side="bottom" align="end">
    <template #trigger>
      <button
        type="button"
        role="tab"
        :aria-selected="activeItem ? 'true' : 'false'"
        aria-haspopup="menu"
        data-test="o-tabs-more"
        :class="[
          'o-tab rounded-t-default inline-flex shrink-0 cursor-pointer items-center gap-1 border-b-2 border-transparent px-2',
          'text-compact font-medium whitespace-nowrap outline-none select-none',
          'focus-visible:outline-focus-ring-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
          size === 'compact' ? 'h-control-md' : 'h-tabs-height',
          activeItem ? 'text-text-heading' : 'text-text-secondary hover:text-tabs-hover-text',
        ]"
      >
        <span>{{ activeItem ? activeItem.label : t("components.tabs.more") }}</span>
        <OIcon name="expand-more" size="sm" class="size-3.5! shrink-0" />
      </button>
    </template>
    <ODropdownItem
      v-for="item in items"
      :key="item.name"
      :disabled="item.disabled"
      :data-test="item.dataTest"
      :data-state="item.name === activeName ? 'active' : 'inactive'"
      @select="emit('select', item)"
    >
      <span class="flex w-full items-center gap-2">
        <span class="min-w-0 flex-1">{{ item.label }}</span>
        <span
          v-if="item.count != null"
          class="text-2xs text-text-secondary shrink-0 font-medium tabular-nums"
          >{{ item.count > 999 ? "999+" : item.count }}</span
        >
        <OIcon
          v-if="item.name === activeName"
          name="check"
          size="sm"
          class="text-tabs-active-text shrink-0"
        />
      </span>
    </ODropdownItem>
  </ODropdown>
</template>
