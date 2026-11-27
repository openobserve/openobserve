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
        <OToggleGroup v-model="view" mobile-dropdown data-test="ai-toolset-tools-view">
          <OToggleGroupItem
            v-for="item in views"
            :key="item.id"
            :value="item.id"
            size="sm"
            :data-test="`ai-toolset-tools-view-${item.id}`"
          >
            {{ item.label }}
            <span class="text-text-secondary ms-1">{{ item.count }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
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
      </div>
      <p
        v-if="!tools && presetTools !== undefined"
        class="text-text-secondary border-border-default border-b px-3 py-2 text-xs"
        data-test="ai-toolset-tools-preset-note"
      >
        {{ t("aiToolset.presetNote") }}
      </p>
      <!-- ponytail: max-h-130 fits the column and group headers plus eight min-h-13 rows; a row with a note line is taller. -->
      <div class="max-h-130 overflow-x-hidden overflow-y-auto" data-test="ai-toolset-tools-grid">
        <div
          class="bg-surface-subtle border-border-default text-text-secondary sticky top-0 z-10 flex items-end gap-3 border-b px-3 py-2 text-xs"
          data-test="ai-toolset-tools-columns"
        >
          <div class="text-text-heading min-w-0 flex-1 font-semibold">
            {{ t("aiToolset.colTool") }}
          </div>
          <div class="flex shrink-0 gap-2">
            <div v-for="col in columns" :key="col.level" :class="CELL" class="text-center">
              <div class="text-text-heading font-semibold">{{ col.label }}</div>
              <div class="max-md:hidden">{{ col.hint }}</div>
            </div>
          </div>
        </div>
        <div v-if="status === 'loading'" data-test="ai-toolset-tools-skeleton">
          <div
            v-for="n in 6"
            :key="n"
            class="border-border-default flex min-h-13 items-center gap-3 border-b px-3 py-2"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <OSkeleton class="rounded-default h-3.5 w-40 max-w-full" />
              <OSkeleton class="rounded-default h-3 w-4/5" />
            </div>
            <div class="flex shrink-0 gap-2">
              <div v-for="c in 3" :key="c" :class="CELL" class="flex justify-center">
                <OSkeleton
                  type="circle"
                  class="size-3.5"
                  data-test="ai-toolset-tools-skeleton-radio"
                />
              </div>
            </div>
          </div>
        </div>
        <template v-else>
          <section
            v-for="group in shownGroups"
            :key="group.id"
            :data-test="`ai-toolset-tools-group-${group.id}`"
          >
            <div class="border-border-default flex min-w-0 items-center gap-3 border-b px-3 py-2">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span class="text-text-heading font-semibold">{{ group.title }}</span>
                  <span
                    class="text-text-secondary text-xs"
                    data-test="ai-toolset-tools-group-count"
                  >
                    {{ t("aiToolset.groupOnOf", { on: group.on, total: group.rows.length }) }}
                  </span>
                </div>
                <div class="text-text-secondary text-xs">{{ group.help }}</div>
              </div>
              <ORadioGroup
                :model-value="group.level"
                orientation="horizontal"
                :label="t('aiToolset.setAll', { group: group.title })"
                class="shrink-0"
                data-test="ai-toolset-group-levels"
                @update:model-value="(v) => setGroup(group, v as Choice)"
              >
                <!-- The caption sits under the radio so it stays in line with the row radios. -->
                <div
                  v-for="c in group.cells"
                  :key="c.key"
                  :class="c.wide ? WIDE : CELL"
                  class="flex flex-col items-center gap-0.5"
                >
                  <template v-if="c.level">
                    <ORadio
                      :value="c.level"
                      size="sm"
                      data-test="ai-toolset-group-level"
                      :data-test-value="c.level"
                    >
                      <template #label>
                        <span class="sr-only">{{ c.label }}</span>
                      </template>
                    </ORadio>
                    <span
                      class="text-text-secondary text-2xs"
                      aria-hidden="true"
                      data-test="ai-toolset-group-level-caption"
                    >
                      {{ t("aiToolset.setAllShort") }}
                    </span>
                  </template>
                </div>
              </ORadioGroup>
            </div>
            <div
              v-for="row in group.shown"
              :key="row.dataTest"
              class="border-border-default flex min-h-13 min-w-0 items-center gap-3 border-b px-3 py-2"
              :class="row.changed ? 'bg-accent/5' : ''"
              :data-test="row.dataTest"
              :data-changed="row.changed ? 'true' : undefined"
            >
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <OTruncatedText
                    class="text-compact font-mono"
                    :class="row.level === 'off' ? 'text-text-secondary' : 'text-text-heading'"
                  >
                    {{ row.name }}
                  </OTruncatedText>
                  <OTag
                    v-if="row.destructive"
                    variant="error-soft"
                    size="xs"
                    :label="t('aiToolset.cannotUndo')"
                    data-test="ai-toolset-tool-destructive"
                  />
                </div>
                <OTruncatedText
                  v-if="row.description"
                  as="div"
                  tooltip-class="whitespace-pre-wrap"
                  class="text-text-secondary text-xs"
                >
                  {{ row.description }}
                </OTruncatedText>
                <div
                  v-if="row.note"
                  class="text-text-secondary text-xs"
                  data-test="ai-toolset-tool-note"
                >
                  {{ row.note }}
                </div>
              </div>
              <ORadioGroup
                :model-value="row.level"
                orientation="horizontal"
                :label="raw(row.name)"
                :disabled="row.locked"
                class="shrink-0"
                @update:model-value="(v) => pick(row, v as Choice)"
              >
                <div
                  v-for="c in row.cells"
                  :key="c.key"
                  :class="c.wide ? WIDE : CELL"
                  class="flex justify-center"
                >
                  <ORadio
                    v-if="c.level"
                    :value="c.level"
                    size="sm"
                    data-test="ai-toolset-tool-level"
                    :data-test-value="c.level"
                  >
                    <template #label>
                      <span class="sr-only">{{ c.label }}</span>
                    </template>
                  </ORadio>
                </div>
              </ORadioGroup>
            </div>
          </section>
          <div
            v-if="!shownGroups.length"
            class="text-text-secondary px-3 py-3 text-xs"
            data-test="ai-toolset-tools-empty"
          >
            {{
              filter || tools || view !== "all"
                ? t("aiToolset.noToolsMatch")
                : t("aiToolset.toolsAllOn")
            }}
          </div>
        </template>
      </div>
    </div>

    <ODialog
      :open="!!pending"
      size="sm"
      :title="t('aiToolset.destructiveTitle', { tool: raw(pending?.name) })"
      :primary-button-label="t('aiToolset.allowInChat')"
      primary-button-variant="destructive"
      :secondary-button-label="t('aiToolset.keepOff')"
      secondary-button-variant="outline"
      data-test="ai-toolset-destructive-confirm"
      @update:open="pending = null"
      @click:primary="confirmPending"
      @click:secondary="pending = null"
    >
      <div class="flex flex-col gap-2 text-sm">
        <p v-if="pending?.description" class="text-text-secondary whitespace-pre-wrap">
          {{ pending.description }}
        </p>
        <p>{{ t("aiToolset.destructiveBody") }}</p>
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  blockedByGlob,
  globMatches,
  globPrefix,
  mayWrite,
  otherEntries,
  removeEntry,
  setGroupLevel,
  setToolLevel,
  toolLevel,
  type DiscoveredTool,
  type OtherEntry,
  type ToolLevel,
  type ToolLists,
} from "./toolPicker";

