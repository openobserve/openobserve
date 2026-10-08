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
  <div class="flex h-full flex-col" data-test="dashboards-public-links">
    <OTable
      class="min-h-0 flex-1"
      :data="visibleLinks"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :forbidden="forbidden"
      :frame="false"
      :default-columns="false"
      show-index
      pagination="client"
      :show-global-filter="false"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="public-links"
      data-test="dashboards-public-links-table"
    >
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="dashboards-public-links-summary"
        >
          <OStatStrip
            :items="summaryStats"
            :loading="loading"
            selectable
            compact
            :selected-key="statusFilter"
            default-key="all"
            @select="onStatSelect"
          />
        </div>
      </template>

      <template #toolbar>
        <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
          <div class="min-w-0 flex-1 max-md:min-w-40">
            <OInput
              v-model="searchQuery"
              :placeholder="t('dashboard.publicLinks.search')"
              clearable
              class="w-full"
              data-test="dashboards-public-links-search"
            >
              <template #icon-left>
                <OIcon name="search" size="sm" />
              </template>
            </OInput>
          </div>
        </div>
      </template>
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="lastUpdatedAt || null"
          :loading="fetching"
          data-test="dashboards-public-links-refresh-btn"
          @click="refreshLinks"
        />
      </template>

      <template #cell-name="{ row }">
        <span
          class="text-text-body truncate text-sm"
          :data-test="`dashboards-public-links-${row.id}-name`"
        >
          {{ row.name ? raw(row.name) : t("dashboard.publicLinks.untitled") }}
        </span>
      </template>
      <template #cell-dashboard="{ row }">
        <span
          v-if="!row.dashboard_title"
          class="text-text-muted truncate text-sm"
          :data-test="`dashboards-public-links-${row.id}-dashboard`"
        >
          {{ t("dashboard.publicLinks.dashboardMissing") }}
        </span>
        <span
          v-else
          class="truncate text-sm"
          :data-test="`dashboards-public-links-${row.id}-dashboard`"
        >
          <span class="text-text-secondary">{{
            raw(`${row.folder_name ?? row.folder_id ?? "default"} / `)
          }}</span>
          <span class="text-text-body">{{ raw(row.dashboard_title) }}</span>
        </span>
      </template>
      <template #cell-status="{ row }">
        <OTag
          type="publicLinkStatus"
          :value="row.status"
          :data-test="`dashboards-public-links-${row.id}-status`"
        />
      </template>
      <template #cell-ranges="{ row }">
        <PublicLinkRangesCell :link="row" :data-test="`dashboards-public-links-${row.id}-ranges`" />
      </template>
      <template #cell-refresh="{ row }">
        <span class="text-text-body text-sm">{{
          hasRelativeRange(row)
            ? refreshLabel(row.rebuild_secs, t)
            : t("dashboard.publicLinks.refreshOnce")
        }}</span>
      </template>
      <template #cell-expires="{ row }">
        <PublicLinkExpiresCell
          :link="row"
          :timezone="timezone"
          :data-test="`dashboards-public-links-${row.id}-expires`"
        />
      </template>
      <template #cell-updated="{ row }">
        <OTimeCell :value="row.last_rebuilt_at" unit="us" :timezone="timezone" :now="now" />
      </template>
      <template #cell-published_by="{ row }">
        <OUserCell :value="row.published_by" />
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-0.5" @click.stop>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="content-copy"
            class="max-md:hidden"
            :aria-label="t('dashboard.publicDashboard.copyLink')"
            :data-test="`dashboards-public-links-${row.id}-copy-btn`"
            @click="copyLink(row)"
          >
            <OTooltip side="bottom" :content="t('dashboard.publicDashboard.copyLink')" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="open-in-new"
            class="max-md:hidden"
            :aria-label="t('dashboard.publicLinks.openPublicPage')"
            :data-test="`dashboards-public-links-${row.id}-open-btn`"
            @click="openPublicPage(row)"
          >
            <OTooltip side="bottom" :content="t('dashboard.publicLinks.openPublicPage')" />
          </OButton>
          <OButton
            v-if="hasDashboard(row)"
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            class="max-md:hidden"
            :aria-label="t('dashboard.publicLinks.editSettings')"
            :data-test="`dashboards-public-links-${row.id}-edit-btn`"
            @click="editLink(row)"
          >
            <OTooltip side="bottom" :content="t('dashboard.publicLinks.editSettings')" />
          </OButton>
          <OButton
            v-if="canPause(row)"
            :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
            size="icon-sm"
            :icon-left="row.enabled ? 'pause' : 'play-arrow'"
            class="max-md:hidden"
            :aria-label="
              row.enabled ? t('dashboard.publicLinks.pause') : t('dashboard.publicLinks.resume')
            "
            :loading="busyRows.get(row.id) === 'inline'"
            :disabled="busyRows.has(row.id)"
            :data-test="`dashboards-public-links-${row.id}-${row.enabled ? 'pause' : 'resume'}-btn`"
            @click="setPaused(row, row.enabled, 'inline')"
          >
            <OTooltip
              side="bottom"
              :content="
                row.enabled ? t('dashboard.publicLinks.pause') : t('dashboard.publicLinks.resume')
              "
            />
          </OButton>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-vert"
                variant="ghost"
                size="icon-sm"
                :title="t('dashboard.moreActions')"
                :aria-label="t('dashboard.moreActions')"
                :loading="busyRows.get(row.id) === 'menu'"
                :data-test="`dashboards-public-links-${row.id}-menu-btn`"
              />
            </template>
            <ODropdownItem
              icon-left="content-copy"
              class="md:hidden"
              :data-test="`dashboards-public-links-${row.id}-copy-menu`"
              @select="copyLink(row)"
            >
              {{ t("dashboard.publicDashboard.copyLink") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="open-in-new"
              class="md:hidden"
              :data-test="`dashboards-public-links-${row.id}-open-menu`"
              @select="openPublicPage(row)"
            >
              {{ t("dashboard.publicLinks.openPublicPage") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="hasDashboard(row)"
              icon-left="dashboard"
              :data-test="`dashboards-public-links-${row.id}-dashboard-menu`"
              @select="openDashboard(row)"
            >
              {{ t("dashboard.publicLinks.openDashboard") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="hasDashboard(row)"
              icon-left="edit"
              class="md:hidden"
              :data-test="`dashboards-public-links-${row.id}-edit-menu`"
              @select="editLink(row)"
            >
              {{ t("dashboard.publicLinks.editSettings") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="canPause(row)"
              :icon-left="row.enabled ? 'pause' : 'play-arrow'"
              class="md:hidden"
              :disabled="busyRows.has(row.id)"
              :data-test="`dashboards-public-links-${row.id}-${row.enabled ? 'pause' : 'resume'}-menu`"
              @select="setPaused(row, row.enabled, 'menu')"
            >
              {{
                row.enabled ? t("dashboard.publicLinks.pause") : t("dashboard.publicLinks.resume")
              }}
            </ODropdownItem>
            <ODropdownItem
              v-if="canRebuild(row)"
              icon-left="refresh"
              :disabled="busyRows.has(row.id)"
              :data-test="`dashboards-public-links-${row.id}-rebuild-menu`"
              @select="rebuildLink(row)"
            >
              {{ t("dashboard.publicLinks.rebuildNow") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="delete"
              variant="destructive"
              :disabled="busyRows.has(row.id)"
              :data-test="`dashboards-public-links-${row.id}-revoke-menu`"
              @select="revokeLink(row)"
            >
              {{ t("dashboard.publicDashboard.revoke") }}
            </ODropdownItem>
          </ODropdown>
        </div>
      </template>

      <template #empty>
        <OEmptyState
          v-if="loadFailed"
          size="hero"
          preset="load-error"
          data-test="dashboards-public-links-error"
          @action="refreshLinks"
        />
        <OEmptyState
          v-else
          size="hero"
          preset="no-public-links"
          :filtered="filtered"
          data-test="dashboards-public-links-empty"
          @action="onEmptyAction"
        />
      </template>
    </OTable>

    <PublicLinksPanel
      v-if="editing"
      v-model="panelOpen"
      :dashboard-id="editing.dashboard_id"
      :dashboard-title="editing.dashboard_title ?? undefined"
      :edit-link-id="editing.id"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query";
import { useNow } from "@/composables/useNow";
import { copyToClipboard } from "@/utils/clipboard";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { PublicLink, PublicLinkStatus } from "@/services/public_dashboards_admin";
import {
  publicLinksListQuery,
  rebuildPublicLinkMutation,
  revokePublicLinkMutation,
  setPublicLinkPausedMutation,
} from "@/services/public_dashboards.queries";
import PublicLinksPanel from "./PublicLinksPanel.vue";
import {
  canRebuild,
  hasRelativeRange,
  publicLinkColumns,
  publicLinkSearchTerm,
  publicLinkUrl,
  refreshLabel,
} from "./publicLinkDisplay";
import PublicLinkRangesCell from "./PublicLinkRangesCell.vue";
import PublicLinkExpiresCell from "./PublicLinkExpiresCell.vue";

type StatusFilter = "live" | "paused" | "attention" | "expired" | "all";
/** Where a row action was clicked, so the spinner shows on that control. */
type RowActionSource = "inline" | "menu";

const FILTER_STATUSES: Record<Exclude<StatusFilter, "all">, PublicLinkStatus[]> = {
  live: ["live"],
  paused: ["paused"],
  attention: ["needs_attention", "dashboard_deleted"],
  expired: ["expired"],
};

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
const { showErrorNotification, showPositiveNotification } = useNotifications();
const { confirm } = useConfirmDialog();
const orgId = useOrgId();
const now = useNow();

const timezone = computed<string>(
  () => store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
);

const linksQuery = useQuery(() =>
  Object.assign(publicLinksListQuery(orgId.value), { enabled: !!orgId.value }),
);
const links = computed(() => linksQuery.data.value ?? []);
const loading = linksQuery.isPending;
const fetching = linksQuery.isFetching;
const lastUpdatedAt = linksQuery.dataUpdatedAt;
const forbidden = computed(
  () =>
    (linksQuery.error.value as { response?: { status?: number } } | null)?.response?.status === 403,
);
const loadFailed = computed(() => !!linksQuery.error.value && !forbidden.value);
const refreshLinks = () => linksQuery.refetch();

const pauseMutation = useMutation(() => setPublicLinkPausedMutation(orgId.value));
const revokeMutation = useMutation(() => revokePublicLinkMutation(orgId.value));
const rebuildMutation = useMutation(() => rebuildPublicLinkMutation(orgId.value));

const statusFilter = ref<StatusFilter>("all");
const searchQuery = ref("");
const editing = ref<PublicLink | null>(null);
const panelOpen = ref(false);
// Rows with a pause, resume, rebuild or revoke in flight, so a second click can't send it again.
const busyRows = reactive(new Map<string, RowActionSource>());

const countOf = (filter: Exclude<StatusFilter, "all">) =>
  links.value.filter((l) => FILTER_STATUSES[filter].includes(l.status)).length;

const summaryStats = computed<StatItem[]>(() => {
  const attention = countOf("attention");
  return [
    {
      key: "live",
      label: t("components.badge.publicLinkStatus.live"),
      value: countOf("live"),
      icon: "check-circle",
      tone: "success",
      dataTest: "dashboards-public-links-summary-live",
    },
    {
      key: "paused",
      label: t("components.badge.publicLinkStatus.paused"),
      value: countOf("paused"),
      icon: "pause",
      tone: "neutral",
      dataTest: "dashboards-public-links-summary-paused",
    },
    {
      key: "attention",
      label: t("components.badge.publicLinkStatus.needsAttention"),
      value: attention,
      icon: "warning-amber",
      tone: attention > 0 ? "warning" : "neutral",
      dataTest: "dashboards-public-links-summary-attention",
    },
    {
      key: "expired",
      label: t("components.badge.publicLinkStatus.expired"),
      value: countOf("expired"),
      icon: "schedule",
      tone: "neutral",
      dataTest: "dashboards-public-links-summary-expired",
    },
    {
      key: "all",
      label: t("dashboard.publicLinks.summaryAll"),
      value: links.value.length,
      icon: "format-list-bulleted",
      tone: "primary",
      dataTest: "dashboards-public-links-summary-all",
    },
  ];
});

const visibleLinks = computed(() => {
  const q = publicLinkSearchTerm(searchQuery.value);
  const filter = statusFilter.value;
  return links.value.filter((link) => {
    if (filter !== "all" && !FILTER_STATUSES[filter].includes(link.status)) return false;
    if (!q) return true;
    return [link.name, link.slug, link.dashboard_title, link.folder_name, link.published_by].some(
      (v) => (v ?? "").toLowerCase().includes(q),
    );
  });
});

const filtered = computed(
  () => links.value.length > 0 && (!!searchQuery.value.trim() || statusFilter.value !== "all"),
);

const columns = publicLinkColumns(t, { withDashboard: true });

function hasDashboard(link: PublicLink): boolean {
  return link.status !== "dashboard_deleted";
}

function canPause(link: PublicLink): boolean {
  return link.status !== "expired" && link.status !== "dashboard_deleted";
}

function serverMessage(e: unknown): I18nText {
  return raw((e as { response?: { data?: { message?: string } } })?.response?.data?.message);
}

// The list refetch the mutation started must land first, or the row still offers the action it just ran.
async function runRowAction(
  link: PublicLink,
  source: RowActionSource,
  run: () => Promise<void>,
  failed: I18nText = t("dashboard.publicLinks.actionFailed"),
) {
  if (busyRows.has(link.id)) return;
  busyRows.set(link.id, source);
  try {
    await run();
    await linksQuery.refetch({ cancelRefetch: false });
  } catch (e: unknown) {
    showErrorNotification(serverMessage(e) || failed);
  } finally {
    busyRows.delete(link.id);
  }
}

function onStatSelect(key: string) {
  statusFilter.value = key as StatusFilter;
}

function onEmptyAction(id?: string) {
  if (id !== "clear-filters") return;
  searchQuery.value = "";
  statusFilter.value = "all";
}

function copyLink(link: PublicLink) {
  copyToClipboard(publicLinkUrl(link), t, {
    successMessage: t("dashboard.publicDashboard.linkCopied"),
  });
}

function openPublicPage(link: PublicLink) {
  window.open(publicLinkUrl(link), "_blank", "noopener");
}

function openDashboard(link: PublicLink) {
  router.push({
    path: "/dashboards/view",
    query: {
      org_identifier: orgId.value,
      dashboard: link.dashboard_id,
      folder: link.folder_id ?? "default",
    },
  });
}

function editLink(link: PublicLink) {
  editing.value = link;
  panelOpen.value = true;
}

function setPaused(link: PublicLink, paused: boolean, source: RowActionSource) {
  return runRowAction(link, source, async () => {
    await pauseMutation.mutateAsync({ link, paused });
    showPositiveNotification(
      paused ? t("dashboard.publicLinks.pausedToast") : t("dashboard.publicLinks.resumedToast"),
    );
  });
}

function rebuildLink(link: PublicLink) {
  return runRowAction(link, "menu", async () => {
    await rebuildMutation.mutateAsync(link);
    showPositiveNotification(t("dashboard.publicLinks.rebuiltToast"));
  });
}

async function revokeLink(link: PublicLink) {
  const ok = await confirm({
    title: t("dashboard.publicLinks.revokeTitle", {
      name: link.name ? raw(link.name) : t("dashboard.publicLinks.untitled"),
    }),
    message: t("dashboard.publicLinks.revokeMessage"),
    confirmLabel: t("dashboard.publicDashboard.revoke"),
    cancelLabel: t("common.cancel"),
    destructive: true,
  });
  if (!ok) return;
  await runRowAction(
    link,
    "menu",
    async () => {
      await revokeMutation.mutateAsync(link);
      showPositiveNotification(t("dashboard.publicDashboard.revokedToast"));
    },
    t("dashboard.publicDashboard.revokeFailed"),
  );
}
</script>
