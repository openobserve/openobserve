<template>
  <div
    class="field_overlay tw:absolute tw:right-0 tw:top-[50%] tw:translate-y-1/2 table-cell-actions tw:translate-y-[-50%] tw:h-full! tw:flex! tw:items-center tw:justify-center tw:rounded"
    :class="backgroundClass"
    :title="row[column.id]"
    :data-test="`log-add-data-from-column-${row[column.id]}`"
  >
    <span class="tw:mx-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="copyLogToClipboard(row[column.id])"
        title="Copy"
      >
        <OIcon name="content-copy" size="10px" />
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="tw:mr-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="
          addSearchTerm(column.id, row[column.id], 'include')
        "
        :data-test="`log-details-include-field-${row[column.id]}`"
        title="Include Term"
      >
        <OIcon style="height: 8px; width: 8px">
          <EqualIcon></EqualIcon>
        </OIcon>
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="tw:mr-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="
          addSearchTerm(column.id, row[column.id], 'exclude')
        "
        title="Exclude Term"
        :data-test="`log-details-exclude-field-${row[column.id]}`"
      >
        <OIcon style="height: 8px; width: 8px">
          <NotEqualIcon></NotEqualIcon>
        </OIcon>
      </OButton>
    </span>
    <!-- o2 ai context add button in the cell actions when user adds a interesting field to the table 
     then we show some options there we need this  -->
    <O2AIContextAddBtn
      v-if="!hideAi"
      @send-to-ai-chat="sendToAiChat(JSON.stringify(row[column.id]))"
      :style="'border: 1px solid #fff;'"
      :size="'6px'"
      :imageHeight="'16px'"
      :imageWidth="'16px'"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PropType } from "vue";
import { useStore } from "vuex";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
  row: {
    type: Object,
    required: true,
  },
  selectedStreamFields: {
    type: Array as PropType<Array<{ name: string; isSchemaField: boolean }>>,
    required: true,
    default: () => [],
  },
  hideSearchTermActions: {
    type: Boolean,
    default: false,
  },
  hideAi: {
    type: Boolean,
    default: false,
  },
});

const store = useStore();

const emit = defineEmits([
  "copy",
  "addSearchTerm",
  "addFieldToTable",
  "sendToAiChat",
]);

const copyLogToClipboard = (value: any) => {
  emit("copy", value);
};
const addSearchTerm = (
  field: string,
  field_value: string | number | boolean,
  action: string,
) => {
  emit("addSearchTerm", field, field_value, action);
};

const backgroundClass = computed(() =>
  store.state.theme === "dark" ? "tw:bg-black" : "tw:bg-white",
);
const sendToAiChat = (value: any) => {
  emit("sendToAiChat", value);
};

const isStreamField = computed(() => {
  const field: any = props.selectedStreamFields?.find(
    (item: any) => item.name === props.column.id,
  );
  return field?.isSchemaField ?? false;
});
</script>
