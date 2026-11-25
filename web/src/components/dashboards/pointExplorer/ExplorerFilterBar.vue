<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The explorers' filter area: one field box holding the <> toggle and either the chip builder or
     "write your own" (the WHERE text for traces, the full SQL for logs and metrics), then Run.
     The host keeps the two in step; this bar only shows them and reports edits. -->
<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import SqlFilterBuilder from "@/components/filterBar/SqlFilterBuilder.vue";
import { useFilterBuilderPreference } from "@/components/filterBar/useFilterBuilderPreference";
import { AUTO_RUN_STORAGE_KEY } from "@/composables/dashboard/useAutoRunToggle";
import { isAutoRunActive } from "@/composables/useLogs/useAutoRun";
import type { FilterField } from "@/utils/query/filterBar";
import { EXPLORER_FILTER_MODE_KEY } from "@/utils/dashboard/pointExplorers";

defineProps<{
  /** The WHERE condition the chips show; a query they cannot draw shows the builder's banner. */
  chipsQuery: string;
  /** What "write your own" edits: the WHERE text, or the full SQL. */
  ownKind: "where" | "sql";
  ownValue: string;
  fields: FilterField[];
  fieldsLoading?: boolean;
  loadValues?: (field: string, search: string) => Promise<string[]>;
  placeholder?: I18nText;
  ariaLabel?: I18nText;
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

// Auto run as on the Logs and Traces pages (isAutoRunActive): the server allows it
// (zoConfig.auto_query_enabled) AND the user's Auto Run toggle from those pages' "Run query" menu is
// on (stored as "true" under AUTO_RUN_STORAGE_KEY; missing or anything else is off, as they read it).
// Then a chip edit reruns the search once edits settle, so rapid edits make one search. Otherwise it
// only writes the filter, and the header's Run query or Enter on an empty bar runs it. The drawers
// never write the key. "Write your own" always waits for Enter (Ctrl+Enter in SQL) or Run query.
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
const builderRef = ref<InstanceType<typeof SqlFilterBuilder> | null>(null);

defineExpose({ cancelPendingRun });
</script>

<template>
  <!-- The Traces page's filter row (plugins/traces/SearchBar.vue, the query row around its
       SqlFilterBuilder): a plain full-width row under the header (the header block draws the rule
       below it), chips from the left edge, the
       builder's own clear-all at its right end, then the <> toggle pinned top-right. The header's
       refresh button runs it. -->
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
      <QueryEditor
        v-else-if="ownKind === 'sql'"
        :query="ownValue"
        :languages="['sql']"
        editor-height="4rem"
        hide-nl-toggle
        :data-test-prefix="`${dataTestPrefix}-editor`"
        @update:query="(v: string) => emit('update:ownValue', v)"
        @run-query="runNow"
      />
      <div v-else class="py-0.75 ps-1.5 pe-10">
        <OInput
          :model-value="ownValue"
          class="font-mono"
          prefix="WHERE"
          size="xs"
          :placeholder="placeholder"
          :aria-label="ariaLabel"
          :data-test="`${dataTestPrefix}-filter-input`"
          @update:model-value="
            (v: string | number | null) => emit('update:ownValue', String(v ?? ''))
          "
          @keydown.enter.prevent="runNow"
        />
      </div>
    </div>
  </div>
</template>
