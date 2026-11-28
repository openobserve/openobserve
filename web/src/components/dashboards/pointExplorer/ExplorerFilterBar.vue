<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The explorers' filter area: chips or "write your own" (WHERE for traces, full SQL otherwise).
     The host keeps the two in step; this bar only shows them and reports edits. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import SqlFilterBuilder from "@/components/filterBar/SqlFilterBuilder.vue";
import { useFilterBuilderPreference } from "@/components/filterBar/useFilterBuilderPreference";
import { AUTO_RUN_STORAGE_KEY } from "@/composables/dashboard/useAutoRunToggle";
import { isAutoRunActive } from "@/composables/useLogs/useAutoRun";
import type { FilterField } from "@/utils/query/filterBar";
import { EXPLORER_FILTER_MODE_KEY } from "@/utils/dashboard/pointExplorers";
import { queryClient } from "@/composables/query/queryClient";
import { queryFunctionsQuery } from "@/services/query_functions.queries";
import type { ServerQueryFunction } from "@/services/query_functions";
import { mergeServerFunctions } from "@/utils/query/serverFunctions";
import { SQL_FUNCTIONS } from "@/utils/query/sqlCompletion";

const props = defineProps<{
  /** The WHERE condition the chips show; a query they cannot draw shows the builder's banner. */
  chipsQuery: string;
  /** What "write your own" edits: the WHERE text, or the full SQL. */
  ownKind: "where" | "sql";
  ownValue: string;
  fields: FilterField[];
  fieldsLoading?: boolean;
  loadValues?: (field: string, search: string) => Promise<string[]>;
  dataTestPrefix: string;
}>();

const emit = defineEmits<{
  /** The chips' new WHERE condition. */
  "update:chipsQuery": [where: string];
  "update:ownValue": [value: string];
  /** Search with the current filter now. */
  run: [];
}>();

const { t } = useI18nTyped();

// Chips or "write your own", exactly as the Logs and Traces pages keep it: write-your-own unless this
// browser stored "builder", and every toggle is saved. One key for all three explorers.
const { builderOn, toggle } = useFilterBuilderPreference(EXPLORER_FILTER_MODE_KEY);

// Chip edits rerun only when the Logs/Traces pages would (server setting AND the user's Auto Run
// toggle, read but never written here), once edits settle; written queries wait for Ctrl+Enter.
const store = useStore();
const autoRunOn = (): boolean => {
  let liveMode = false;
  try {
    liveMode = localStorage.getItem(AUTO_RUN_STORAGE_KEY) === "true";
  } catch {
    liveMode = false;
  }
  return isAutoRunActive(store.state.zoConfig ?? {}, { liveMode });
};
const CHIPS_RUN_DELAY_MS = 300;
let chipsRunTimer: ReturnType<typeof setTimeout> | null = null;
const cancelPendingRun = () => {
  if (chipsRunTimer) clearTimeout(chipsRunTimer);
  chipsRunTimer = null;
};
const runNow = () => {
  cancelPendingRun();
  emit("run");
};
const onChipsChange = (where: string) => {
  emit("update:chipsQuery", where);
  cancelPendingRun();
  if (!autoRunOn()) return;
  chipsRunTimer = setTimeout(runNow, CHIPS_RUN_DELAY_MS);
};
onBeforeUnmount(cancelPendingRun);

// Functions as the other editors offer them: the local catalogue plus the server's, without which the
// editor falls back to the local list alone. A failed lookup keeps the local list.
const serverFunctions = ref<ServerQueryFunction[]>([]);
const functionSuggestions = computed(() =>
  mergeServerFunctions(SQL_FUNCTIONS, serverFunctions.value),
);
onMounted(() => {
  const org = store.state.selectedOrganization?.identifier;
  if (!org) return;
  queryClient
    .fetchQuery(queryFunctionsQuery(org))
    .then((list) => (serverFunctions.value = Array.isArray(list) ? list : []))
    .catch(() => undefined);
});

// The WHERE editor offers the stream's fields as it types, and their values through the host's loader.
const fieldKeywords = computed(() =>
  props.fields.map((field) => ({
    name: field.name,
    label: field.name,
    kind: "Field",
    insertText: field.name,
  })),
);
const resolveFieldValues = (field: string): Promise<string[]> =>
  props.loadValues ? props.loadValues(field, "") : Promise.resolve([]);
const builderRef = ref<InstanceType<typeof SqlFilterBuilder> | null>(null);

defineExpose({ cancelPendingRun });
</script>

<template>
  <!-- Mirrors the Traces page's filter row (plugins/traces/SearchBar.vue); it has no Run of its
       own, the header's refresh runs it. -->
  <div class="border-border-default flex border-t" :data-test="`${dataTestPrefix}-filter-box`">
    <div class="relative flex h-full w-full flex-col overflow-hidden">
      <OButton
        :icon-left="builderOn ? 'code' : 'filter-list'"
        :aria-pressed="builderOn"
        variant="ghost"
        size="icon-xs-sq"
        class="absolute! top-0.75 right-1 z-51"
        :data-test="`${dataTestPrefix}-filter-builder-toggle`"
        @click="toggle"
      >
        <OTooltip
          :content="builderOn ? t('filterBar.queryTooltip') : t('filterBar.builderTooltip')"
        />
      </OButton>
      <div
        v-if="builderOn"
        class="h-full overflow-y-auto py-0.75 ps-1.5 pe-10"
        @pointerdown.self.prevent="builderRef?.activate()"
      >
        <SqlFilterBuilder
          ref="builderRef"
          :query="chipsQuery"
          :fields="fields"
          :load-values="loadValues"
          :fields-loading="fieldsLoading"
          :free-text="false"
          :data-test="`${dataTestPrefix}-filter-builder`"
          @update:query="onChipsChange"
          @submit="runNow"
          @exit="toggle"
        />
      </div>
      <!-- Traces edit the bare WHERE in filter mode, as the Traces page does; logs and metrics
           edit the full SQL. -->
      <QueryEditor
        v-else
        :query="ownValue"
        :languages="['sql']"
        editor-height="4rem"
        hide-nl-toggle
        :filter-mode="ownKind === 'where'"
        :full-text-search="ownKind !== 'where'"
        :keywords="ownKind === 'where' ? fieldKeywords : []"
        :suggestions="functionSuggestions"
        :field-value-resolver="ownKind === 'where' ? resolveFieldValues : null"
        :data-test-prefix="
          ownKind === 'where' ? `${dataTestPrefix}-filter-input` : `${dataTestPrefix}-editor`
        "
        @update:query="(v: string) => emit('update:ownValue', v)"
        @run-query="runNow"
      />
    </div>
  </div>
</template>
