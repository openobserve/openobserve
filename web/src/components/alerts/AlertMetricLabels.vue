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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import { labelsOf } from "@/utils/metrics/metricFamily";
import { formatNumber } from "@/utils/alerts/alertCopy";
import {
  DAY_US,
  cachedValueCounts,
  loadValueCounts,
  type ValueCountContext,
} from "@/composables/alerts/useStreamDiscovery";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";

const props = defineProps<{ streamName: string }>();
const emit = defineEmits<{
  /** A label to group by, or with a value, a matcher to add to the query. */
  (e: "insert", payload: { label: string; value?: string }): void;
}>();

// Chips shown before the rest fold behind "N more"; most varied labels first.
const VISIBLE_LABELS = 10;

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const distinct = useAlertStreamQuery();
const labels = ref<string[]>([]);
const state = ref<"loading" | "ready" | "failed">("loading");
const showAll = ref(false);

const context = computed<ValueCountContext>(() => ({
  org: store.state.selectedOrganization?.identifier ?? "",
  streamType: "metrics",
  streamName: props.streamName,
}));

const entryOf = (label: string) => cachedValueCounts(context.value, label);

// One search counts every label's values, so the chips can rank and size themselves without a lookup each.
const cardinality = computed<Record<string, number>>(() => {
  const row = distinct.hits.value[0] ?? {};
  return Object.fromEntries(
    labels.value.map((label) => [label, Number(row[label])]).filter(([, n]) => Number.isFinite(n)),
  );
});

const ranked = computed(() =>
  [...labels.value].sort(
    (a, b) => (cardinality.value[b] ?? -1) - (cardinality.value[a] ?? -1) || a.localeCompare(b),
  ),
);
const shown = computed(() =>
  showAll.value ? ranked.value : ranked.value.slice(0, VISIBLE_LABELS),
);
const hiddenCount = computed(() => ranked.value.length - VISIBLE_LABELS);
// Chips wait for the counts, so they appear once in their final order.
const settled = computed(() => ["ready", "failed"].includes(distinct.state.value));

const chipText = (label: string): I18nText => {
  const count = cardinality.value[label];
  if (count === undefined) return raw(label);
  return t("alerts.discovery.labelChip", { label: raw(label), count: formatNumber(count) }, count);
};

const load = (label: string) => {
  if (props.streamName) void loadValueCounts(context.value, label);
};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

watch(
  () => props.streamName,
  async (name) => {
    labels.value = [];
    showAll.value = false;
    state.value = "loading";
    distinct.cancel();
    if (!name) return;
    try {
      const stream = await getStream(name, "metrics", true);
      if (name !== props.streamName) return;
      labels.value = labelsOf(stream ?? {}) ?? [];
      state.value = "ready";
    } catch {
      if (name === props.streamName) state.value = "failed";
      return;
    }
    if (!labels.value.length) return;
    const now = Date.now() * 1000;
    distinct.run({
      sql: `SELECT ${labels.value.map((l) => `approx_distinct(${quote(l)}) AS ${quote(l)}`).join(", ")} FROM ${quote(name)}`,
      streamType: "metrics",
      startTime: now - DAY_US,
      endTime: now,
      size: 1,
    });
  },
  { immediate: true },
);
</script>

<template>
  <OSettingRow
    :label="t('alerts.discovery.labels')"
    :description="t('alerts.discovery.insertHint')"
    fill
    wide
    data-test="add-alert-metric-labels"
  >
    <div v-if="labels.length && settled" class="flex min-w-0 flex-wrap gap-1.5 pt-1">
      <ODropdown
        v-for="label in shown"
        :key="label"
        align="start"
        @update:open="$event && load(label)"
      >
        <template #trigger>
          <OButton
            variant="outline"
            size="xs"
            icon-right="arrow-drop-down"
            :data-test="`add-alert-metric-label-${label}`"
            >{{ chipText(label) }}</OButton
          >
        </template>
        <ODropdownItem
          :data-test="`add-alert-metric-label-${label}-group`"
          @select="emit('insert', { label })"
          >{{ t("alerts.form.group.eachOfPlain", { labels: raw(label) }) }}</ODropdownItem
        >
        <ODropdownSeparator />
        <ODropdownItem v-if="entryOf(label)?.state === 'failed'" disabled>{{
          t("search.failedToFetchFieldValues")
        }}</ODropdownItem>
        <ODropdownItem v-else-if="entryOf(label)?.state !== 'ready'" disabled>{{
          t("common.loading")
        }}</ODropdownItem>
        <ODropdownItem v-else-if="!entryOf(label)!.values.length" disabled>{{
          t("alerts.discovery.fieldEmpty")
        }}</ODropdownItem>
        <ODropdownItem
          v-for="item in entryOf(label)?.state === 'ready' ? entryOf(label)!.values : []"
          :key="item.value"
          :data-test="`add-alert-metric-label-${label}-value`"
          @select="emit('insert', { label, value: item.value })"
          >{{
            t("alerts.discovery.valueCount", {
              value: raw(item.value),
              count: formatNumber(item.count),
            })
          }}</ODropdownItem
        >
      </ODropdown>
      <OButton
        v-if="hiddenCount > 0"
        variant="ghost-primary"
        size="xs"
        data-test="add-alert-metric-labels-more"
        @click="showAll = !showAll"
        >{{
          showAll
            ? t("alerts.tiers.showFewer")
            : t("alerts.copy.nMore", { count: formatNumber(hiddenCount) }, hiddenCount)
        }}</OButton
      >
    </div>
    <p
      v-else
      class="text-text-secondary m-0 pt-2 text-xs"
      data-test="add-alert-metric-labels-status"
    >
      <template v-if="state === 'loading' || (labels.length && !settled)">{{
        t("common.loading")
      }}</template>
      <template v-else-if="state === 'failed'">{{ t("search.failedToFetchFieldValues") }}</template>
      <template v-else>{{ raw("—") }}</template>
    </p>
  </OSettingRow>
</template>
