<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OFieldList
    ref="ofieldListRef"
    :fields="visibleFields"
    :search="search"
    :search-placeholder="t('search.searchField')"
    :current-page="currentPage"
    :page-size="pageSize"
    :page-size-options="[pageSize]"
    row-key="name"
    :loading="loading"
    :show-pagination="showPagination"
    @update:search="$emit('update:search', $event)"
    @update:current-page="$emit('update:current-page', $event)"
  >
    <!-- Group header -->
    <template #group-header="{ row, groupName }">
      <slot name="group-header" :row="row" :group-name="groupName">
        <div
          class="h-full w-full flex justify-between items-center rounded-[0.25rem] font-semibold text-xs px-[0.325rem] cursor-pointer bg-surface-subtle text-field-list-group-text"
          @click="toggleGroup(row.group)"
        >
          <div class="flex-1 min-w-0">
            {{ groupName }} ({{ groupFieldCount[row.group] ?? 0 }})
          </div>
          <OButton
            v-if="(groupFieldCount[row.group] ?? 0) > 0"
            variant="ghost"
            size="icon"
            class="flex-shrink-0"
          >
            <OIcon
              :name="expandGroupRows[row.group] !== false ? 'expand-more' : 'chevron-right'"
              size="sm"
            />
          </OButton>
        </div>
      </slot>
    </template>

    <!-- Field row -->
    <template #field-row="{ row }">
      <slot name="field-row" :row="row" />
    </template>

    <!-- Empty state -->
    <template #empty>
      <slot name="empty">
        <div class="text-center py-[0.725rem] flex items-center justify-center">
          <OIcon name="info" size="xs" />
          <span class="pl-[0.375rem]">{{ t("search.noFieldFound") }}</span>
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

    <!-- After list -->
    <template v-if="$slots['after-list']" #after-list="bottomProps">
      <slot name="after-list" v-bind="bottomProps" />
    </template>
  </OFieldList>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";

const { t } = useI18n();

interface Props {
  fields: any[];
  search?: string;
  loading?: boolean;
  theme?: string;
  currentPage?: number;
  pageSize?: number;
  showPagination?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  search: "",
  loading: false,
  theme: "light",
  currentPage: 1,
  pageSize: 50,
  showPagination: false,
});

defineEmits<{
  "update:search": [value: string];
  "update:current-page": [page: number];
}>();

const ofieldListRef = ref<InstanceType<typeof OFieldList> | null>(null);

// ---------------------------------------------------------------------------
// Normalize field objects — applyFieldGrouping() uses `label`/`name` for
// group headers but OFieldList expects `isGroup`/`groupName`.
// ---------------------------------------------------------------------------

const annotatedFields = computed(() =>
  (props.fields as any[]).map((row) => ({
    ...row,
    isGroup: row.isGroup ?? !!row.label,
    groupName: row.groupName ?? (row.label ? row.name : undefined),
  })),
);

// ---------------------------------------------------------------------------
// Group expand/collapse state
// ---------------------------------------------------------------------------

const expandGroupRows = ref<Record<string, boolean>>({});

watch(
  annotatedFields,
  (list) => {
    for (const row of list) {
      if (row.isGroup && row.group && !(row.group in expandGroupRows.value)) {
        expandGroupRows.value[row.group] = true;
      }
    }
  },
  { immediate: true },
);

function toggleGroup(group: string) {
  expandGroupRows.value[group] = !expandGroupRows.value[group];
}

// ---------------------------------------------------------------------------
// Count of non-group fields per group
// ---------------------------------------------------------------------------

const groupFieldCount = computed(() => {
  const counts: Record<string, number> = {};
  for (const row of annotatedFields.value) {
    if (!row.isGroup && row.group) {
      counts[row.group] = (counts[row.group] ?? 0) + 1;
    }
  }
  return counts;
});

// ---------------------------------------------------------------------------
// Groups that still have at least one field matching the active search term.
// Computed from the full (pre-collapse) field set so a collapsed group whose
// matching field rows have been filtered out is still recognised as a match.
// Returns null when there is no active search (every group is a match).
// ---------------------------------------------------------------------------

const searchMatchedGroups = computed<Set<string> | null>(() => {
  const term = props.search?.trim().toLowerCase();
  if (!term) return null;
  const matched = new Set<string>();
  for (const row of annotatedFields.value) {
    if (
      !row.isGroup &&
      row.group &&
      String(row.name ?? "").toLowerCase().includes(term)
    ) {
      matched.add(row.group);
    }
  }
  return matched;
});

// ---------------------------------------------------------------------------
// Visible fields — collapse filter
//
// A collapsed group keeps its header but drops its field rows. Because the
// downstream OFieldList decides whether to keep a group header during a search
// by looking for matching child rows, we must stamp the header with
// `matchesSearch` here — otherwise a collapsed group whose only match is hidden
// would lose its header too, making the field unreachable until page refresh.
// ---------------------------------------------------------------------------

const visibleFields = computed(() =>
  annotatedFields.value
    .filter((row: any) => {
      if (row.isGroup) return true;
      const group = row.group;
      if (group && expandGroupRows.value[group] === false) return false;
      return true;
    })
    .map((row: any) => {
      if (!row.isGroup) return row;
      const matched = searchMatchedGroups.value;
      return {
        ...row,
        matchesSearch: matched ? matched.has(row.group) : true,
      };
    }),
);

// ---------------------------------------------------------------------------
// Expose
// ---------------------------------------------------------------------------

function scrollToTop() {
  ofieldListRef.value?.scrollToTop?.();
}

defineExpose({ scrollToTop });
</script>

