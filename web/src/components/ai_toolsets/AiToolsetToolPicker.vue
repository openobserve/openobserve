<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="mb-4 flex flex-col gap-3" data-test="ai-toolset-tool-picker">
    <p class="text-text-secondary text-sm" data-test="ai-toolset-tools-intro">
      {{ t("aiToolset.toolsIntro", { server }) }}
    </p>

    <div
      v-if="status === 'failed'"
      role="alert"
      class="bg-status-error-bg border-status-negative rounded-default flex flex-wrap items-start gap-3 border px-3 py-2"
      data-o2-privacy="mask"
      data-test="ai-toolset-tools-error"
    >
      <OIcon name="error-outline" size="sm" class="text-status-error-text mt-0.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="text-text-heading text-sm font-semibold">
          {{ t("aiToolset.failedTitle", { server }) }}
        </div>
        <div class="text-text-body text-sm break-words" data-test="ai-toolset-tools-error-message">
          {{ error }}
        </div>
        <div
          v-if="presetTools"
          class="text-text-secondary text-xs"
          data-test="ai-toolset-tools-error-keep"
        >
          {{ t("aiToolset.failedKeep", { count: presetTools }, presetTools) }}
        </div>
      </div>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="ai-toolset-tools-retry"
        @click="emit('refresh')"
      >
        {{ t("aiToolset.retry") }}
      </OButton>
    </div>
    <div
      v-else
      class="border-border-default rounded-default flex flex-wrap items-center gap-x-3 gap-y-2 border px-3 py-2"
      data-test="ai-toolset-tools-status"
    >
      <div
        v-if="status === 'loading'"
        role="status"
        class="flex min-w-0 flex-1 items-center gap-2 text-sm"
        data-test="ai-toolset-tools-loading"
      >
        <OSpinner size="sm" instant />
        <span class="font-semibold">{{ t("aiToolset.toolsListing", { server }) }}</span>
        <span class="text-text-secondary font-mono" data-test="ai-toolset-tools-elapsed">
          {{ t("aiToolset.elapsedSeconds", { seconds: elapsedSeconds }) }}
        </span>
      </div>
      <div
        v-else-if="status === 'ok' && tools"
        role="status"
        class="flex min-w-0 flex-1 items-center gap-2 text-sm"
        data-test="ai-toolset-tools-success"
      >
        <span class="bg-status-positive size-2 shrink-0 rounded-full" />
        <span class="font-semibold">{{ t("aiToolset.connected") }}</span>
        <span class="text-text-secondary">
          {{ t("aiToolset.connectedDetail", { count: tools.length }, tools.length) }}
        </span>
      </div>
      <div v-else class="min-w-0 flex-1" data-test="ai-toolset-tools-hint">
        <div class="flex items-center gap-2 text-sm">
          <span class="bg-text-secondary size-2 shrink-0 rounded-full" />
          <span class="font-semibold">{{ t("aiToolset.notConnected") }}</span>
        </div>
        <ol class="text-text-secondary mt-1 list-decimal ps-6 text-sm">
          <li>
            <i18n-t
              :keypath="
                presetName ? 'aiToolset.stepCredentials' : 'aiToolset.stepCredentialsGeneric'
              "
              scope="global"
              tag="span"
            >
              <template #server>{{ server }}</template>
              <template #link>
                <OButton
                  variant="link"
                  data-test="ai-toolset-tools-goto-connection"
                  @click="emit('go-connection')"
                >
                  {{ t("aiToolset.connection") }}
                </OButton>
              </template>
            </i18n-t>
          </li>
          <li>{{ canRefresh ? t("aiToolset.stepRefresh") : t("aiToolset.refreshNeedsUrl") }}</li>
        </ol>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :icon-left="tools ? 'refresh' : 'link'"
          :loading="status === 'loading'"
          :disabled="!canRefresh || status === 'loading'"
          data-test="ai-toolset-refresh-tools"
          @click="emit('refresh')"
        >
          {{ tools ? t("aiToolset.refreshTools") : t("aiToolset.connect") }}
        </OButton>
      </div>
    </div>

    <div
      class="border-border-default rounded-default overflow-hidden border"
      data-test="ai-toolset-tools-list"
    >
      <div
        class="bg-surface-subtle border-border-default flex flex-wrap items-center gap-3 border-b px-3 py-2"
      >
        <OCheckbox
          :model-value="allState"
          :label="t('aiToolset.allTools')"
          :disabled="!rows.length"
          data-test="ai-toolset-tools-all"
          @update:model-value="setAll(allState !== true)"
        />
        <OTag
          v-if="!tools && presetName"
          variant="default-soft"
          :label="t('aiToolset.fromPreset', { preset: presetName })"
          data-test="ai-toolset-tools-preset-tag"
        />
        <div class="ms-auto w-60 max-md:w-full">
          <OSearchInput
            v-model="filter"
            size="sm"
            :placeholder="t('aiToolset.filterTools')"
            data-test="ai-toolset-tools-filter"
          />
        </div>
        <span class="text-text-secondary text-xs" data-test="ai-toolset-tools-count">
          {{ t("aiToolset.enabledOf", { on: enabledCount, total: rows.length }) }}
        </span>
      </div>
      <p
        v-if="!tools && presetTools !== undefined"
        class="text-text-secondary border-border-default border-b px-3 py-2 text-xs"
        data-test="ai-toolset-tools-preset-note"
      >
        {{ t("aiToolset.presetNote") }}
      </p>
      <!-- h-7 rows: max-h-32 shows exactly four rows (4 × 1.75rem + py-2), the rest scrolls. -->
      <div class="max-h-32 overflow-auto px-3 py-2" data-test="ai-toolset-tools-grid">
        <div
          v-if="status === 'loading'"
          class="grid grid-cols-3 gap-x-4 gap-y-2 max-lg:grid-cols-2 max-md:grid-cols-1"
          data-test="ai-toolset-tools-skeleton"
        >
          <OSkeleton v-for="n in 6" :key="n" class="rounded-default h-4 w-4/5" />
        </div>
        <div
          v-else-if="shownRows.length"
          class="grid grid-cols-3 gap-x-4 max-lg:grid-cols-2 max-md:grid-cols-1"
        >
          <div
            v-for="row in shownRows"
            :key="row.dataTest"
            class="flex h-7 min-w-0 items-center"
            :data-test="row.dataTest"
          >
            <OCheckbox
              :model-value="row.on"
              :aria-label="row.name"
              :disabled="row.locked"
              class="max-w-full"
              data-test="ai-toolset-tool-checkbox"
              @update:model-value="(on) => toggle(row, on === true)"
            >
              <template #label>
                <OTruncatedText
                  :tooltip="row.tip ? false : undefined"
                  class="text-compact font-mono"
                  :class="row.on ? '' : 'text-text-secondary'"
                >
                  {{ row.name }}
                </OTruncatedText>
              </template>
            </OCheckbox>
            <OTooltip v-if="row.tip" :content="row.tip" />
          </div>
        </div>
        <div v-else class="text-text-secondary text-xs" data-test="ai-toolset-tools-empty">
          {{ filter || tools ? t("aiToolset.noToolsMatch") : t("aiToolset.toolsAllOn") }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  blockedByGlob,
  globMatches,
  globPrefix,
  otherEntries,
  removeEntry,
  setToolOn,
  toolState,
  type DiscoveredTool,
  type OtherEntry,
  type ToolLists,
} from "./toolPicker";

