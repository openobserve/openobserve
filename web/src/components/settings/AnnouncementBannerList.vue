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
  <OPageLayout
    :title="t('announcements.settings.label')"
    icon="campaign"
    :subtitle="t('announcements.list.subtitle')"
    bleed
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        data-test="announcement-list-add-btn"
        @click="openEditor()"
        >{{ t("announcements.settings.addBanner") }}</OButton
      >
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <!-- What every user sees right now, painted by the same bar the app uses. -->
      <div
        class="border-border-default flex shrink-0 flex-col gap-2 border-b px-4 py-3"
        data-test="announcement-list-live"
      >
        <span class="text-text-label text-xs font-medium">
          {{ t("announcements.list.liveNow") }}
        </span>
        <div
          v-if="liveBanners.length"
          class="rounded-default border-border-default overflow-hidden border"
        >
          <AnnouncementBar
            v-for="banner in liveBanners"
            :key="banner.index"
            :message="banner.draft.message"
            :variant="banner.draft.variant"
            :text-size="banner.draft.textSize"
            :colors="{ light: banner.draft.colorLight, dark: banner.draft.colorDark }"
            :mode="isDark ? 'dark' : 'light'"
            :inert-actions="{
              ctaText: banner.draft.hasCta ? banner.draft.ctaText : '',
              dismissible: banner.draft.dismissible,
            }"
          />
        </div>
        <span v-else class="text-text-secondary text-sm" data-test="announcement-list-live-empty">
          {{ t("announcements.list.liveNowEmpty") }}
        </span>
      </div>

      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <OTable
          :frame="false"
          data-test="announcement-list-table"
          :data="rows"
          :columns="columns"
          row-key="index"
          pagination="none"
          sorting="none"
          :default-columns="false"
          :show-global-filter="false"
          :column-visibility="isMobile ? PHONE_HIDDEN_COLUMNS : undefined"
          :loading="configQuery.isLoading.value"
          @row-click="(row) => openEditor({ index: String(row.index) })"
        >
          <template #empty>
            <OEmptyState
              v-if="!configQuery.isLoading.value"
              size="hero"
              icon="campaign"
              :title="t('announcements.settings.emptyTitle')"
              :description="t('announcements.settings.emptyHint')"
              :action-label="t('announcements.settings.addBanner')"
              data-test="announcement-list-empty"
              @action="openEditor()"
            />
          </template>
          <template #cell-message="{ row }">
            <span class="text-text-heading block truncate text-sm" :title="row.text">
              {{ row.text }}
            </span>
          </template>
          <template #cell-severity="{ row }">
            <OBadge :variant="SEVERITY_BADGE[row.draft.variant]" size="sm">
              {{ t(`announcements.variants.${row.draft.variant}`) }}
            </OBadge>
          </template>
          <template #cell-status="{ row }">
            <OBadge
              :variant="STATUS_BADGE[row.status]"
              size="sm"
              :title="row.statusHint"
              :data-test="`announcement-list-status-${row.index}`"
            >
              {{ row.statusLabel }}
            </OBadge>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-center gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :title="t('announcements.card.edit')"
                :aria-label="t('announcements.card.edit')"
                :data-test="`announcement-list-edit-${row.index}`"
                @click.stop="openEditor({ index: String(row.index) })"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="content-copy"
                :title="t('announcements.list.duplicate')"
                :aria-label="t('announcements.list.duplicate')"
                :data-test="`announcement-list-duplicate-${row.index}`"
                @click.stop="openEditor({ duplicate: String(row.index) })"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :title="t('announcements.card.remove')"
                :aria-label="t('announcements.card.remove')"
                :data-test="`announcement-list-delete-${row.index}`"
                @click.stop="confirmDelete(row.index)"
              />
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <ConfirmDialog
      v-model="deleteOpen"
      :title="t('announcements.list.deleteTitle')"
      :message="deleteMessage"
      :ok-label="t('announcements.list.deleteConfirm')"
      ok-color="destructive"
      @update:ok="removeBanner"
      @update:cancel="deleteOpen = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import AnnouncementBar from "@/components/announcements/AnnouncementBar.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import { useTheme } from "@/composables/useTheme";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  announcementConfigQuery,
  saveAnnouncementConfigMutation,
} from "@/services/announcements.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { BannerVariantName } from "@/utils/announcementOrder";
import { orderBanners } from "@/utils/announcementOrder";
import { bannerMessageText } from "@/utils/announcementMarkdown";
import {
  bannerStatus,
  draftFromAuthored,
  type AuthoredBanner,
  type BannerDraft,
  type BannerStatus,
} from "./announcementDrafts";
import { audienceSummary, relativeTo, scheduleSummary } from "./announcementSummaries";

/** `hidden`: live, but a promo the bar suppresses while a critical banner is up. */
type RowStatus = BannerStatus | "hidden";

interface BannerRow {
  index: number;
  draft: BannerDraft;
  authored: Record<string, unknown>;
  text: string;
  status: RowStatus;
  statusLabel: string;
  statusHint?: string;
  schedule: string;
  audience: string;
}

