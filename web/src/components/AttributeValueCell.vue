<template>
  <div class="tw:flex tw:items-center tw:w-full">
    <ODropdown
      v-if="hasDropdownSlot"
      v-model:open="isDropdownOpen"
      side="bottom"
      align="start"
    >
      <template #trigger>
        <OButton
          data-test="attribute-value-cell-dropdown-btn"
          size="icon-xs"
          variant="ghost"
          aria-label="Add icon"
        >
          <OIcon :name="isDropdownOpen ? 'expand-less' : 'expand-more'" size="xs" />
        </OButton>
      </template>
      <div class="logs-table-list tw:min-w-[180px]">
        <slot name="dropdown" :field="field" :value="value" />
      </div>
    </ODropdown>
    <span class="q-pl-xs tw:truncate">{{ value }}</span>
  </div>
</template>

<script lang="ts">
import { computed, ref, useSlots } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default {
  name: "AttributeValueCell",
  components: {
    OButton,
    ODropdown,
    OIcon,
  },
  props: {
    field: {
      type: String,
      required: true,
    },
    value: {
      type: String,
      default: "",
    },
  },
  setup() {
    const slots = useSlots();
    const hasDropdownSlot = computed(() => !!slots["dropdown"]);
    const isDropdownOpen = ref(false);

    return {
      hasDropdownSlot,
      getImageURL,
      isDropdownOpen,
    };
  },
};
</script>