interface Row {
  name: string;
  dataTest: string;
  /** Hover text: the tool's description, a glob's meaning, or why it is unlisted or blocked. */
  tip?: I18nText;
  on: boolean;
  /** A blocked glob keeps this tool off. */
  locked?: boolean;
  /** A listed tool, or else the stored entry the row stands for. */
  tool?: DiscoveredTool;
  other?: OtherEntry;
}

const props = withDefaults(
  defineProps<{
    lists: ToolLists;
    tools: DiscoveredTool[] | null;
    status?: "idle" | "loading" | "ok" | "failed";
    error?: string;
    /** False while the URL is empty. */
    canRefresh?: boolean;
    /** Set when a preset chose the tools; names the count line before a refresh. */
    presetTools?: number;
    presetName?: string;
  }>(),
  { status: "idle", canRefresh: true },
);

const emit = defineEmits<{
  (_e: "update:lists", _lists: ToolLists): void;
  (_e: "remove", _entry: OtherEntry): void;
  (_e: "refresh"): void;
  (_e: "go-connection"): void;
}>();

const { t } = useI18nTyped();

const filter = ref("");
const server = computed(() => props.presetName || t("aiToolset.thisServer"));

const startedAt = ref(0);
const now = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
const elapsedSeconds = computed(() =>
  Math.max(0, Math.floor((now.value - startedAt.value) / 1000)),
);
const stopTimer = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
};
watch(
  () => props.status,
  (status) => {
    stopTimer();
    if (status !== "loading") return;
    startedAt.value = now.value = Date.now();
    timer = setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true },
);
onBeforeUnmount(stopTimer);

