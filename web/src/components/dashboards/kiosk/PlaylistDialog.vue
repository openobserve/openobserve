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
  <ODialog
    :open="open"
    size="md"
    :title="t('dashboard.playlist.title')"
    :neutral-button-label="t('common.cancel')"
    neutral-button-variant="outline"
    :secondary-button-label="
      copied ? t('dashboard.playlist.copied') : t('dashboard.playlist.copyLink')
    "
    secondary-button-variant="outline"
    :secondary-button-disabled="!items.length"
    :primary-button-label="t('dashboard.playlist.open')"
    :primary-button-disabled="!items.length"
    data-test="dashboard-playlist-dialog"
    @update:open="(value) => emit('update:open', value)"
    @click:neutral="emit('update:open', false)"
    @click:secondary="copyLink"
    @click:primary="openPlaylist"
  >
    <div class="flex flex-col gap-5">
      <section class="flex flex-col gap-2">
        <span class="text-text-heading flex items-center gap-1.5 text-sm font-medium">
          <OIcon name="add" size="sm" class="text-accent" />
          {{ t("dashboard.playlist.addLabel") }}
          <OIcon
            name="info-outline"
            size="sm"
            class="text-text-secondary cursor-help"
            data-test="dashboard-playlist-add-info"
            ><OTooltip :content="t('dashboard.playlist.addHint')"
          /></OIcon>
        </span>

        <OSearchInput
          v-model="query"
          :debounce="400"
          :disabled="full"
          :placeholder="
            full
              ? t('dashboard.playlist.fullPlaceholder', { max: maxEntries })
              : t('dashboard.playlist.searchPlaceholder')
          "
          data-test="dashboard-playlist-search"
        />

        <div
          v-if="searchTerm"
          class="border-border-default rounded-default flex max-h-48 flex-col overflow-y-auto border"
          data-test="dashboard-playlist-results"
        >
          <div v-if="search.isLoading.value" class="flex flex-col gap-2 p-2">
            <OSkeleton v-for="n in 3" :key="n" type="text" class="h-4" />
          </div>
          <div
            v-else-if="search.isError.value"
            class="text-status-error-text flex items-center gap-2 px-2 py-1.5 text-sm"
            data-test="dashboard-playlist-search-error"
          >
            <OIcon name="error" size="sm" class="shrink-0" />
            <span class="flex-1">{{ t("dashboard.playlist.searchFailed") }}</span>
            <OButton variant="outline" size="xs" @click="search.refetch()">
              {{ t("common.retry") }}
            </OButton>
          </div>
          <template v-else-if="results.length">
            <div
              v-for="hit in results"
              :key="entryKey(hit)"
              class="flex min-w-0 items-center gap-2 px-2 py-1"
              :data-test="`dashboard-playlist-result-${hit.dashboardId}`"
            >
              <OIcon name="dashboard" size="sm" class="text-text-secondary shrink-0" />
              <OTruncatedText class="min-w-0 flex-1 text-sm">{{ hit.title }}</OTruncatedText>
              <OBadge variant="default-soft" size="sm" icon="folder" class="max-w-40 shrink-0">
                <OTruncatedText>{{ hit.folderName }}</OTruncatedText>
              </OBadge>
              <OButton
                v-if="isAdded(hit)"
                variant="ghost-success"
                size="xs"
                icon-left="check"
                disabled
                class="shrink-0"
              >
                {{ t("dashboard.playlist.added") }}
              </OButton>
              <OButton
                v-else
                variant="ghost-primary"
                size="xs"
                icon-left="add"
                class="shrink-0"
                :disabled="full"
                :data-test="`dashboard-playlist-add-${hit.dashboardId}`"
                @click="addHit(hit)"
              >
                {{ t("dashboard.playlist.add") }}
              </OButton>
            </div>
          </template>
          <p v-else class="text-text-secondary px-2 py-1.5 text-sm">
            {{ t("dashboard.playlist.noMatches", { query: searchTerm }) }}
          </p>
        </div>

        <div class="mt-3 flex items-center justify-between gap-2">
          <span class="text-text-heading flex items-center gap-1.5 text-sm font-medium">
            {{ t("dashboard.playlist.dashboards") }}
            <OIcon
              name="info-outline"
              size="sm"
              class="text-text-secondary cursor-help"
              data-test="dashboard-playlist-dashboards-info"
              ><OTooltip :content="t('dashboard.playlist.variablesNote')"
            /></OIcon>
          </span>
          <span
            class="text-text-secondary text-xs tabular-nums"
            data-test="dashboard-playlist-count"
          >
            {{ t("dashboard.playlist.countOfMax", { count: items.length, max: maxEntries }) }}
          </span>
        </div>

        <ol
          v-if="items.length"
          class="border-border-default rounded-default divide-border-default flex flex-col divide-y border"
          data-test="dashboard-playlist-items"
        >
          <li
            v-for="(item, index) in items"
            :key="entryKey(item)"
            class="flex min-w-0 items-center gap-2 px-2 py-1"
            :class="[
              dragIndex === index ? 'opacity-50' : '',
              dropIndex === index && dragIndex !== index ? 'bg-surface-subtle' : '',
            ]"
            :draggable="isArmed(entryKey(item))"
            :data-test="`dashboard-playlist-item-${index}`"
            @dragstart="dragIndex = index"
            @dragover.prevent="onDragOver(index)"
            @drop.prevent="onDrop(index)"
            @dragend="endDrag"
          >
            <OIcon
              name="drag-indicator"
              size="sm"
              class="text-text-secondary shrink-0 cursor-grab"
              :title="t('dashboard.playlist.dragToReorder')"
              :data-test="`dashboard-playlist-grip-${index}`"
              @mousedown="arm(entryKey(item))"
            />
            <span class="text-text-secondary w-5 shrink-0 text-xs tabular-nums">
              {{ index + 1 }}
            </span>
            <OIcon name="dashboard" size="sm" class="text-accent shrink-0" />
            <OTruncatedText class="text-text-body min-w-0 flex-1 text-sm">
              {{ describe(item).title }}
            </OTruncatedText>
            <OBadge
              v-if="describe(item).missing"
              variant="warning-soft"
              size="sm"
              class="shrink-0"
              :data-test="`dashboard-playlist-missing-${index}`"
            >
              {{ t("dashboard.playlist.notFound") }}
            </OBadge>
            <OBadge
              v-else-if="describe(item).folderName"
              variant="default-soft"
              size="sm"
              icon="folder"
              class="max-w-40 shrink-0 max-md:hidden"
            >
              <OTruncatedText>{{ describe(item).folderName }}</OTruncatedText>
            </OBadge>
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="keyboard-arrow-up"
              :disabled="index === 0"
              :aria-label="t('dashboard.playlist.moveUp')"
              :data-test="`dashboard-playlist-up-${index}`"
              @click="move(index, index - 1)"
            >
              <OTooltip :content="t('dashboard.playlist.moveUp')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="keyboard-arrow-down"
              :disabled="index === items.length - 1"
              :aria-label="t('dashboard.playlist.moveDown')"
              :data-test="`dashboard-playlist-down-${index}`"
              @click="move(index, index + 1)"
            >
              <OTooltip :content="t('dashboard.playlist.moveDown')" />
            </OButton>
            <OButton
              variant="ghost-muted"
              size="icon-xs-sq"
              icon-left="close"
              :aria-label="t('dashboard.playlist.remove')"
              :data-test="`dashboard-playlist-remove-${index}`"
              @click="items.splice(index, 1)"
            >
              <OTooltip :content="t('dashboard.playlist.remove')" />
            </OButton>
          </li>
        </ol>
        <OEmptyState
          v-else
          size="inline"
          icon="tv"
          :title="t('dashboard.playlist.emptyTitle')"
          :description="t('dashboard.playlist.emptyDescription')"
          data-test="dashboard-playlist-empty"
        />
      </section>

      <section class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <OSelect
          :label="t('dashboard.playlist.showEachFor')"
          :model-value="intervalSeconds"
          :options="intervalOptions"
          size="md"
          :searchable="false"
          data-test="dashboard-playlist-interval"
          @update:model-value="onIntervalChange"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.playlist.refreshNote')" />
          </template>
        </OSelect>
        <OSelect
          :label="t('dashboard.playlist.timeRange')"
          :model-value="period ?? OWN_DEFAULT"
          :options="periodOptions"
          size="md"
          :searchable="false"
          data-test="dashboard-playlist-period"
          @update:model-value="onPeriodChange"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.playlist.timeRangeHelp')" />
          </template>
        </OSelect>
        <OToggleGroup
          :model-value="theme"
          type="single"
          :label="t('dashboard.kiosk.theme')"
          label-position="top"
          data-test="dashboard-playlist-theme"
          @update:model-value="onThemeChange"
        >
          <OToggleGroupItem
            v-for="option in themeOptions"
            :key="option.value"
            :value="option.value"
            size="sm"
            :data-test="`dashboard-playlist-theme-${option.value}`"
          >
            {{ option.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OSwitch
          v-model="fit"
          class="self-end"
          :label="t('dashboard.kiosk.fit')"
          data-test="dashboard-playlist-fit"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.kiosk.fitHelp')" />
          </template>
        </OSwitch>
      </section>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQueries, useQuery } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import useDragHandle from "@/composables/useDragHandle";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  dashboardsByFolderQuery,
  dashboardsSearchQuery,
  toSearchHit,
  type DashboardSearchHit,
} from "@/services/dashboards.queries";
import { copyToClipboard } from "@/utils/clipboard";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatRefreshLabel,
  formatRelativePeriod,
  type KioskThemeChoice,
} from "@/utils/dashboard/kiosk";
import {
  PLAYLIST_DEFAULT_INTERVAL_SECONDS,
  PLAYLIST_INTERVAL_CHOICES,
  PLAYLIST_MAX_ENTRIES,
  PLAYLIST_PERIOD_CHOICES,
  PLAYLIST_TV_PATH,
  buildPlaylistQuery,
  type PlaylistConfig,
  type PlaylistDialogEntry,
  type PlaylistEntry,
} from "@/utils/dashboard/playlist";

