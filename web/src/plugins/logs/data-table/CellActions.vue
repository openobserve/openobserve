<template>
  <div
    v-if="assistantV2"
    class="field_overlay table-cell-actions flex items-center gap-1"
    :data-test="`log-add-data-from-column-${cellValue}`"
  >
    <OButton
      variant="ghost"
      size="icon-xs-circle"
      :aria-label="t('logs.cellActions.copy')"
      class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      @click.prevent.stop="copyLogToClipboard(cellValue)"
    >
      <OIcon name="content-copy" size="xs" />
      <OTooltip :content="t('logs.cellActions.copy')" />
    </OButton>
    <template v-if="isStreamField && !hideSearchTermActions">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        :aria-label="t('logs.cellActions.includeTerm')"
        class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        :data-test="`log-details-include-field-${cellValue}`"
        @click.prevent.stop="addSearchTerm(column.id, cellValue, 'include')"
      >
        <OIcon name="" size="xs"><EqualIcon class="size-2" /></OIcon>
        <OTooltip :content="t('logs.cellActions.includeTerm')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        :aria-label="t('logs.cellActions.excludeTerm')"
        class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        :data-test="`log-details-exclude-field-${cellValue}`"
        @click.prevent.stop="addSearchTerm(column.id, cellValue, 'exclude')"
      >
        <OIcon name="" size="xs"><NotEqualIcon class="size-2" /></OIcon>
        <OTooltip :content="t('logs.cellActions.excludeTerm')" />
      </OButton>
    </template>
    <template v-if="!hideAi">
      <AiEntryButton v-bind="fieldDoor('explain')" appearance="toolbar-icon" />
      <AiEntryButton v-bind="fieldDoor('add_to_chat')" appearance="toolbar-icon" />
    </template>
  </div>
  <!-- Flow content: OTable's hover-action toolbar owns the surface and the
       positioning, so this is just the button row. -->
  <div
    v-else
    class="field_overlay table-cell-actions flex items-center"
    :title="cellValue"
    :data-test="`log-add-data-from-column-${cellValue}`"
  >
    <span class="mx-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="copyLogToClipboard(cellValue)"
        :title="t('logs.cellActions.copy')"
      >
        <OIcon name="content-copy" size="xs" />
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="me-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="addSearchTerm(column.id, cellValue, 'include')"
        :data-test="`log-details-include-field-${cellValue}`"
        :title="t('logs.cellActions.includeTerm')"
      >
        <OIcon name="" style="height: 0.5rem; width: 0.5rem">
          <EqualIcon class="size-full" />
        </OIcon>
      </OButton>
    </span>
    <span v-if="isStreamField && !hideSearchTermActions" class="me-1">
      <OButton
        variant="ghost"
        size="icon-xs-circle"
        @click.prevent.stop="addSearchTerm(column.id, cellValue, 'exclude')"
        :title="t('logs.cellActions.excludeTerm')"
        :data-test="`log-details-exclude-field-${cellValue}`"
      >
        <OIcon name="" style="height: 0.5rem; width: 0.5rem">
          <NotEqualIcon class="size-full" />
        </OIcon>
      </OButton>
    </span>
    <!-- o2 ai context add button in the cell actions when user adds a interesting field to the table 
     then we show some options there we need this  -->
    <O2AIContextAddBtn
      v-if="!hideAi"
      @send-to-ai-chat="sendToAiChat(JSON.stringify(cellValue))"
      class="size-6! border border-solid border-white"
      :imageHeight="'14'"
      :imageWidth="'14'"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { isFilterableLogField } from "@/utils/logs/streamNameColumn";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useLoadedOrg } from "@/utils/assistant/doorBinding";
import { searchState } from "@/composables/useLogs/searchState";
import { useStore } from "vuex";
import { logFieldBuild, logsDoorBase, rowKeyOf, type LogsDoorBase } from "@/plugins/logs/logsDoors";

const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);

const props = defineProps({
  /** The org the host loaded this row under; its doors carry it so a stale row is refused. */
  boundOrg: {
    type: String,
    default: undefined,
  },
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
  /** Rendered cell value, for columns with nothing under `row[column.id]` (logs' `source`). */
  value: {
    type: null as unknown as PropType<unknown>,
    default: undefined,
  },
  /** The page a field door describes; defaults to the Logs search (correlated logs pass their own). */
  doorContext: {
    type: Function as PropType<() => LogsDoorBase>,
    default: undefined,
  },
});

const cellValue = computed(() =>
  props.value === undefined ? props.row[props.column.id] : props.value,
);

const { t } = useI18nTyped();

const emit = defineEmits(["copy", "addSearchTerm", "addFieldToTable", "sendToAiChat"]);

const copyLogToClipboard = (value: any) => {
  emit("copy", value);
};
const addSearchTerm = (field: string, field_value: string | number | boolean, action: string) => {
  emit("addSearchTerm", field, field_value, action);
};

const sendToAiChat = (value: any) => {
  emit("sendToAiChat", value);
};

const assistantV2 = isAssistantV2();
// Only the assistant's doors read the store and the search; the legacy toolbar stays as it was.
const store = assistantV2 ? useStore() : null;
const searchObj = assistantV2 ? searchState().searchObj : null;
const loadedOrg = assistantV2
  ? useLoadedOrg(
      () => props.row,
      () => store?.state.selectedOrganization?.identifier ?? "",
    )
  : null;

// Field doors attach `{field, value}` with the field name, the stream and range as provenance.
const fieldDoor = (verb: "explain" | "add_to_chat") => ({
  verb,
  entryKind: "object_verb" as const,
  boundOrg: props.boundOrg ?? loadedOrg?.value,
  objectKind: "log_field" as const,
  label: t(verb === "explain" ? "assistant.entry.explainField" : "assistant.entry.addField"),
  tooltip: t(
    verb === "explain" ? "assistant.entry.tooltip.explainField" : "assistant.entry.tooltip.add",
  ),
  dataTest:
    verb === "explain"
      ? ("ai-entry-log-field-explain" as const)
      : ("ai-entry-log-field-add" as const),
  build: logFieldBuild(
    () => props.doorContext?.() ?? logsDoorBase(searchObj ?? {}, store?.state ?? {}, props.row),
    String(props.column.id),
    cellValue.value,
    props.row,
  ),
  objectKey: `${rowKeyOf(props.row, store?.state.zoConfig?.timestamp_column || undefined)}:${String(props.column.id)}`,
});

const isStreamField = computed(() =>
  isFilterableLogField(props.column.id, props.selectedStreamFields),
);
</script>