const patternText = (entry: string) => {
  const prefix = globPrefix(entry);
  if (!prefix) return entry.includes("*") ? t("aiToolset.patternMatchesPart") : undefined;
  return t("aiToolset.patternMatches", { prefix });
};

const others = computed(() => otherEntries(props.lists, props.tools));

const rows = computed<Row[]>(() => {
  const found = props.tools;
  const listed: Row[] = (found ?? []).map((tool) => {
    const locked = blockedByGlob(props.lists, tool.name);
    const description = tool.description ? raw(tool.description) : undefined;
    return {
      name: tool.name,
      dataTest: `ai-toolset-tool-${tool.name}`,
      tip: locked ? t("aiToolset.blockedByEntry") : description,
      on: toolState(props.lists, tool) !== "off",
      locked,
      tool,
    };
  });
  // After a refresh a glob is shown through the tools it matches, unless it matches none.
  const allowed = others.value
    .filter(({ list }) => list === "allowed")
    .filter(({ entry }) => !found?.some((tool) => globMatches(entry, tool.name)))
    .map((other) => ({
      name: other.entry,
      dataTest: `ai-toolset-tool-${other.entry}`,
      tip:
        found && !other.entry.includes("*") ? t("aiToolset.notOnServer") : patternText(other.entry),
      on: true,
      other,
    }));
  return [...listed, ...allowed];
});

// Blocked entries no listed tool owns; ticking one lifts the block.
const blockedRows = computed<Row[]>(() =>
  others.value
    .filter(({ list }) => list === "blocked")
    .map((other) => ({
      name: other.entry,
      dataTest: `ai-toolset-blocked-${other.entry}`,
      tip: t("aiToolset.blockedEntry"),
      on: false,
      other,
    })),
);

const shownRows = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return [...rows.value, ...blockedRows.value].filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || (row.tip ?? "").toLowerCase().includes(needle),
  );
});

const enabledCount = computed(() => rows.value.filter((row) => row.on).length);
const allState = computed<boolean | "indeterminate">(() => {
  if (!enabledCount.value) return false;
  // A locked tool can't go on, so it doesn't keep All tools from being checked.
  return rows.value.every((row) => row.on || row.locked) ? true : "indeterminate";
});

const withRow = (lists: ToolLists, row: Row, on: boolean) => {
  if (row.tool) return setToolOn(lists, row.tool, on, props.tools ?? []);
  return row.other && !on ? removeEntry(lists, row.other) : lists;
};

const toggle = (row: Row, on: boolean) => {
  // A lone entry is removed as stored, so the lists a discovery only spelled out stay unsaved.
  if (row.other) emit("remove", row.other);
  else emit("update:lists", withRow(props.lists, row, on));
};

const setAll = (on: boolean) => {
  emit(
    "update:lists",
    rows.value.reduce((acc, row) => withRow(acc, row, on), props.lists),
  );
};
</script>