const props = defineProps<{
  open: boolean;
  entries: PlaylistDialogEntry[];
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  open: [config: PlaylistConfig];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const org = useOrgId();

const OWN_DEFAULT = "own";
const COPIED_MS = 2500;
const DEFAULT_PERIOD = "1h";
const maxEntries = PLAYLIST_MAX_ENTRIES;

const items = ref<PlaylistDialogEntry[]>([]);
const intervalSeconds = ref(PLAYLIST_DEFAULT_INTERVAL_SECONDS);
const period = ref<string | null>(DEFAULT_PERIOD);
const theme = ref<KioskThemeChoice>("current");
const fit = ref(false);
const query = ref("");

const entryKey = (entry: PlaylistEntry) => `${entry.folderId}/${entry.dashboardId}`;

// Each opening starts from what the caller passes in, not from the last edit.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    items.value = props.entries.slice(0, PLAYLIST_MAX_ENTRIES).map((entry) => ({ ...entry }));
    intervalSeconds.value = PLAYLIST_DEFAULT_INTERVAL_SECONDS;
    period.value = DEFAULT_PERIOD;
    theme.value = "current";
    fit.value = false;
    query.value = "";
  },
  { immediate: true },
);

const full = computed(() => items.value.length >= PLAYLIST_MAX_ENTRIES);
const searchTerm = computed(() => query.value.trim());

