<template>
  <div class="flex w-full items-center">
    <ODropdown v-if="hasDropdownSlot" v-model:open="isDropdownOpen" side="bottom" align="start">
      <template #trigger>
        <OButton
          data-test="attribute-value-cell-dropdown-btn"
          size="icon-xs"
          variant="ghost"
          :aria-label="t('components.attributeValueCell.addIcon')"
          :icon-left="isDropdownOpen ? 'expand-less' : 'expand-more'"
        >
          <OTooltip :content="t('components.attributeValueCell.addIcon')" />
        </OButton>
      </template>
      <div class="logs-table-list min-w-45">
        <slot name="dropdown" :field="field" :value="value" />
      </div>
    </ODropdown>
    <OTruncatedText class="ps-1">{{ value }}</OTruncatedText>
  </div>
</template>

<script lang="ts">
import { computed, ref, useSlots } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

export default {
  name: "AttributeValueCell",
  components: {
    OTooltip,
    OButton,
    ODropdown,
    OTruncatedText,
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
    const { t } = useI18nTyped();

    return {
      hasDropdownSlot,
      getImageURL,
      isDropdownOpen,
      t,
    };
  },
};
</script>
