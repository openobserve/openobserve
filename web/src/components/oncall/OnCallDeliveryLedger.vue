<!--
  The delivery ledger: every send this page attempted, per person, per channel,
  and whether the transport took it. The timeline's `page` line says "paged
  ana, bo", which is a claim; this is the receipt.

  Grouped by ladder run, because a page that changed hands is climbed by more
  than one ladder and the old team's sends must not read as rungs of the new
  team's climb — that exact misreading caused both handoff P0s server-side.
  Absent `ladder_run` means the first run; the groups render only when there is
  more than one, since "Run 1" over everything is a header with no question.
-->
<template>
  <div class="flex flex-col gap-2" data-test="oncall-delivery-ledger">
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.deliveriesTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.deliveriesHint") }}</OText>
    </span>

    <OInnerLoading v-if="loading" showing />

    <p v-else-if="!records.length" class="text-text-secondary text-sm" data-test="oncall-deliveries-empty">
      {{ t("oncall.deliveriesNone") }}
    </p>

    <template v-else>
      <div v-for="group in groups" :key="group.run" class="flex flex-col gap-1">
        <!-- The boundary is the fact worth a header: everything under it was
             sent by a DIFFERENT team's ladder than the group above. -->
        <span
          v-if="groups.length > 1"
          class="text-text-label text-xs"
          :data-test="`oncall-deliveries-run-${group.run}`"
        >
          {{ t("oncall.deliveriesRun", { run: group.run }) }}
        </span>

        <div
          v-for="(row, index) in group.rows"
          :key="index"
          class="border-border-subtle flex flex-wrap items-center gap-2 border-b py-1.5 last:border-b-0"
          :data-test="`oncall-delivery-row-${group.run}-${index}`"
        >
          <OTag :variant="row.delivered ? 'success-soft' : 'error-soft'" size="sm">
            {{ row.delivered ? t("oncall.deliveryLanded") : t("oncall.deliveryFailed") }}
          </OTag>
          <OUserCell v-if="row.recipient" :value="row.recipient" />
          <OTag v-if="row.channel" variant="default-soft" size="sm">
            {{ t(`oncall.channel_${row.channel}`) }}
          </OTag>
          <span v-if="row.rung_micros !== null && row.rung_micros !== undefined" class="text-text-secondary text-xs">
            {{ t("oncall.atRung", { delay: formatMicrosDuration(row.rung_micros) }) }}
          </span>
          <OTimeCell :value="row.at" unit="us" class="ms-auto" />
        </div>
      </div>

      <!-- The server truncates; the count must not pretend otherwise. -->
      <span v-if="total > records.length" class="text-text-secondary text-xs" data-test="oncall-deliveries-truncated">
        {{ t("oncall.deliveriesTruncated", { shown: records.length, total }) }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import type { DeliveryRecord } from "@/ts/interfaces/oncall";
import { useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    records?: DeliveryRecord[];
    /** The server's pre-truncation count, never `records.length`. */
    total?: number;
    loading?: boolean;
  }>(),
  { records: () => [], total: 0, loading: false },
);

const { t } = useI18nTyped();

/// Newest run first — the current climb is the one being worked; the previous
/// team's sends are context underneath it.
const groups = computed(() => {
  const byRun = new Map<number, DeliveryRecord[]>();
  for (const row of props.records) {
    const run = row.ladder_run ?? 1;
    if (!byRun.has(run)) byRun.set(run, []);
    byRun.get(run)!.push(row);
  }
  return [...byRun.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([run, rows]) => ({ run, rows }));
});
</script>