const search = useQuery(() =>
  Object.assign(dashboardsSearchQuery(org.value, searchTerm.value), {
    enabled: props.open && !!org.value && !!searchTerm.value,
  }),
);

const results = computed<DashboardSearchHit[]>(() => search.data.value ?? []);

const isAdded = (hit: PlaylistEntry) =>
  items.value.some((item) => entryKey(item) === entryKey(hit));

const addHit = (hit: DashboardSearchHit) => {
  if (full.value || isAdded(hit)) return;
  items.value.push({ ...hit });
};

// Rows opened from a link carry only ids, so their names come from each folder's (cached) list.
const foldersToResolve = computed(() => [
  ...new Set(
    items.value.filter((item) => !item.title || !item.folderName).map((item) => item.folderId),
  ),
]);

const folderLists = useQueries({
  queries: computed(() =>
    foldersToResolve.value.map((folderId) =>
      Object.assign(dashboardsByFolderQuery(org.value, folderId), {
        enabled: props.open && !!org.value,
      }),
    ),
  ),
});

const resolvedByKey = computed(() => {
  const found = new Map<string, DashboardSearchHit>();
  const settled = new Set<string>();
  foldersToResolve.value.forEach((folderId, i) => {
    const result = folderLists.value[i];
    if (!result || result.isLoading) return;
    settled.add(folderId);
    (result.data ?? []).map(toSearchHit).forEach((hit) => found.set(entryKey(hit), hit));
  });
  return { found, settled };
});