/** A row's radio value; a saved entry the server didn't list is only on or off. */
type Choice = ToolLevel | "on";
type View = "all" | "on" | "off" | "changes";

interface Cell {
  key: string;
  level?: Choice;
  label?: I18nText;
  /** Spans the Chat and Everywhere columns. */
  wide?: boolean;
}

interface Row {
  name: string;
  dataTest: string;
  description?: string;
  /** Why the row is unlisted or blocked, or what a glob matches. */
  note?: I18nText;
  level: Choice;
  /** A blocked glob keeps this tool off. */
  locked?: boolean;
  destructive?: boolean;
  /** Not known to be read-only, so it runs only in chat. */
  writes?: boolean;
  changed?: boolean;
  cells: Cell[];
  /** A listed tool, or else the stored entry the row stands for. */
  tool?: DiscoveredTool;
  other?: OtherEntry;
}

interface Group {
  id: "reads" | "changes" | "saved";
  title: I18nText;
  help: I18nText;
  rows: Row[];
  shown: Row[];
  on: number;
  /** The level every row shares, or "mixed", which no radio carries. */
  level: Choice | "mixed";
  cells: Cell[];
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
const view = ref<View>("all");
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

const CELL = "w-26 max-md:w-14";
const WIDE = "w-54 max-md:w-30";

const columns = computed(() => [
  { level: "off", label: t("aiToolset.levelOff"), hint: t("aiToolset.levelOffHint") },
  { level: "chat", label: t("aiToolset.levelChat"), hint: t("aiToolset.levelChatHint") },
  {
    level: "everywhere",
    label: t("aiToolset.levelEverywhere"),
    hint: t("aiToolset.levelEverywhereHint"),
  },
]);

const cell = (level: Choice): Cell => ({
  key: level,
  level,
  label:
    level === "on" ? t("aiToolset.levelOn") : columns.value.find((c) => c.level === level)?.label,
  wide: level === "on",
});
const EMPTY: Cell = { key: "none" };
const EMPTY_WIDE: Cell = { key: "none", wide: true };

// The level each tool had when it was listed, so a changed row stands out until the tools reload.
const baseline = new Map<string, ToolLevel>();
watch(
  () => props.tools,
  (tools) => {
    if (!tools) baseline.clear();
    for (const tool of tools ?? []) {
      if (!baseline.has(tool.name)) baseline.set(tool.name, toolLevel(props.lists, tool));
    }
  },
  { immediate: true },
);

const patternText = (entry: string) => {
  const prefix = globPrefix(entry);
  if (!prefix) return entry.includes("*") ? t("aiToolset.patternMatchesPart") : undefined;
  return t("aiToolset.patternMatches", { prefix });
};

const others = computed(() => otherEntries(props.lists, props.tools));

const toolRows = computed<Row[]>(() =>
  (props.tools ?? []).map((tool) => {
    const level = toolLevel(props.lists, tool);
    const locked = blockedByGlob(props.lists, tool.name);
    const writes = mayWrite(tool);
    const before = baseline.get(tool.name);
    return {
      name: tool.name,
      dataTest: `ai-toolset-tool-${tool.name}`,
      description: tool.description,
      note: locked ? t("aiToolset.blockedByEntry") : undefined,
      level,
      locked,
      destructive: tool.destructive_hint === true,
      writes,
      changed: before !== undefined && before !== level,
      // A write tool is never offered Everywhere, unless its saved lists already put it there.
      cells: [
        cell("off"),
        cell("chat"),
        writes && level !== "everywhere" ? EMPTY : cell("everywhere"),
      ],
      tool,
    };
  }),
);

// Saved entries no listed tool owns. After a refresh a glob shows through the tools it matches, unless it matches none.
const savedRows = computed<Row[]>(() => {
  const found = props.tools;
  const savedCells = [cell("off"), cell("on")];
  const allowed = others.value
    .filter(({ list }) => list === "allowed")
    .filter(({ entry }) => !found?.some((tool) => globMatches(entry, tool.name)))
    .map((other) => ({
      name: other.entry,
      dataTest: `ai-toolset-tool-${other.entry}`,
      note:
        found && !other.entry.includes("*") ? t("aiToolset.notOnServer") : patternText(other.entry),
      level: "on" as const,
      cells: savedCells,
      other,
    }));
  // Turning one of these on lifts the block.
  const blocked = others.value
    .filter(({ list }) => list === "blocked")
    .map((other) => ({
      name: other.entry,
      dataTest: `ai-toolset-blocked-${other.entry}`,
      note: t("aiToolset.blockedEntry"),
      level: "off" as const,
      cells: savedCells,
      other,
    }));
  return [...allowed, ...blocked];
});

const allRows = computed(() => [...toolRows.value, ...savedRows.value]);

const matches = (row: Row) => {
  const needle = filter.value.trim().toLowerCase();
  const text = `${row.name}\n${row.description ?? ""}\n${row.note ?? ""}`.toLowerCase();
  if (needle && !text.includes(needle)) return false;
  if (view.value === "on") return row.level !== "off";
  if (view.value === "off") return row.level === "off";
  if (view.value === "changes") return !!row.writes;
  return true;
};

const groups = computed<Group[]>(() => {
  const make = (
    id: Group["id"],
    title: I18nText,
    help: I18nText,
    rows: Row[],
    cells: Cell[],
  ): Group => {
    const levels = new Set(rows.map((row) => row.level));
    return {
      id,
      title,
      help,
      rows,
      shown: rows.filter(matches),
      on: rows.filter((row) => row.level !== "off").length,
      level: levels.size === 1 ? rows[0].level : "mixed",
      cells,
    };
  };
  return [
    make(
      "reads",
      t("aiToolset.groupReads"),
      t("aiToolset.groupReadsHelp"),
      toolRows.value.filter((row) => !row.writes),
      [cell("off"), cell("chat"), cell("everywhere")],
    ),
    make(
      "changes",
      t("aiToolset.groupChanges"),
      t("aiToolset.groupChangesHelp"),
      toolRows.value.filter((row) => row.writes),
      [cell("off"), cell("chat"), EMPTY],
    ),
    make("saved", t("aiToolset.groupSaved"), t("aiToolset.groupSavedHelp"), savedRows.value, [
      cell("off"),
      EMPTY_WIDE,
    ]),
  ].filter((group) => group.rows.length);
});

const shownGroups = computed(() => groups.value.filter((group) => group.shown.length));

const views = computed(() => {
  const rows = allRows.value;
  const on = rows.filter((row) => row.level !== "off").length;
  return [
    { id: "all", label: t("aiToolset.viewAll"), count: rows.length },
    { id: "on", label: t("aiToolset.viewOn"), count: on },
    { id: "off", label: t("aiToolset.viewOff"), count: rows.length - on },
    {
      id: "changes",
      label: t("aiToolset.viewChanges"),
      count: rows.filter((row) => row.writes).length,
    },
  ];
});

// A destructive tool going on from Off waits here for the confirm.
const pending = ref<Row | null>(null);

const pick = (row: Row, choice: Choice) => {
  if (choice === row.level) return;
  // A lone entry is removed as stored, so the lists a discovery only spelled out stay unsaved.
  if (row.other) return emit("remove", row.other);
  if (!row.tool) return;
  if (row.destructive && row.level === "off") {
    pending.value = row;
    return;
  }
  emit("update:lists", setToolLevel(props.lists, row.tool, choice as ToolLevel, props.tools ?? []));
};

const confirmPending = () => {
  const tool = pending.value?.tool;
  pending.value = null;
  if (tool) emit("update:lists", setToolLevel(props.lists, tool, "chat", props.tools ?? []));
};

const setGroup = (group: Group, choice: Choice) => {
  if (group.id === "saved") {
    // Only Off is offered: it removes every saved entry that is on.
    const on = group.rows.filter((row) => row.level === "on" && row.other);
    emit(
      "update:lists",
      on.reduce((acc, row) => removeEntry(acc, row.other!), props.lists),
    );
    return;
  }
  const tools = group.rows.flatMap((row) => (row.tool ? [row.tool] : []));
  emit("update:lists", setGroupLevel(props.lists, tools, choice as ToolLevel, props.tools ?? []));
};
</script>
