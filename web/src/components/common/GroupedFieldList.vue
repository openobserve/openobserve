<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OFieldList
    ref="ofieldListRef"
    :fields="visibleFields"
    :search="search"
    :search-class="searchClass"
    :search-placeholder="searchPlaceholder ?? t('search.searchField')"
    :current-page="currentPage"
    :page-size="pageSize"
    :row-key="rowKey"
    :loading="loading"
    :show-pagination="showPagination"
    :keyboard="keyboard"
    :expanded-ids="expandedIds"
    :expandable-fn="expandableFn"
    :draggable="draggable"
    :drag-enabled-fn="dragEnabledFn"
    @update:search="$emit('update:search', $event)"
    @update:current-page="$emit('update:current-page', $event)"
    @update:expanded-ids="$emit('update:expanded-ids', $event)"
    @drag-start="(row: FieldItem, event: DragEvent) => $emit('drag-start', row, event)"
    @drag-end="(row: FieldItem, event: DragEvent) => $emit('drag-end', row, event)"
  >
    <!-- Group header -->
    <template #group-header="{ row, groupName }">
      <slot name="group-header" :row="row" :group-name="groupName">
        <div
          class="-ms-page-edge px-page-edge bg-surface-subtle text-field-list-group-text flex h-full w-[calc(100%+2*var(--spacing-page-edge))] shrink-0 cursor-pointer items-center justify-between text-xs font-semibold"
          @click="toggleGroup(row.group)"
        >
          <div class="min-w-0 flex-1">
            <slot
              name="group-label"
              :row="row"
              :group-name="groupName"
              :count="groupFieldCount[row.group] ?? 0"
              ><template v-if="searchMatchCount">{{
                t("search.groupFieldMatches", {
                  name: groupName,
                  matched: searchMatchCount[row.group] ?? 0,
                  total: groupFieldCount[row.group] ?? 0,
                })
              }}</template
              ><template v-else
                >{{ groupName }} ({{ groupFieldCount[row.group] ?? 0 }})</template
              ></slot
            >
          </div>
          <OButton
            :aria-label="groupName"
            :aria-expanded="!isCollapsed(row.group)"
            v-if="(groupFieldCount[row.group] ?? 0) > 0"
            variant="ghost"
            size="icon"
            class="size-5! flex-shrink-0"
          >
            <OIcon :name="isCollapsed(row.group) ? 'chevron-right' : 'expand-more'" size="sm" />
          </OButton>
        </div>
      </slot>
    </template>

    <!-- Field row -->
    <template #field-row="rowProps">
      <slot name="field-row" v-bind="rowProps" />
    </template>

    <template v-if="$slots['field-actions']" #field-actions="actionProps">
      <slot name="field-actions" v-bind="actionProps" />
    </template>

    <template v-if="$slots.expansion" #expansion="{ row }">
      <slot name="expansion" :row="row" />
    </template>

    <!-- Empty state -->
    <template #empty>
      <slot name="empty">
        <div class="flex items-center justify-center py-[0.725rem] text-center">
          <OIcon name="info" size="xs" />
          <span class="ps-1.5">{{ t("search.noFieldFound") }}</span>
        </div>
      </slot>
    </template>

    <!-- Loading state -->
    <template #loading>
      <slot name="loading" />
    </template>

    <!-- Before list -->
    <template v-if="$slots['before-list']" #before-list>
      <slot name="before-list" />
    </template>

    <template v-if="$slots['after-search']" #after-search>
      <slot name="after-search" />
    </template>

    <!-- After list -->
    <template v-if="$slots['after-list']" #after-list="bottomProps">
      <slot name="after-list" v-bind="{ ...bottomProps, allRows: allFieldCount }" />
    </template>
  </OFieldList>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";

const { t } = useI18nTyped();

