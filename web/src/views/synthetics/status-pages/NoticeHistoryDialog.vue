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

<!-- Read-only history of notices posted against a page, with a remove
     action per row. Answers "did my update actually post" and gives the
     one place to take an update back down. -->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('statusPages.notices.title', { name: pageName })"
    :secondary-button-label="t('common.close')"
    data-test="status-page-notice-history-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <div v-if="loading" class="flex justify-center py-8">
        <OSpinner />
      </div>
      <p v-else-if="notices.length === 0" class="text-text-secondary py-8 text-center text-sm">
        {{ t("statusPages.notices.empty") }}
      </p>
      <div
        v-for="notice in notices"
        v-else
        :key="notice.id"
        class="border-border-subtle rounded-default flex flex-col gap-2 border p-3"
        :data-test="`status-page-notice-row-${notice.id}`"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <OBadge :variant="impactBadge(notice.impact).variant" size="sm">
              {{ t(impactBadge(notice.impact).labelKey) }}
            </OBadge>
            <OBadge :variant="noticeStateBadge(notice.state).variant" size="sm">
              {{ t(noticeStateBadge(notice.state).labelKey) }}
            </OBadge>
            <OTimeCell
              :value="notice.starts_at"
              unit="us"
              mode="relative"
              class="text-text-secondary text-xs"
            />
          </div>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="delete"
            :data-test="`status-page-notice-delete-${notice.id}`"
            @click="confirmDelete(notice)"
          >
            <OTooltip side="bottom" :content="t('common.delete')" />
          </OButton>
        </div>
        <p class="text-sm font-medium">{{ raw(notice.title) }}</p>
        <p class="text-text-secondary text-sm whitespace-pre-wrap">{{ raw(notice.body) }}</p>

        <div
          v-if="updatesByNotice[notice.id]?.length"
          class="border-border-subtle mt-1 flex flex-col gap-2 border-t pt-2"
        >
          <div
            v-for="update in updatesByNotice[notice.id]"
            :key="update.id"
            class="flex flex-col gap-0.5"
            :data-test="`status-page-notice-update-${update.id}`"
          >
            <p class="text-text-secondary text-sm whitespace-pre-wrap">{{ raw(update.body) }}</p>
            <OTimeCell
              :value="update.created_at"
              unit="us"
              mode="relative"
              class="text-text-secondary text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import statusPagesService, {
  type StatusPageNotice,
  type StatusPageNoticeUpdate,
} from "@/services/status_pages";
import { impactBadge, noticeStateBadge } from "./statusPageBadges";

const props = defineProps<{
  open: boolean;
  orgIdentifier: string;
  pageId: string;
  pageName: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  deleted: [];
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const notices = ref<StatusPageNotice[]>([]);
const updatesByNotice = ref<Record<string, StatusPageNoticeUpdate[]>>({});
const loading = ref(false);

async function load() {
  if (!props.pageId) return;
  loading.value = true;
  try {
    const res = await statusPagesService.listNotices(props.orgIdentifier, props.pageId);
    notices.value = (res.data as StatusPageNotice[]) ?? [];
    // Best-effort per-notice fetch: a small admin-only list, not the hot
    // public path, so N+1 here is the right trade against a wider endpoint.
    const entries = await Promise.all(
      notices.value.map(async (n) => {
        try {
          const ures = await statusPagesService.listNoticeUpdates(props.orgIdentifier, n.id);
          return [n.id, (ures.data as StatusPageNoticeUpdate[]) ?? []] as const;
        } catch (err) {
          console.error(`[status-pages] failed to load updates for notice ${n.id}`, err);
          return [n.id, []] as const;
        }
      }),
    );
    updatesByNotice.value = Object.fromEntries(entries);
  } catch (err) {
    toast({ variant: "error", message: t("statusPages.notices.loadFailed") });
    console.error("[status-pages] failed to load notices", err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) load();
  },
  { immediate: true },
);

async function confirmDelete(notice: StatusPageNotice) {
  const ok = await confirm({
    title: t("statusPages.notices.deleteTitle"),
    message: t("statusPages.notices.deleteBody", { title: notice.title }),
  });
  if (!ok) return;
  const dismiss = toast({
    variant: "loading",
    message: t("statusPages.notices.deleting"),
    timeout: 0,
  });
  try {
    await statusPagesService.deleteNotice(props.orgIdentifier, notice.id);
    notices.value = notices.value.filter((n) => n.id !== notice.id);
    dismiss();
    toast({ variant: "success", message: t("statusPages.notices.deleted") });
    emit("deleted");
  } catch (err: any) {
    dismiss();
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("statusPages.notices.deleteFailed"),
    });
    console.error("[status-pages] delete notice failed", err);
  }
}
</script>
