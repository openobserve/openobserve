<template>
  <div class="tw:flex tw:items-center tw:w-full">
    <ODropdown
      v-if="hasDropdownSlot"
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
          <img :src="getImageURL('images/common/add_icon.svg')" class="tw:size-3" alt="" />
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
import { computed, useSlots } from "vue";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default {
  name: "AttributeValueCell",
  components: {
    OButton,
    ODropdown,
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

    return {
      hasDropdownSlot,
      getImageURL,
    };
  },
};
</script>
