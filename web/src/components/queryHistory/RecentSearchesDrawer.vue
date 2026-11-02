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
  <ODrawer
    v-model:open="open"
    :size="isMobile ? 'full' : 'md'"
    :title="t('recentSearches.title')"
    bleed
    data-test="recent-searches-drawer"
  >
    <template #header-left>
      <OButton
        variant="ghost"
        size="icon-xs"
        icon-left="info-outline"
        :aria-label="aboutText"
        data-test="recent-searches-about"
      >
        <OTooltip :content="aboutText" />
      </OButton>
    </template>
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-border-default flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        <div class="flex items-center gap-2">
          <OSearchInput
            v-model="search"
            size="sm"
            clearable
            :debounce="300"
            :placeholder="t('recentSearches.searchPlaceholder')"
            class="min-w-0 flex-1"
            data-test="recent-searches-search"
          />
          <OToggleGroup v-model="scope" type="single" data-test="recent-searches-scope">
            <OToggleGroupItem value="page" size="sm" data-test="recent-searches-scope-page">
              {{ t(`recentSearches.page.${source}`) }}
            </OToggleGroupItem>
            <OToggleGroupItem value="all" size="sm" data-test="recent-searches-scope-all">
              {{ t("recentSearches.allPages") }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <OSelect
            v-model="stream"
            :options="streamOptions"
            size="sm"
            clearable
            searchable
            creatable
            :placeholder="t('recentSearches.allStreams')"
            class="w-44"
            data-test="recent-searches-stream"
          />
          <OSelect
            v-model="status"
            :options="statusOptions"
            size="sm"
            class="w-32"
            data-test="recent-searches-status"
          />
          <RecentSearchesDayPicker
            v-model="ranOn"
            :placeholder="t('recentSearches.datePlaceholder')"
            :field-label="t('recentSearches.filterByDateRun')"
            :zone="zone"
            data-test="recent-searches-ran-on"
          />
          <OCheckbox
            v-model="starredOnly"
            size="sm"
            :label="t('recentSearches.starredOnly')"
            data-test="recent-searches-starred-only"
          />
          <OButton
            v-if="filtered"
            variant="ghost-primary"
            size="xs"
            icon-left="restart-alt"
            class="ms-auto"
            data-test="recent-searches-reset-filters"
            @click="resetFilters"
          >
            {{ t("recentSearches.reset") }}
            <OTooltip :content="t('recentSearches.resetFilters')" />
          </OButton>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto" data-test="recent-searches-drawer-list">
        <div v-if="history.isPending.value && open" class="flex flex-col gap-3 p-4">
          <OSkeleton v-for="n in 5" :key="n" type="text" />
        </div>
        <OEmptyState
          v-else-if="history.isError.value"
          size="inline"
          icon="error"
          :title="t('recentSearches.loadError')"
          :action-label="t('recentSearches.retry')"
          action-icon="refresh"
          @action="history.refetch()"
        />
        <OEmptyState
          v-else-if="!rows.length"
          size="inline"
          icon="history"
          :title="filtered ? t('recentSearches.noMatch') : t('recentSearches.emptyTitle')"
          :action-label="filtered ? t('recentSearches.resetFilters') : undefined"
          action-icon="restart-alt"
          data-test="recent-searches-drawer-empty"
          @action="resetFilters"
        />
        <section v-for="group in groups" :key="group.dayMs" :data-test="`recent-searches-day`">
          <h3
            class="bg-surface-panel text-text-secondary border-border-subtle sticky top-0 z-1 border-b px-4 py-1 text-xs font-semibold uppercase"
          >
            {{ dayLabel(group) }}
          </h3>
          <div
            v-for="entry in group.entries"
            :key="entry.id"
            class="border-border-subtle hover:bg-dropdown-item-hover-bg group flex cursor-pointer flex-col gap-1 border-b px-4 py-2"
            :data-test="`recent-searches-drawer-row-${entry.id}`"
            @click="restore(entry, restoreTimeOf(entry), true)"
          >
            <div class="flex min-w-0 items-center gap-2">
              <OTag
                v-if="scope === 'all'"
                :label="t(`recentSearches.page.${entry.source}`)"
                size="sm"
                variant="primary-outline"
                class="shrink-0"
              />
              <OTag
                v-for="name in entry.streams.slice(0, 3)"
                :key="name"
                :label="raw(name)"
                size="sm"
                class="shrink-0"
              />
              <span v-if="entry.streams.length > 3" class="text-text-secondary text-xs">
                +{{ entry.streams.length - 3 }}
              </span>
              <span class="ms-auto flex shrink-0 items-center gap-1">
                <OTag
                  v-if="entry.status === 'error'"
                  :label="t('recentSearches.failed')"
                  variant="error-soft"
                  size="sm"
                  data-test="recent-searches-failed-tag"
                />
                <span
                  v-else-if="entry.context.warning !== undefined"
                  class="bg-status-warning-text size-2 rounded-full"
                  data-test="recent-searches-drawer-warning"
                >
                  <OTooltip :content="t('recentSearches.warning')" />
                </span>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  :icon-left="entry.starred ? 'star' : 'star-outline'"
                  :class="entry.starred ? 'text-accent' : ''"
                  :aria-label="
                    entry.starred ? t('recentSearches.unstar') : t('recentSearches.star')
                  "
                  :data-test="`recent-searches-star-${entry.id}`"
                  @click.stop="toggleStar(entry)"
                >
                  <OTooltip
                    :content="entry.starred ? t('recentSearches.unstar') : t('recentSearches.star')"
                  />
                </OButton>
                <ODropdown side="bottom" align="end">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-sm"
                      icon-left="more-vert"
                      :aria-label="t('common.more')"
                      :data-test="`recent-searches-more-${entry.id}`"
                      @click.stop
                    />
                  </template>
                  <ODropdownItem
                    icon-left="edit-note"
                    :data-test="`recent-searches-load-${entry.id}`"
                    @select="restore(entry, restoreTimeOf(entry), false)"
                  >
                    <span>{{ t("recentSearches.loadOnly") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    icon-left="link"
                    :data-test="`recent-searches-copy-link-${entry.id}`"
                    @select="copyLink(entry)"
                  >
                    <span>{{ t("recentSearches.copyLink") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    icon-left="content-copy"
                    :data-test="`recent-searches-copy-query-${entry.id}`"
                    @select="copyQuery(entry)"
                  >
                    <span>{{ t("recentSearches.copyQuery") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    v-if="functionOf(entry)"
                    icon-left="content-copy"
                    :data-test="`recent-searches-copy-function-${entry.id}`"
                    @select="copyFunction(entry)"
                  >
                    <span>{{ t("recentSearches.copyFunction") }}</span>
                  </ODropdownItem>
                  <ODropdownItem
                    variant="destructive"
                    icon-left="delete"
                    :data-test="`recent-searches-delete-${entry.id}`"
                    @select="removeWithUndo(entry)"
                  >
                    <span>{{ t("common.delete") }}</span>
                  </ODropdownItem>
                </ODropdown>
              </span>
            </div>
            <OTruncatedText
              :lines="2"
              :tooltip="queryTooltip(entry)"
              tooltip-class="whitespace-pre-wrap font-mono"
              class="text-text-heading font-mono text-xs break-all"
              data-test="recent-searches-drawer-query"
            >
              {{ entry.query }}
            </OTruncatedText>
            <OTruncatedText
              v-if="functionOf(entry)"
              :tooltip="raw(functionOf(entry))"
              tooltip-class="whitespace-pre-wrap font-mono"
              class="text-text-secondary font-mono text-xs"
              data-test="recent-searches-drawer-function"
            >
              {{ t("recentSearches.functionLabel") }}: {{ functionOf(entry) }}
            </OTruncatedText>
            <OTruncatedText
              v-if="entry.status === 'error' && entry.context.error"
              :tooltip="raw(entry.context.error)"
              class="text-status-error-text text-xs"
              data-test="recent-searches-drawer-error"
            >
              {{ entry.context.error }}
            </OTruncatedText>
            <div class="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span v-if="windowText(entry)" data-test="recent-searches-window">
                <OIcon name="schedule" size="xs" class="me-1 align-middle" />{{ windowText(entry) }}
              </span>
              <span data-test="recent-searches-span">{{ spanText(entry) }}</span>
              <span class="ms-auto flex items-center gap-1">
                <OButton
                  variant="outline"
                  size="xs"
                  icon-left="play-arrow"
                  :data-test="`recent-searches-rerun-now-${entry.id}`"
                  @click.stop="restore(entry, 'now', true)"
                >
                  {{ t("recentSearches.rerunNow") }}
                </OButton>
                <OButton
                  v-if="entry.context.time || entry.context.time_range"
                  variant="outline"
                  size="xs"
                  icon-left="history"
                  :data-test="`recent-searches-rerun-original-${entry.id}`"
                  @click.stop="restore(entry, 'original', true)"
                >
                  {{ t("recentSearches.rerunOriginal") }}
                </OButton>
              </span>
            </div>
          </div>
        </section>
        <div v-if="history.hasNextPage.value" class="flex justify-center p-3">
          <OButton
            variant="outline"
            size="sm"
            :loading="history.isFetchingNextPage.value"
            data-test="recent-searches-load-more"
            @click="history.fetchNextPage()"
          >
            {{ t("recentSearches.loadMore") }}
          </OButton>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-col gap-1.5">
        <div class="flex justify-end">
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            data-test="recent-searches-clear-btn"
            @click="clearOpen = true"
          >
            {{ t("recentSearches.clear") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODrawer>

  <ODialog
    v-model:open="clearOpen"
    size="sm"
    :title="t('recentSearches.clear')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('recentSearches.confirmClear')"
    primary-button-variant="destructive"
    :primary-button-loading="clearing"
    primary-button-data-test="recent-searches-clear-confirm"
    data-test="recent-searches-clear-dialog"
    @click:secondary="clearOpen = false"
    @click:primary="confirmClear"
  >
    <div class="flex flex-col gap-3">
      <p data-test="recent-searches-clear-body">
        {{
          scope === "page"
            ? t(
                "recentSearches.clearBodyPage",
                {
                  count: countLabel(unstarredCount.data.value),
                  page: t(`recentSearches.page.${source}`),
                  org: orgId,
                },
                pluralOf(unstarredCount.data.value),
              )
            : t(
                "recentSearches.clearBodyAll",
                { count: countLabel(unstarredCount.data.value), org: orgId },
                pluralOf(unstarredCount.data.value),
              )
        }}
      </p>
      <OCheckbox
        v-model="includeStarred"
        :label="
          t(
            'recentSearches.includeStarred',
            { count: countLabel(starredCount.data.value) },
            pluralOf(starredCount.data.value),
          )
        "
        data-test="recent-searches-clear-include-starred"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { DateTime } from "luxon";
import { useInfiniteQuery, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import { useRecentSearches } from "@/composables/queryHistory/useRecentSearches";
import { queryHistoryCountQuery, queryHistoryQuery } from "@/services/query_history.queries";
import type {
  HistorySource,
  HistoryStatus,
  QueryHistoryEntry,
  QueryHistoryListParams,
} from "@/services/query_history";
import {
  absoluteLink,
  dayBoundsUs,
  HISTORY_SOURCES,
  defaultRestoreTime,
  groupByDay,
  type DayGroup,
  type RestoreTime,
} from "@/utils/queryHistory/recentSearches";
import { recentSearchRoute } from "@/utils/queryHistory/routes";
import { logsEntryFunction } from "@/utils/queryHistory/logs";
import { copyToClipboard } from "@/utils/clipboard";
import { toast, toastRecords } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import RecentSearchesDayPicker from "./RecentSearchesDayPicker.vue";
import { useRecentEntryText } from "@/composables/queryHistory/useRecentEntryText";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const props = defineProps<{ source: HistorySource }>();

const UNDO_DELETE_MS = 6000;

const emit = defineEmits<{
  restore: [entry: QueryHistoryEntry, when: RestoreTime, run: boolean];
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const router = useRouter();
const { isMobile } = useBreakpoint();
const { orgId, about: aboutText, star, remove, clear } = useRecentSearches();
const { zone, windowText, spanText } = useRecentEntryText();

const search = ref("");
const scope = ref<"page" | "all">("page");
const stream = ref<string | null>(null);
const status = ref<"all" | HistoryStatus>("all");
const ranOn = ref<string | undefined>(undefined);
const starredOnly = ref(false);
const clearOpen = ref(false);
const includeStarred = ref(false);
const clearing = ref(false);

const sourceParam = computed(() =>
  scope.value === "page" ? props.source : HISTORY_SOURCES.join(","),
);

const filters = computed<QueryHistoryListParams>(() => ({
  source: sourceParam.value,
  ...(search.value.trim() ? { q: search.value.trim() } : {}),
  ...(stream.value ? { stream: stream.value } : {}),
  ...(status.value !== "all" ? { status: status.value } : {}),
  ...(starredOnly.value ? { starred: true } : {}),
  ...(ranOn.value ? (dayBoundsUs(ranOn.value, zone.value) ?? {}) : {}),
}));
const filtered = computed(
  () =>
    !!search.value.trim() ||
    !!stream.value ||
    status.value !== "all" ||
    starredOnly.value ||
    !!ranOn.value,
);

const resetFilters = () => {
  search.value = "";
  stream.value = null;
  status.value = "all";
  ranOn.value = undefined;
  starredOnly.value = false;
};

const history = useInfiniteQuery(() =>
  Object.assign(queryHistoryQuery(orgId.value, filters.value), {
    enabled: open.value && !!orgId.value,
  }),
);
const hiddenIds = ref<Set<string>>(new Set());
const pendingDeletes = new Map<string, { org: string; ids: Set<string>; dismiss: () => void }>();
const rows = computed(() =>
  (history.data.value?.pages.flat() ?? []).filter((entry) => !hiddenIds.value.has(entry.id)),
);
const groups = computed(() => groupByDay(rows.value, Date.now(), zone.value));

const unstarredCount = useQuery(() =>
  Object.assign(queryHistoryCountQuery(orgId.value, sourceParam.value, false), {
    enabled: clearOpen.value && !!orgId.value,
  }),
);
const starredCount = useQuery(() =>
  Object.assign(queryHistoryCountQuery(orgId.value, sourceParam.value, true), {
    enabled: clearOpen.value && !!orgId.value,
  }),
);

const streamOptions = computed(() => {
  const names = new Set(rows.value.flatMap((entry) => entry.streams));
  if (stream.value) names.add(stream.value);
  return [...names].sort().map((name) => ({ label: raw(name), value: name }));
});
const statusOptions = computed(() => [
  { label: t("recentSearches.statusAll"), value: "all" },
  { label: t("recentSearches.statusOk"), value: "ok" },
  { label: t("recentSearches.statusError"), value: "error" },
]);

const toggleStar = (entry: QueryHistoryEntry) => star(entry.id, !entry.starred);

// Decoded once per loaded entry, not on every use in the row.
const functions = computed(
  () => new Map(rows.value.map((entry) => [entry.id, logsEntryFunction(entry)])),
);
const functionOf = (entry: QueryHistoryEntry) => functions.value.get(entry.id) ?? "";

const dayLabel = (group: DayGroup): I18nText => {
  if (group.daysAgo === 0) return t("recentSearches.today");
  if (group.daysAgo === 1) return t("recentSearches.yesterday");
  return raw(
    DateTime.fromMillis(group.dayMs, zone.value ? { zone: zone.value } : {}).toFormat("ccc, LLL d"),
  );
};

const restoreTimeOf = (entry: QueryHistoryEntry) =>
  defaultRestoreTime(entry, Date.now(), zone.value);

const countLabel = (count: number | undefined) => (count === undefined ? "…" : String(count));

// A count still loading reads as plural ("… searches").
const pluralOf = (count: number | undefined) => count ?? 2;

const restore = (entry: QueryHistoryEntry, when: RestoreTime, run: boolean) => {
  emit("restore", entry, when, run);
  open.value = false;
};

const copyLink = (entry: QueryHistoryEntry) => {
  const route = recentSearchRoute(entry, "original", orgId.value, "link");
  if (!route) return;
  copyToClipboard(absoluteLink(router.resolve(route).href), t, {
    successMessage: t("recentSearches.linkCopied"),
  });
};

const setHidden = (id: string, hidden: boolean) => {
  const next = new Set(hiddenIds.value);
  if (hidden) next.add(id);
  else next.delete(id);
  hiddenIds.value = next;
};

const shortQuery = (query: string) => {
  const flat = query.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
};

// The backend has no restore: a row stays hidden while its toast offers Undo, and is deleted once that toast closes.
const removeWithUndo = (entry: QueryHistoryEntry) => {
  setHidden(entry.id, true);
  const org = orgId.value;
  let toastId = "";
  const dismissToast = toast({
    variant: "success",
    message: t("recentSearches.deletedQuery", { query: shortQuery(entry.query) }),
    timeout: UNDO_DELETE_MS,
    action: {
      label: t("recentSearches.undo"),
      handler: () => {
        const pending = pendingDeletes.get(toastId);
        if (!pending) return;
        pendingDeletes.delete(toastId);
        pending.ids.forEach((id) => setHidden(id, false));
        dismissToast();
      },
    },
  });
  toastId = dismissToast.id;
  const pending = pendingDeletes.get(toastId) ?? {
    org,
    ids: new Set<string>(),
    dismiss: dismissToast,
  };
  pending.ids.add(entry.id);
  pendingDeletes.set(toastId, pending);
  commitClosedDeletes();
};

const commitDeletes = (toastId: string) => {
  const pending = pendingDeletes.get(toastId);
  if (!pending) return;
  pendingDeletes.delete(toastId);
  // A delete the server refused shows its row again, since the entry is still stored.
  pending.ids.forEach((id) => remove(id, pending.org).catch(() => setHidden(id, false)));
};

const commitClosedDeletes = () => {
  for (const toastId of [...pendingDeletes.keys()]) {
    if (!toastRecords.some((r) => r.id === toastId && r.open)) commitDeletes(toastId);
  }
};

watch(toastRecords, commitClosedDeletes, { deep: true });

// Leaving commits the deletes, so their Undo must go first.
onBeforeUnmount(() => {
  for (const [toastId, pending] of [...pendingDeletes]) {
    pending.dismiss();
    commitDeletes(toastId);
  }
});

const copyQuery = (entry: QueryHistoryEntry) =>
  copyToClipboard(entry.query, t, { successMessage: t("recentSearches.queryCopied") });

const copyFunction = (entry: QueryHistoryEntry) =>
  copyToClipboard(functionOf(entry), t, {
    successMessage: t("recentSearches.functionCopied"),
  });

// A cut query's tooltip carries the VRL function too, since the search does not reproduce without it.
const queryTooltip = (entry: QueryHistoryEntry): I18nText | undefined => {
  const vrl = functionOf(entry);
  if (!vrl) return undefined;
  return raw(`${entry.query}\n\n${t("recentSearches.functionLabel")}:\n${vrl}`);
};

const confirmClear = async () => {
  clearing.value = true;
  try {
    await clear({
      source: sourceParam.value,
      include_starred: includeStarred.value,
    });
    clearOpen.value = false;
  } catch {
    // The mutation's error toast already told the user.
  } finally {
    clearing.value = false;
  }
};

watch(clearOpen, (isOpen) => {
  if (isOpen) includeStarred.value = false;
});

const show = (initialStatus: HistoryStatus | null = null) => {
  status.value = initialStatus ?? "all";
  open.value = true;
};

defineExpose({ show });
</script>
