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
    :open="open"
    size="xl"
    :title="t('alert_library.review.title', { pack: packName })"
    :sub-title="t('alert_library.review.subtitle', { limit: NOISY_FIRE_LIMIT })"
    :primary-button-label="t('alert_library.review.enable', { count: enableCount })"
    :primary-button-disabled="loading || enableCount === 0"
    :primary-button-loading="enabling"
    primary-button-data-test="alert-library-review-enable"
    :secondary-button-label="t('common.cancel')"
    title-data-test="alert-library-review-title"
    data-test="alert-library-review-drawer"
    @update:open="emit('update:open', $event)"
    @click:primary="onEnable"
    @click:secondary="emit('update:open', false)"
  >
    <OTable
      v-model:selected-ids="selectedIds"
      :data="rows"
      :columns="columns"
      row-key="id"
      selection="multiple"
      :is-row-selectable="isSelectable"
      pagination="none"
      :show-global-filter="false"
      :fill-height="false"
      data-test="alert-library-review-table"
    >
      <template #cell-title="{ row }">
        <div class="flex min-w-0 items-center gap-2">
          <OTruncatedText class="text-text-heading min-w-0">{{ row.entry.title }}</OTruncatedText>
          <OTag
            type="severity"
            :value="severityBadgeValue(row.entry.severity)"
            :label="severityLabel(t, row.entry.severity)"
            class="shrink-0"
          />
        </div>
      </template>
      <template #cell-status="{ row }">
        <span :data-test="`alert-library-review-status-${row.id}`">{{ statusText(row) }}</span>
      </template>
      <template #cell-estimate="{ row }">
        <span :data-test="`alert-library-review-estimate-${row.id}`">{{ estimateText(row) }}</span>
      </template>
    </OTable>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  isSelectable,
  useLibraryReview,
  type ReviewRow,
} from "@/composables/alerts/useLibraryReview";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { packLabel, severityBadgeValue, severityLabel } from "./libraryFacets";
import { NOISY_FIRE_LIMIT } from "./libraryQuickAdd";

const props = defineProps<{
  open: boolean;
  /** The pack under review; its label names the folder the rules land in. */
  pack: string | null;
  /** The pack's runnable rules, in the order to list them. */
  entries: AlertLibraryEntry[];
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  added: [entryId: string];
}>();

const { t } = useI18nTyped();
const { rows, selectedIds, loading, enabling, load, enable } = useLibraryReview({
  onAdded: (entryId) => emit("added", entryId),
});

const packName = computed(() => packLabel(props.pack ?? ""));
const enableCount = computed(() => selectedIds.value.length);

const columns = computed<OTableColumnDef<ReviewRow>[]>(() => [
  { id: "title", header: t("alert_library.review.columnAlert"), size: 280, meta: { isName: true } },
  {
    id: "requires",
    header: t("alert_library.review.columnNeeds"),
    accessorKey: "requires",
    size: 220,
  },
  { id: "status", header: t("alert_library.review.columnData"), size: 200 },
  {
    id: "threshold",
    header: t("alert_library.review.columnCondition"),
    accessorKey: "threshold",
    size: 110,
  },
  { id: "estimate", header: t("alert_library.review.columnYesterday"), size: 220 },
]);

const statusText = (row: ReviewRow): I18nText => {
  if (row.result === "added") return t("alert_library.review.added");
  if (row.result === "paused") return t("alert_library.review.addedPaused");
  if (row.result === "failed") {
    return raw(row.error) || t("alert_library.review.addFailed");
  }
  if (row.state === "loading") return t("alert_library.review.checking");
  if (row.state === "failed") return t("alert_library.review.loadFailed");
  if (row.state === "unknown") return t("alert_library.review.checkFailed");
  if (row.state === "needsData") {
    return t("alert_library.review.needsData", { labels: row.needsData });
  }
  return t("alert_library.review.dataArrives");
};

const estimateText = (row: ReviewRow): I18nText => {
  if (row.anomaly) return t("alert_library.review.learnsRange");
  if (row.fires === undefined) return raw("");
  if (row.fires === null) return t("alert_library.review.notEstimated");
  return t("alert_library.review.wouldHaveFired", { count: row.fires }, row.fires);
};

const summary = (done: ReviewRow[]): { message: I18nText; failed: number } => {
  const added = done.filter((row) => row.result === "added" || row.result === "paused").length;
  const paused = done.filter((row) => row.result === "paused").length;
  const failed = done.filter((row) => row.result === "failed").length;
  const parts: string[] = [
    String(t("alert_library.review.enabled", { count: added, folder: packName.value }, added)),
  ];
  if (paused > 0) {
    parts.push(
      String(t("alert_library.review.enabledPaused", { count: paused, limit: NOISY_FIRE_LIMIT })),
    );
  }
  if (failed > 0) {
    parts.push(String(t("alert_library.review.enabledFailed", { count: failed }, failed)));
  }
  return { message: raw(parts.join(" ")), failed };
};

const onEnable = async () => {
  const done = await enable();
  if (done.length === 0) return;
  const { message, failed } = summary(done);
  toast({ variant: failed > 0 ? "warning" : "success", message });
};

watch(
  () => [props.open, props.pack] as const,
  ([open]) => {
    if (open) void load(props.entries);
  },
  { immediate: true },
);
</script>