const SEVERITY_BADGE: Record<BannerVariantName, BadgeVariant> = {
  critical: "error-soft",
  warning: "warning-soft",
  info: "primary-soft",
  promo: "default-soft",
};

const STATUS_BADGE: Record<RowStatus, BadgeVariant> = {
  live: "success-soft",
  hidden: "warning-soft",
  scheduled: "primary-soft",
  ended: "default-soft",
};

const PHONE_HIDDEN_COLUMNS = { severity: false, schedule: false, audience: false };

const MESSAGE_QUOTE_LENGTH = 60;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { isDark } = useTheme();
const { isMobile } = useBreakpoint();
const queryClient = useQueryClient();

const metaOrg = computed<string>(() => store.state.zoConfig?.meta_org ?? "");

const configQuery = useQuery(() =>
  Object.assign(announcementConfigQuery(metaOrg.value), { enabled: !!metaOrg.value }),
);
const saveConfig = useMutation(() => saveAnnouncementConfigMutation(metaOrg.value));
const { notifyConfigChanged } = useAnnouncementDraftPreview();

// The dialog closes itself before it emits `ok`, so the target must outlive the open flag.
const deleteOpen = ref(false);
const pendingDelete = ref<number | null>(null);

const confirmDelete = (index: number) => {
  pendingDelete.value = index;
  deleteOpen.value = true;
};

const rows = computed<BannerRow[]>(() => {
  const drafts = (configQuery.data.value?.banners ?? []).map((banner) =>
    draftFromAuthored(banner as AuthoredBanner),
  );
  const criticalLive = drafts.some((d) => d.variant === "critical" && bannerStatus(d) === "live");

  return drafts.map((draft, index) => {
    const base = bannerStatus(draft);
    const status: RowStatus =
      base === "live" && criticalLive && draft.variant === "promo" ? "hidden" : base;
    const endsSoon = base === "live" && draft.schedule === "window" && draft.endsAt;
    return {
      index,
      draft,
      authored: configQuery.data.value!.banners[index],
      text: bannerMessageText(draft.message),
      status,
      statusLabel:
        status === "hidden"
          ? t("announcements.list.status.hidden")
          : endsSoon
            ? t("announcements.list.status.liveEnds", { when: relativeTo(draft.endsAt) })
            : t(`announcements.list.status.${base}`),
      statusHint: status === "hidden" ? t("announcements.list.hiddenHint") : undefined,
      schedule: scheduleSummary(draft, t),
      audience: audienceSummary(draft, t),
    };
  });
});

// Same resolver as the live bar, so this strip stacks banners exactly as users get them.
const liveBanners = computed(() =>
  orderBanners(
    rows.value
      .filter((row) => row.status === "live")
      .map((row) => ({ ...row, variant: row.draft.variant })),
  ),
);

const columns = computed<OTableColumnDef<BannerRow>[]>(() => [
  {
    id: "message",
    header: t("announcements.form.message"),
    accessorKey: "text",
    size: 360,
    minSize: 200,
    meta: { align: "left", flex: true },
  },
  { id: "severity", header: t("announcements.form.severity"), size: 120 },
  { id: "status", header: t("announcements.list.statusHeader"), size: 120 },
  {
    id: "schedule",
    header: t("announcements.form.schedule"),
    accessorKey: "schedule",
    size: 240,
  },
  { id: "audience", header: t("announcements.form.orgs"), accessorKey: "audience", size: 170 },
  {
    id: "actions",
    header: t("announcements.list.actions"),
    isAction: true,
    pinned: "right",
    meta: { align: "center", actionCount: 3 },
  },
]);

const openEditor = (query: Record<string, string> = {}) => {
  void router.push({
    name: "announcementBannerEditor",
    query: { org_identifier: store.state.selectedOrganization?.identifier, ...query },
  });
};

const deleteMessage = computed(() => {
  const row = rows.value.find((r) => r.index === pendingDelete.value);
  const text = row?.text ?? "";
  const quote =
    text.length > MESSAGE_QUOTE_LENGTH ? `${text.slice(0, MESSAGE_QUOTE_LENGTH).trimEnd()}…` : text;
  return t("announcements.list.deleteMessage", { message: quote });
});

const removeBanner = async () => {
  const index = pendingDelete.value;
  pendingDelete.value = null;
  if (index === null) return;
  const expected = rows.value.find((row) => row.index === index)?.authored;

  try {
    // Re-read and confirm the target, so a change saved elsewhere meanwhile is neither lost nor misaimed.
    const latest = await queryClient.fetchQuery({
      ...announcementConfigQuery(metaOrg.value),
      staleTime: 0,
    });
    if (JSON.stringify(latest.banners[index]) !== JSON.stringify(expected)) {
      toast({ variant: "error", message: t("announcements.editor.conflict") });
      return;
    }

    const banners = latest.banners.filter((_, i) => i !== index);
    await saveConfig.mutateAsync({ banners });
    notifyConfigChanged();
    toast({ variant: "success", message: t("announcements.list.deleted") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("announcements.settings.saveFailed"),
    });
  }
};
</script>
