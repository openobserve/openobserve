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
  <div class="flex flex-col gap-2" data-test="alert-calibration-dismissed">
    <div v-if="!settled" class="flex flex-col gap-2">
      <OSkeleton class="rounded-surface h-10 w-full" />
      <OSkeleton class="rounded-surface h-32 w-full" />
    </div>

    <LiveNoticeState
      v-else-if="unknown"
      size="block"
      :notice="readNotice(t, query.error.value, t('alertCalibration.dismiss.loadFailedTitle'))"
      :detail="readFailedDetail(query.error.value)"
      data-test="alert-calibration-dismissed-error"
      retry-test="alert-calibration-dismissed-retry"
      @retry="query.refetch()"
    />

    <OEmptyState
      v-else-if="!rows.length"
      size="block"
      illustration="history"
      :title="t('alertCalibration.dismiss.emptyTitle')"
      :description="t('alertCalibration.dismiss.emptyDescription')"
      hide-action
      data-test="alert-calibration-dismissed-empty"
    />

    <template v-else>
      <OText v-if="capped" variant="meta" as="p" data-test="alert-calibration-dismissed-capped">
        <!-- OText's meta colour wins over a class on it, so the amber sits on the text. -->
        <span class="text-status-warning-text">{{ copy.capped(rows.length, total) }}</span>
      </OText>
      <OTable
        :data="rows"
        :columns="columns"
        row-key="id"
        sorting="none"
        :page-size="PAGE_SIZE"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :show-global-filter="false"
        :fill-height="false"
        :frame="false"
        data-test="alert-calibration-dismissed-table"
      >
        <template #cell-alert="{ row }">
          <OTruncatedText
            :class="row.alert_name ? '' : 'text-text-secondary'"
            data-test="alert-calibration-dismissed-alert"
          >
            {{ copy.alertName(row) }}
          </OTruncatedText>
        </template>
        <template #cell-note="{ row }">
          <OTruncatedText v-if="row.note">{{ row.note }}</OTruncatedText>
          <span
            v-else-if="row.has_note"
            class="text-text-secondary inline-flex items-center gap-1"
            data-test="alert-calibration-dismissed-note-hidden"
          >
            {{ t("alertCalibration.dismiss.noteHidden") }}
            <OIcon name="info-outline" size="xs" />
            <OTooltip :content="t('alertCalibration.dismiss.noteHiddenHelp')" />
          </span>
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #cell-reopen="{ row }">
          <OButton
            variant="outline"
            size="xs"
            :loading="isPending(row.id)"
            data-test="alert-calibration-dismissed-reopen"
            @click="reopen(row)"
          >
            {{ t("alertCalibration.dismiss.reopen") }}
          </OButton>
        </template>
      </OTable>
    </template>

    <OText variant="meta" as="p">{{ t("alertCalibration.dismiss.endedNote") }}</OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import LiveNoticeState from "@/components/autoobserve/live/LiveNoticeState.vue";
import { readFailedDetail, readNotice } from "./notices";
import {
  useActiveDismissals,
  useReopenDismissal,
} from "@/composables/alertCalibration/useDismissals";
import { dismissalCopy, type DismissalView } from "./dismissals";

const PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const { t, locale } = useI18nTyped();
const copy = computed(() => dismissalCopy(t, locale.value));
const { query, settled, unknown } = useActiveDismissals();
const { reopen, isPending } = useReopenDismissal();

const rows = computed(() => query.data.value?.items ?? []);
const total = computed(() => query.data.value?.total ?? 0);
/** The client stops paging at its cap, so fewer rows than the server counted are shown. */
const capped = computed(() => rows.value.length < total.value);

const columns = computed<OTableColumnDef<DismissalView>[]>(() => [
  {
    id: "alert",
    header: t("alertCalibration.dismiss.col.alert"),
    accessorFn: (v) => copy.value.alertName(v),
    meta: { isName: true },
    size: COL.name,
  },
  {
    id: "finding",
    header: t("alertCalibration.dismiss.col.finding"),
    accessorFn: (v) => copy.value.findingLabel(v.rule_id, v.pattern),
    size: COL.type,
  },
  {
    id: "reason",
    header: t("alertCalibration.dismiss.col.reason"),
    accessorFn: (v) => copy.value.reasonLabel(v.reason),
    size: 230,
  },
  {
    id: "note",
    header: t("alertCalibration.dismiss.col.note"),
    accessorKey: "note",
    autoWidth: true,
  },
  {
    id: "by",
    header: t("alertCalibration.dismiss.col.by"),
    accessorFn: (v) => copy.value.byAgo(v),
    size: 260,
  },
  {
    id: "until",
    header: t("alertCalibration.dismiss.col.until"),
    accessorFn: (v) => copy.value.until(v),
    size: COL.dateAbsolute,
  },
  { id: "reopen", header: raw(""), size: 110, hideable: false, meta: { align: "right" } },
]);
</script>