const describe = (item: PlaylistDialogEntry) => {
  const hit = resolvedByKey.value.found.get(entryKey(item));
  const settled = resolvedByKey.value.settled.has(item.folderId);
  return {
    title: raw(item.title || hit?.title || item.dashboardId),
    folderName: item.folderName || hit?.folderName || null,
    missing: !item.title && !hit && settled,
  };
};

const move = (from: number, to: number) => {
  if (to < 0 || to >= items.value.length || from === to) return;
  const [moved] = items.value.splice(from, 1);
  items.value.splice(to, 0, moved);
};

const { arm, isArmed } = useDragHandle();
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

const onDragOver = (index: number) => {
  if (dragIndex.value !== null) dropIndex.value = index;
};

const endDrag = () => {
  dragIndex.value = null;
  dropIndex.value = null;
};

const onDrop = (index: number) => {
  const from = dragIndex.value;
  endDrag();
  if (from !== null) move(from, index);
};

const intervalOptions = computed(() => {
  const values = new Set<number>(PLAYLIST_INTERVAL_CHOICES);
  values.add(intervalSeconds.value);
  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({ label: formatRefreshLabel(value, t), value }));
});

const periodOptions = computed(() => {
  const values = new Set<string>(PLAYLIST_PERIOD_CHOICES);
  if (period.value) values.add(period.value);
  return [
    { label: t("dashboard.playlist.ownDefault"), value: OWN_DEFAULT },
    ...[...values].map((value) => ({
      label: formatRelativePeriod(value, t) ?? raw(value),
      value,
    })),
  ];
});

const onIntervalChange = (value: unknown) => {
  const seconds = Number(value);
  if (seconds > 0) intervalSeconds.value = seconds;
};

const onPeriodChange = (value: unknown) => {
  if (typeof value !== "string" || !value) return;
  period.value = value === OWN_DEFAULT ? null : value;
};

const themeOptions = computed(() => [
  { value: "current" as const, label: t("dashboard.kiosk.themeCurrent") },
  { value: "light" as const, label: t("dashboard.kiosk.themeLight") },
  { value: "dark" as const, label: t("dashboard.kiosk.themeDark") },
]);

// Clicking the pressed item emits an empty value; a theme choice is always required.
const onThemeChange = (value: unknown) => {
  if (value === "current" || value === "light" || value === "dark") theme.value = value;
};

const buildConfig = (): PlaylistConfig => ({
  org: org.value,
  entries: items.value.map(({ dashboardId, folderId }) => ({ dashboardId, folderId })),
  intervalSeconds: intervalSeconds.value,
  slideIndex: 0,
  period: period.value,
  theme: theme.value,
  fit: fit.value,
  timezone: null,
});

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// The button itself confirms the copy, since a toast can land out of sight on a TV.
const copyLink = async () => {
  const href = router.resolve({
    path: PLAYLIST_TV_PATH,
    query: buildPlaylistQuery(buildConfig()),
  }).href;
  const ok = await copyToClipboard(window.location.origin + href, t, {
    successMessage: t("dashboard.playlist.linkCopied"),
    timeout: 5000,
  });
  if (!ok) return;
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
};

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

const openPlaylist = () => {
  if (!items.value.length) return;
  emit("open", buildConfig());
  emit("update:open", false);
};
</script>
