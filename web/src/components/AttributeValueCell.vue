<template>
  <div class="tw:flex tw:items-center tw:w-full">
    <q-btn-dropdown
      v-if="hasDropdownSlot"
      data-test="attribute-value-cell-dropdown-btn"
      size="0.5rem"
      flat
      outlined
      filled
      dense
      class="pointer"
      :name="'img:' + getImageURL('images/common/add_icon.svg')"
      aria-label="Add icon"
    >
      <q-list class="logs-table-list">
        <slot name="dropdown" :field="field" :value="value" />
      </q-list>
    </q-btn-dropdown>
    <span class="q-pl-xs tw:truncate">{{ value }}</span>
  </div>
</template>

<script lang="ts">
import { computed, useSlots } from "vue";
import { getImageURL } from "@/utils/zincutils";

export default {
  name: "AttributeValueCell",
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
