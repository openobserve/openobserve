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
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <OTable
      :columns="columns"
      :data="filteredPages"
      :loading="loading"
      pagination="client"
      :page-size="20"
      :page-size-options="[20, 50, 100]"
      row-key="id"
      :show-global-filter="false"
      :persist-columns="true"
      table-id="status-pages-table"
      :enable-column-resize="true"
      :column-visibility="defaultColumnVisibility"
      :footer-title="t('statusPages.footerTitle')"
      data-test="status-pages-table"
      :horizontal-scroll="true"
      show-index
      @row-click="(row: any) => emit('edit', row)"
    >
      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <OInput
            v-model="search"
            class="w-full min-w-0"
            :placeholder="t('statusPages.searchPlaceholder')"
            data-test="status-pages-search-input"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OInput>
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="status-pages-refresh-btn"
          @click="emit('refresh')"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
      </template>

      <!-- Name -->
      <template #cell-name="{ row }">
        <OTooltip
          v-if="(row as any).name"
          :content="raw((row as any).name)"
          content-class="max-w-[25rem] whitespace-normal break-words text-xs"
        >
          <span class="cursor-pointer truncate">{{ (row as any).name }}</span>
        </OTooltip>
        <span v-else class="truncate">—</span>
      </template>

      <!-- Health -->
      <template #cell-health="{ row }">
        <OBadge :variant="healthBadge((row as any).health).variant" :dot="true" size="sm">
          {{ t(healthBadge((row as any).health).labelKey) }}
        </OBadge>
      </template>

      <!-- Visibility -->
      <template #cell-visibility="{ row }">
        <OBadge :variant="visibilityBadge((row as any).visibility).variant" size="sm">
          {{ t(visibilityBadge((row as any).visibility).labelKey) }}
        </OBadge>
      </template>

      <!-- Components count -->
      <template #cell-component_count="{ row }">
        <span class="tabular-nums">{{ (row as any).component_count ?? 0 }}</span>
      </template>

      <!-- Public URL + copy -->
      <template #cell-slug="{ row }">
        <div class="flex min-w-0 items-center gap-1">
          <OTooltip
            :content="raw(publicStatusPageUrl((row as any).slug))"
            content-class="max-w-[25rem] break-all text-xs"
          >
            <span class="text-text-secondary truncate font-mono text-xs">{{
              raw(`/status/${(row as any).slug}`)
            }}</span>
          </OTooltip>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="content-copy"
            :data-test="`status-pages-copy-url-${(row as any).id}`"
            @click.stop="copyUrl((row as any).slug)"
          >
            <OTooltip side="bottom" :content="t('statusPages.copyUrl')" />
          </OButton>
        </div>
      </template>

      <!-- Updated -->
      <template #cell-updated_at="{ row }">
        <OTimeCell :value="(row as any).updated_at" unit="us" mode="relative" :timezone="timezone" />
      </template>

      <!-- Row actions -->
      <template #cell-actions="{ row }">
        <div class="flex items-center gap-0.5" @click.stop>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            :data-test="`status-pages-edit-btn-${(row as any).id}`"
            @click.stop="emit('edit', row)"
          >
            <OTooltip side="bottom" :content="t('common.edit')" />
          </OButton>

          <ODropdown>
            <template #trigger>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="more-vert"
                :data-test="`status-pages-more-btn-${(row as any).id}`"
                @click.stop
              >
                <OTooltip side="bottom" :content="t('statusPages.more')" />
              </OButton>
            </template>

            <ODropdownItem
              :data-test="`status-pages-copy-url-item-${(row as any).id}`"
              @select="copyUrl((row as any).slug)"
            >
              <template #icon-left>
                <OIcon name="content-copy" size="sm" />
              </template>
              {{ t("statusPages.copyUrl") }}
            </ODropdownItem>

            <ODropdownSeparator />

            <ODropdownItem
              variant="destructive"
              :data-test="`status-pages-delete-item-${(row as any).id}`"
              @select="emit('delete', row)"
            >
              <template #icon-left>
                <OIcon name="delete" size="sm" />
              </template>
              {{ t("common.delete") }}
            </ODropdownItem>
          </ODropdown>
        </div>
      </template>

      <!-- Empty state: first-run vs filtered -->
      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="block"
          icon="monitor-heart"
          :filtered="!!search"
          :title="t('statusPages.empty.title')"
          :description="t('statusPages.empty.description')"
          :action-label="t('statusPages.newPage')"
          action-icon="add"
          data-test="status-pages-empty-state"
          @action="onEmptyAction"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { StatusPageListItem } from "@/services/status_pages";
import { healthBadge, visibilityBadge, publicStatusPageUrl } from "./statusPageBadges";

const props = withDefaults(
  defineProps<{
    pages: StatusPageListItem[];
    loading?: boolean;
    timezone?: string;
  }>(),
  { loading: false, timezone: "UTC" },
);

const emit = defineEmits<{
  refresh: [];
  edit: [row: StatusPageListItem];
  delete: [row: StatusPageListItem];
  "new-page": [];
}>();

const { t } = useI18nTyped();
const search = ref("");

const filteredPages = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.pages;
  return props.pages.filter(
    (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
  );
});

// Secondary columns start hidden; identity + health stay visible.
const defaultColumnVisibility = { updated_at: false };

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("statusPages.columns.name"),
    accessorKey: "name",
    size: COL.name,
    minSize: 140,
    sortable: true,
    hideable: true,
    meta: { isName: true, flex: true },
  },
  {
    id: "health",
    header: t("statusPages.columns.health"),
    accessorKey: "health",
    size: COL.status,
    minSize: 120,
    sortable: true,
    hideable: true,
  },
  {
    id: "visibility",
    header: t("statusPages.columns.visibility"),
    accessorKey: "visibility",
    size: COL.status,
    minSize: 100,
    sortable: true,
    hideable: true,
  },
  {
    id: "component_count",
    header: t("statusPages.columns.components"),
    accessorKey: "component_count",
    size: COL.count,
    minSize: 90,
    sortable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "slug",
    header: t("statusPages.columns.url"),
    accessorKey: "slug",
    size: COL.url,
    minSize: 160,
    sortable: false,
    hideable: true,
  },
  {
    id: "updated_at",
    header: t("statusPages.columns.updated"),
    accessorKey: "updated_at",
    size: COL.lastCheck,
    minSize: 100,
    sortable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: raw(""),
    accessorKey: "id",
    size: 96,
    minSize: 96,
    sortable: false,
    isAction: true,
  },
]);

function copyUrl(slug: string) {
  copyToClipboard(publicStatusPageUrl(slug), t, {
    successMessage: t("statusPages.toast.urlCopied"),
  });
}

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") {
    search.value = "";
    return;
  }
  emit("new-page");
};
</script>
