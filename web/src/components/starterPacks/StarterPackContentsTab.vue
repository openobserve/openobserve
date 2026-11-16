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

<script setup lang="ts">
import { computed, ref } from "vue";
import FitItems from "@/components/common/FitItems.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTableRowAction } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  CONTENT_KINDS,
  matchesSearch,
  type ContentKind,
  type PackContentRow,
} from "@/composables/starterPacks/packContents";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped } from "@/types/i18n";
import { DOT_CLASS, worstDot, type StreamDot } from "./streamHealthDisplay";

type Filter = "all" | ContentKind;

const props = defineProps<{ page: StarterPackPage }>();
const emit = defineEmits<{
  select: [row: PackContentRow];
  open: [row: PackContentRow, newTab?: boolean];
  edit: [row: PackContentRow];
  copyLink: [row: PackContentRow];
  retry: [];
  addNow: [row: PackContentRow];
  openAlerts: [];
  openDashboards: [];
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();

const KIND_ICON: Record<ContentKind, IconName> = {
  alert: "schedule",
  dashboard: "dashboard",
  savedView: "bookmark",
};
const FILTER_ICON: Record<ContentKind, IconName> = {
  alert: "notifications",
  dashboard: "dashboard",
  savedView: "bookmark",
};
const GROUP_KEYS = {
  alert: "starterPacks.page.contents.groupAlerts",
  dashboard: "starterPacks.page.contents.groupDashboards",
  savedView: "starterPacks.page.contents.groupViews",
} as const;
const FILTER_KEYS = {
  alert: "starterPacks.page.contents.filterAlerts",
  dashboard: "starterPacks.page.contents.filterDashboards",
  savedView: "starterPacks.page.contents.filterViews",
} as const;

const filter = ref<Filter>("all");
const search = ref("");

const rows = computed(() => props.page.contents.value);
const counts = computed(
  () =>
    Object.fromEntries(
      CONTENT_KINDS.map((kind) => [kind, rows.value.filter((row) => row.kind === kind).length]),
    ) as Record<ContentKind, number>,
);
const shown = computed(() =>
  rows.value.filter(
    (row) =>
      (filter.value === "all" || row.kind === filter.value) && matchesSearch(row, search.value),
  ),
);
const sectionCounts = computed(
  () =>
    Object.fromEntries(
      CONTENT_KINDS.map((kind) => [kind, shown.value.filter((row) => row.kind === kind).length]),
    ) as Record<ContentKind, number>,
);
const installed = computed(() => props.page.installed.value);
const canManage = computed(() => props.page.canManage.value);
const isLive = (row: PackContentRow) =>
  !["notCreated", "skipped", "willBeCreated"].includes(row.state) && !!row.id;

const dotOf = (row: PackContentRow): StreamDot => {
  if (!isLive(row)) return "none";
  return worstDot(row.streams.map((name) => props.page.healthOf(name)?.state ?? "none"));
};

const columns = computed<OTableColumnDef<PackContentRow>[]>(() => [
  { id: "name", header: t("common.name"), accessorKey: "name", size: 260 },
  { id: "description", header: t("common.description"), accessorKey: "description", size: 260 },
  { id: "data", header: t("starterPacks.page.contents.colData"), size: 240 },
  { id: "state", header: t("starterPacks.page.contents.colState"), size: 170 },
  { id: "changes", header: t("starterPacks.page.contents.colChanges"), size: 120 },
  { id: "actions", header: t("common.actions"), isAction: true, size: 120 },
]);

// Not "edit": OTable ranks that id first, and the design puts Open first.
const rowActions = computed<OTableRowAction<PackContentRow>[]>(() => [
  {
    id: "open",
    label: t("starterPacks.page.contents.open"),
    icon: "call-made",
    inline: true,
    visible: isLive,
    onSelect: (row) => emit("open", row),
    dataTest: () => "starter-pack-page-row-open",
  },
  {
    id: "editItem",
    shortcut: "edit",
    label: t("common.edit"),
    icon: "edit",
    inline: true,
    visible: (row) => isLive(row) && row.kind !== "savedView",
    onSelect: (row) => emit("edit", row),
    dataTest: () => "starter-pack-page-row-edit",
  },
  {
    id: "newTab",
    label: t("common.openInNewTab"),
    icon: "open-in-new",
    visible: isLive,
    onSelect: (row) => emit("open", row, true),
    dataTest: () => "starter-pack-page-row-new-tab",
  },
  {
    id: "copyLink",
    label: t("starterPacks.page.contents.copyLink"),
    icon: "link",
    visible: isLive,
    onSelect: (row) => emit("copyLink", row),
    dataTest: () => "starter-pack-page-row-copy-link",
  },
]);

// OTable shows three actions inline, so a saved view's Open and menu are drawn here; on mobile
// everything folds into the menu, as OTableRowActions does.
const ownActions = (row: PackContentRow) => row.kind === "savedView" && isLive(row);

const clearSearch = () => {
  search.value = "";
};
</script>

<template>
  <OTable
    :data="shown"
    :columns="columns"
    row-key="key"
    pagination="none"
    :show-global-filter="false"
    :frame="false"
    :row-section="(row: PackContentRow) => row.kind"
    :section-order="CONTENT_KINDS"
    :row-actions="rowActions"
    :row-actions-slot="ownActions"
    :loading="page.turn.loadState.value === 'loading' && !rows.length"
    data-test="starter-pack-page-contents"
    @row-click="(row: PackContentRow) => emit('select', row)"
  >
    <template #toolbar>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:contents">
        <OToggleGroup v-model="filter" mobile-dropdown data-test="starter-pack-page-type-filter">
          <OToggleGroupItem value="all" size="sm" data-test="starter-pack-page-type-all">
            {{ t("starterPacks.page.contents.filterAll", { count: rows.length }) }}
          </OToggleGroupItem>
          <OToggleGroupItem
            v-for="kind in CONTENT_KINDS"
            :key="kind"
            :value="kind"
            size="sm"
            :icon-left="FILTER_ICON[kind]"
            :disabled="!counts[kind]"
            :tooltip="counts[kind] ? undefined : t('starterPacks.page.strip.none')"
            :data-test="`starter-pack-page-type-${kind}`"
          >
            {{ t(FILTER_KEYS[kind], { count: counts[kind] }) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OSearchInput
          v-model="search"
          class="min-w-0 flex-1 basis-60 max-md:min-w-40 md:max-w-80"
          clearable
          :placeholder="t('starterPacks.page.contents.search')"
          data-test="starter-pack-page-search"
        />
      </div>
    </template>
    <template #toolbar-trailing>
      <ORefreshButton
        :last-run-at="page.lastRunAt.value"
        :loading="page.refreshing.value"
        variant="outline"
        layout="inline"
        data-test="starter-pack-page-refresh"
        @click="page.refresh(true)"
      />
    </template>

    <template #row-actions="{ row }">
      <span class="inline-flex items-center justify-end gap-1" data-test="o2-table-row-actions">
        <OButton
          v-if="!isMobile"
          variant="ghost"
          size="icon-xs-sq"
          icon-left="call-made"
          :aria-label="t('starterPacks.page.contents.open')"
          data-row-action="open"
          data-test="starter-pack-page-row-open"
          @click.stop="emit('open', row)"
        >
          <OTooltip :content="t('starterPacks.page.contents.open')" />
        </OButton>
        <ODropdown side="bottom" align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="more-vert"
              :aria-label="t('dashboard.moreActions')"
              data-test="o2-table-row-more-actions"
              @click.stop
            >
              <OTooltip :content="t('dashboard.moreActions')" />
            </OButton>
          </template>
          <ODropdownItem
            v-if="isMobile"
            icon-left="call-made"
            data-test="starter-pack-page-row-open-menu"
            @select="emit('open', row)"
          >
            {{ t("starterPacks.page.contents.open") }}
          </ODropdownItem>
          <ODropdownItem
            icon-left="open-in-new"
            data-test="starter-pack-page-row-new-tab-menu"
            @select="emit('open', row, true)"
          >
            {{ t("common.openInNewTab") }}
          </ODropdownItem>
          <ODropdownItem
            icon-left="link"
            data-test="starter-pack-page-row-copy-link-menu"
            @select="emit('copyLink', row)"
          >
            {{ t("starterPacks.page.contents.copyLink") }}
          </ODropdownItem>
        </ODropdown>
      </span>
    </template>

    <template #group-header="{ sectionKey }">
      <div
        class="px-page-edge flex items-center gap-2 py-1.5"
        :data-test="`starter-pack-page-group-${sectionKey}`"
      >
        <span class="text-text-heading text-xs font-semibold">
          {{ t(GROUP_KEYS[sectionKey as ContentKind]) }}
        </span>
        <span class="text-text-secondary text-xs">{{
          raw(`· ${sectionCounts[sectionKey as ContentKind] ?? 0}`)
        }}</span>
        <span class="flex-1" />
        <OButton
          v-if="installed && sectionKey === 'alert'"
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          data-test="starter-pack-page-open-in-alerts"
          @click.stop="emit('openAlerts')"
        >
          {{ t("starterPacks.page.openInAlerts") }}
        </OButton>
        <OButton
          v-if="installed && sectionKey === 'dashboard'"
          variant="ghost-primary"
          size="xs"
          icon-right="arrow-forward"
          data-test="starter-pack-page-open-in-dashboards"
          @click.stop="emit('openDashboards')"
        >
          {{ t("starterPacks.page.contents.openInDashboards") }}
        </OButton>
      </div>
    </template>

    <template #cell-name="{ row }">
      <span class="flex min-w-0 flex-col" data-test="starter-pack-page-row">
        <span class="flex min-w-0 items-center gap-2">
          <OIcon
            :name="KIND_ICON[row.kind as ContentKind]"
            size="sm"
            class="text-text-secondary shrink-0"
          />
          <OTruncatedText class="text-text-heading" data-test="starter-pack-page-row-name">{{
            raw(row.name)
          }}</OTruncatedText>
        </span>
        <OTruncatedText
          v-if="row.libraryTitle && row.libraryTitle !== row.name"
          class="text-text-secondary ps-6 text-xs"
          >{{ raw(row.libraryTitle) }}</OTruncatedText
        >
      </span>
    </template>
    <template #cell-description="{ row }">
      <OTruncatedText v-if="row.description" class="text-text-body">{{
        raw(row.description)
      }}</OTruncatedText>
      <span v-else class="text-text-muted">{{ raw("—") }}</span>
    </template>
    <template #cell-data="{ row }">
      <span v-if="row.streams.length" class="flex min-w-0 items-center gap-1.5">
        <span class="size-1.5 shrink-0 rounded-full" :class="DOT_CLASS[dotOf(row)]" />
        <OTooltip :content="raw(row.streams.join('\n'))" content-class="whitespace-pre-wrap" />
        <FitItems :items="row.streams">
          <template #default="{ item }">
            <span class="block truncate font-mono text-xs">{{ item }}</span>
          </template>
          <template #more="{ count }">
            <OTag variant="default-soft" size="xs" :label="raw(`+${count}`)" />
          </template>
        </FitItems>
      </span>
      <span v-else class="text-text-muted">{{ raw("—") }}</span>
    </template>
    <template #cell-state="{ row }">
      <span class="flex items-center gap-2">
        <OTag
          type="starterPackItemState"
          :value="row.state"
          size="sm"
          :data-test="`starter-pack-page-state-${row.state}`"
        />
        <OButton
          v-if="row.state === 'notCreated' && canManage"
          variant="outline"
          size="xs"
          data-test="starter-pack-page-row-retry"
          @click.stop="emit('retry')"
        >
          {{ t("common.retry") }}
        </OButton>
        <OButton
          v-if="row.state === 'skipped' && canManage && installed"
          variant="outline"
          size="xs"
          icon-left="add"
          :loading="page.adding.value === row.itemId"
          data-test="starter-pack-page-row-add-now"
          @click.stop="emit('addNow', row)"
        >
          {{ t("starterPacks.page.contents.addNow") }}
        </OButton>
      </span>
    </template>
    <template #cell-changes="{ row }">
      <span v-if="row.edited" class="inline-flex" data-test="starter-pack-page-row-edited">
        <OTag variant="default-soft" size="sm" :label="t('starterPacks.page.contents.edited')" />
        <OTooltip :content="t('starterPacks.page.contents.editedTip')" />
      </span>
      <span
        v-else-if="row.edited === false"
        class="text-text-secondary text-xs"
        data-test="starter-pack-page-row-as-installed"
        >{{ t("starterPacks.page.contents.asInstalled") }}</span
      >
      <span
        v-else-if="row.readFailed"
        class="text-text-secondary inline-flex text-xs"
        data-test="starter-pack-page-row-read-failed"
        >{{ t("starterPacks.page.contents.readFailed") }}
        <OTooltip :content="t('starterPacks.page.contents.readFailedTip')" />
      </span>
      <span v-else class="text-text-muted">{{ raw("—") }}</span>
    </template>

    <template #empty>
      <OEmptyState
        size="compact"
        variant="no-results"
        illustration="no-results"
        :title="
          search
            ? t('starterPacks.page.contents.noMatch', { search: raw(search) })
            : t('starterPacks.page.contents.empty')
        "
        :action-label="search ? t('starterPacks.page.contents.clearSearch') : undefined"
        :hide-action="!search"
        data-test="starter-pack-page-contents-empty"
        @action="clearSearch"
      />
    </template>
  </OTable>
</template>
