<template>
  <div
    class="field_overlay absolute right-0 top-[50%] table-cell-actions translate-y-[-50%] h-full! flex! items-center justify-center rounded-default max-h-10! px-2"
    :class="backgroundClass"
    :title="row[column.id]"
    :data-test="`log-add-data-from-column-${row[column.id]}`"
  >
    <span class="mx-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="copyLogToClipboard(row[column.id])"
        :title="t('logs.cellActions.copy')"
      >
        <OIcon name="content-copy" size="xs" />
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="mr-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="
          addSearchTerm(column.id, row[column.id], 'include')
        "
        :data-test="`log-details-include-field-${row[column.id]}`"
        :title="t('logs.cellActions.includeTerm')"
      >
        <OIcon style="height: 8px; width: 8px">
          <EqualIcon class="size-full" />
        </OIcon>
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="mr-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="
          addSearchTerm(column.id, row[column.id], 'exclude')
        "
        :title="t('logs.cellActions.excludeTerm')"
        :data-test="`log-details-exclude-field-${row[column.id]}`"
      >
        <OIcon style="height: 8px; width: 8px">
          <NotEqualIcon class="size-full" />
        </OIcon>
      </OButton>
    </span>
    <!-- o2 ai context add button in the cell actions when user adds a interesting field to the table 
     then we show some options there we need this  -->
    <O2AIContextAddBtn
      v-if="!hideAi"
      @send-to-ai-chat="sendToAiChat(JSON.stringify(row[column.id]))"
      class="border border-solid border-white"
      :size="'6px'"
      :imageHeight="'16px'"
      :imageWidth="'16px'"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PropType } from "vue";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();

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

const backgroundClass = "bg-surface-base";
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
