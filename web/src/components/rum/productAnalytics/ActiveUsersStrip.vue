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
  <section class="flex flex-col gap-1.5" data-test="rum-analytics-active-users">
    <div class="flex flex-wrap items-baseline gap-x-2">
      <span class="text-text-heading text-sm font-semibold">{{
        field === "usr_anonymous_id"
          ? t("rum.analytics.activeUsers.titleVisitors")
          : t("rum.analytics.activeUsers.title")
      }}</span>
      <span class="text-text-secondary text-xs" data-test="rum-analytics-active-users-subtitle">{{
        t("rum.analytics.activeUsers.subtitle", { unit: unit.label, field: raw(field) })
      }}</span>
    </div>
    <AnalyticsPanelState
      :state="state"
      data-test="rum-analytics-active-users-panel"
      :skeleton-rows="1"
      @retry="emit('retry')"
    >
      <OStatStrip :items="items" />
    </AnalyticsPanelState>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import type { IdentityField } from "@/utils/rum/productAnalyticsQueries";
import type { IdentityLabels } from "@/utils/rum/productAnalyticsModel";

const props = defineProps<{
  state: PanelState<{ dau: number; wau: number; mau: number }>;
  field: IdentityField;
  unit: IdentityLabels;
}>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();

const items = computed<StatItem[]>(() => {
  const row = props.state.rows[0];
  const value = (v: number | undefined) => addCommasToNumber(Number(v ?? 0));
  return [
    {
      key: "dau",
      label: t("rum.analytics.activeUsers.dau"),
      value: value(row?.dau),
      tone: "neutral",
      dataTest: "rum-analytics-active-users-dau",
    },
    {
      key: "wau",
      label: t("rum.analytics.activeUsers.wau"),
      value: value(row?.wau),
      tone: "neutral",
      dataTest: "rum-analytics-active-users-wau",
    },
    {
      key: "mau",
      label: t("rum.analytics.activeUsers.mau"),
      value: value(row?.mau),
      sub: t("rum.analytics.activeUsers.mauNote"),
      tone: "neutral",
      dataTest: "rum-analytics-active-users-mau",
    },
  ];
});
</script>