interface Props {
  fields: any[];
  search?: string;
  /** Passed to OFieldList so the owning panel can inset the search control. */
  searchClass?: string;
  loading?: boolean;
  currentPage?: number;
  pageSize?: number;
  showPagination?: boolean;
  searchPlaceholder?: I18nText;
  /** Field that keys each row; set it when two rows can share a `name`. */
  rowKey?: string;
  keyboard?: boolean;
  expandedIds?: string[];
  expandableFn?: (row: FieldItem) => boolean;
  /** Group keys folded shut; when omitted the list keeps the state itself. */
  collapsedGroups?: Set<string>;
  draggable?: boolean;
  dragEnabledFn?: (row: FieldItem, index: number) => boolean;
}

const props = withDefaults(defineProps<Props>(), {
  search: "",
  searchClass: "",
  loading: false,
  currentPage: 1,
  pageSize: 50,
  showPagination: false,
  rowKey: "name",
  keyboard: false,
  expandedIds: () => [],
  expandableFn: undefined,
  collapsedGroups: undefined,
  draggable: false,
  dragEnabledFn: undefined,
});

const emit = defineEmits<{
  "update:search": [value: string];
  "update:current-page": [page: number];
  "update:expanded-ids": [ids: string[]];
  "update:collapsedGroups": [groups: Set<string>];
  "drag-start": [row: FieldItem, event: DragEvent];
  "drag-end": [row: FieldItem, event: DragEvent];
}>();

const ofieldListRef = ref<InstanceType<typeof OFieldList> | null>(null);

// applyFieldGrouping() marks headers with `label`/`name`; OFieldList expects `isGroup`/`groupName`.
const annotatedFields = computed(() =>
  (props.fields as any[]).map((row) => ({
    ...row,
    isGroup: row.isGroup ?? !!row.label,
    groupName: row.groupName ?? (row.label ? row.name : undefined),
  })),
);

const localCollapsed = ref<Set<string>>(new Set());

const collapsed = computed(() => props.collapsedGroups ?? localCollapsed.value);

function isCollapsed(group: string | undefined): boolean {
  return group !== undefined && collapsed.value.has(group);
}

function toggleGroup(group: string | undefined) {
  if (group === undefined) return;
  const next = new Set(collapsed.value);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  if (props.collapsedGroups === undefined) localCollapsed.value = next;
  emit("update:collapsedGroups", next);
}

const groupFieldCount = computed(() => {
  const counts: Record<string, number> = {};
  for (const row of annotatedFields.value) {
    if (!row.isGroup && row.group) {
      counts[row.group] = (counts[row.group] ?? 0) + 1;
    }
  }
  return counts;
});

// Matching fields per group, counted before the collapse filter so a collapsed group still counts its matches; null = no search.
const searchMatchCount = computed<Record<string, number> | null>(() => {
  const term = props.search?.trim().toLowerCase();
  if (!term) return null;
  const counts: Record<string, number> = {};
  for (const row of annotatedFields.value) {
    if (
      !row.isGroup &&
      row.group &&
      String(row.name ?? "")
        .toLowerCase()
        .includes(term)
    ) {
      counts[row.group] = (counts[row.group] ?? 0) + 1;
    }
  }
  return counts;
});

// Collapsing hides rows from the page, not from the stream, so the field total counts them anyway.
const allFieldCount = computed(() => {
  const term = props.search?.trim().toLowerCase();
  return annotatedFields.value.filter(
    (row) =>
      !row.isGroup &&
      (!term ||
        String(row.name ?? "")
          .toLowerCase()
          .includes(term)),
  ).length;
});

// A collapsed group keeps its header; `matchesSearch` keeps it through a search once its rows are hidden.
const visibleFields = computed(() =>
  annotatedFields.value
    .filter((row: any) => {
      if (row.isGroup) return true;
      return !isCollapsed(row.group);
    })
    .map((row: any) => {
      if (!row.isGroup) return row;
      const matched = searchMatchCount.value;
      return {
        ...row,
        matchesSearch: matched ? (matched[row.group] ?? 0) > 0 : true,
      };
    }),
);

function scrollToTop() {
  ofieldListRef.value?.scrollToTop?.();
}

defineExpose({ scrollToTop });
</script>
