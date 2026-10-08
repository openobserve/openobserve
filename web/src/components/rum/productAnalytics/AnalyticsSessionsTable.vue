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
  <div class="flex flex-col gap-2" :data-test="dataTestPrefix">
    <span class="text-text-secondary text-xs" :data-test="`${dataTestPrefix}-cap`">{{
      total <= PAGE_LIMIT
        ? t("rum.analytics.sessions.allListed", { count: formatCount(total, sampled) }, total)
        : t("rum.analytics.sessions.firstListed", {
            shown: rows.length,
            count: formatCount(total, sampled),
          })
    }}</span>
    <OTable
      :data="rows"
      :columns="columns"
      :default-columns="false"
      row-key="sid"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :frame="false"
      @row-click="(row: SessionRow) => emit('open', row)"
    >
      <template #cell-replay="{ row, index }">
        <OTag
          :label="
            Number(row.has_replay) === 1
              ? t('rum.analytics.sessions.replay')
              : t('rum.analytics.sessions.noReplay')
          "
          :variant="Number(row.has_replay) === 1 ? 'primary-soft' : 'default-outline'"
          :icon="Number(row.has_replay) === 1 ? 'play-circle' : ''"
          size="xs"
          :data-test="`${dataTestPrefix}-row-${index}-replay`"
        />
      </template>
      <template #cell-user="{ row, index }">
        <span class="flex min-w-0 flex-col" :data-test="`${dataTestPrefix}-row-${index}`">
          <span class="text-text-body truncate">{{
            row.user_label || t("rum.analytics.sessions.unknownUser")
          }}</span>
          <span class="text-text-secondary text-xs">{{
            stepIndex
              ? t("rum.analytics.sessions.reachedStep", {
                  started: fmt(row.started),
                  step: stepIndex,
                  at: fmtTime(row.step_t),
                })
              : t("rum.analytics.sessions.reachedLabel", {
                  started: fmt(row.started),
                  label: raw(stepLabel),
                  at: fmtTime(row.step_t),
                })
          }}</span>
        </span>
      </template>
      <template #cell-health="{ row }">
        <span class="flex flex-wrap items-center gap-1">
          <OTag
            v-if="Number(row.errors) > 0"
            :label="t('rum.analytics.sessions.errors', { count: row.errors }, Number(row.errors))"
            variant="error-soft"
            size="xs"
          />
          <OTag
            v-if="Number(row.frustrations) > 0"
            :label="
              t(
                'rum.analytics.sessions.frustrations',
                { count: row.frustrations },
                Number(row.frustrations),
              )
            "
            variant="warning-soft"
            icon="sentiment-very-dissatisfied"
            size="xs"
          />
          <span
            v-if="!Number(row.errors) && !Number(row.frustrations)"
            class="text-text-secondary"
            >{{ dash }}</span
          >
        </span>
      </template>
      <template #cell-duration="{ row }">
        <span class="tabular-nums">{{
          durationFormatter(
            Math.round((Number(row.ended) - Number(row.started)) / 1000),
          )
        }}</span>
      </template>
      <template #cell-open="{ index }">
        <OIcon
          name="chevron-right"
          size="sm"
          class="text-text-secondary"
          :data-test="`${dataTestPrefix}-row-${index}-open`"
        />
      </template>
    </OTable>
    <span
      v-if="loadMoreFailed"
      role="alert"
      class="text-status-error-text text-xs"
      :data-test="`${dataTestPrefix}-load-more-error`"
      >{{ t("rum.analytics.sessions.loadMoreFailed") }}</span
    >
    <OButton
      v-if="total > PAGE_LIMIT && rows.length < total"
      variant="outline"
      size="sm"
      :loading="loadingMore"
      :data-test="`${dataTestPrefix}-load-more-btn`"
      @click="emit('load-more')"
      >{{ t("rum.analytics.sessions.loadMore") }}</OButton
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { durationFormatter } from "@/utils/formatters";
import { formatCount } from "@/utils/rum/productAnalyticsModel";
import { PAGE_LIMIT, type SampleRatio } from "@/utils/rum/productAnalyticsQueries";

export interface SessionRow {
  sid: string;
  step_t: number;
  errors: number;
  frustrations: number;
  has_replay: number;
  started: number;
  ended: number;
  user_label?: string | null;
  total: number;
}

withDefaults(
  defineProps<{
    rows: SessionRow[];
    total: number;
    stepLabel: string;
    stepIndex: number | null;
    loadingMore: boolean;
    dataTestPrefix: string;
    sampled?: SampleRatio;
    loadMoreFailed?: boolean;
  }>(),
  { sampled: 1, loadMoreFailed: false },
);
const emit = defineEmits<{ open: [SessionRow]; "load-more": [] }>();
const { t } = useI18nTyped();
const store = useStore();
const dash = raw("—");

const tz = () => store.state.timezone || "UTC";
const fmt = (ms: number) =>
  ms ? formatInTimeZone(new Date(Number(ms)), tz(), "MMM d, HH:mm") : "";
const fmtTime = (ms: number) =>
  ms ? formatInTimeZone(new Date(Number(ms)), tz(), "HH:mm:ss") : "";

const columns = computed<OTableColumnDef<SessionRow>[]>(() => [
  { id: "replay", header: raw(""), size: 84 },
  {
    id: "user",
    header: t("rum.analytics.sessions.userAndSession"),
    size: 230,
    meta: { fillRemaining: true },
  },
  { id: "health", header: t("rum.analytics.sessions.health"), size: 96 },
  {
    id: "duration",
    header: t("rum.analytics.sessions.activeDuration"),
    size: 110,
    meta: { align: "right", headerTooltip: t("rum.analytics.sessions.activeDurationTooltip") },
  },
  { id: "open", header: raw(""), size: 36, meta: { align: "right" } },
]);
</script>
