<template>
  <div
    class="field_overlay table-cell-actions flex items-center gap-1"
    :title="cellValue"
    :data-test="`log-add-data-from-column-${cellValue}`"
  >
    <OButton
      variant="ghost"
      size="icon-xs-circle"
      :aria-label="t('logs.cellActions.copy')"
      class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      data-test="logs-cell-actions-copy-btn"
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
    <O2AIContextAddBtn
      v-if="!hideAi && doorShown"
      @send-to-ai-chat="addDoorToChat(fieldDoor(), userOrgKey)"
      class="size-6! border border-solid border-white"
      :imageHeight="'14'"
      :imageWidth="'14'"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { isFilterableLogField } from "@/utils/logs/streamNameColumn";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { copyToClipboard } from "@/utils/clipboard";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useLoadedOrg } from "@/utils/assistant/doorBinding";
import { searchState } from "@/composables/useLogs/searchState";
import { useStore } from "vuex";
import {
  addDoorToChat,
  currentUserOrgKey,
  logFieldBuild,
  logsDoorBase,
  useAssistantDoorShown,
  type LogsDoorBase,
} from "@/plugins/logs/logsDoors";

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
  /** Copy here and confirm on the button instead of emitting `copy` to the parent. */
  copyInPlace: {
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

const emit = defineEmits(["copy", "addSearchTerm", "addFieldToTable"]);

const copyLogToClipboard = (value: any) => {
  if (props.copyInPlace) {
    copyToClipboard(JSON.stringify(value), t);
    return;
  }
  emit("copy", value);
};
const addSearchTerm = (field: string, field_value: string | number | boolean, action: string) => {
  emit("addSearchTerm", field, field_value, action);
};

const store = useStore();
const searchObj = searchState().searchObj;
const loadedOrg = useLoadedOrg(
  () => props.row,
  () => store.state.selectedOrganization?.identifier ?? "",
);

const doorShown = useAssistantDoorShown();
const userOrgKey = currentUserOrgKey();

// Field doors attach `{field, value}` with the field name, the stream and range as provenance.
const fieldDoor = () => ({
  entryKind: "object_verb" as const,
  boundOrg: props.boundOrg ?? loadedOrg.value,
  objectKind: "log_field" as const,
  build: logFieldBuild(
    () => props.doorContext?.() ?? logsDoorBase(searchObj, store.state, props.row),
    String(props.column.id),
    cellValue.value,
    props.row,
  ),
});

const isStreamField = computed(() =>
  isFilterableLogField(props.column.id, props.selectedStreamFields),
);
</script>
