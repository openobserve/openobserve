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
          v-for="(row, index) in group.people"
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

        <!-- B10: a room post is a broadcast, not a fallback for reaching a
             person — it fires once per rung outside the recipient loop, and a
             broadcast that fails never marks the rung as a delivery failure,
             because nobody was being reached. Folding these into the rows
             above would report a page as undelivered when the page landed
             fine. Chat and webhook resolve to a destination the whole team
             watches; that split is the engine's own (`is_broadcast`). -->
        <template v-if="group.posts.length">
          <span class="text-text-label text-xs" :data-test="`oncall-deliveries-posts-${group.run}`">
            {{ t("oncall.deliveriesRoomPosts") }}
          </span>
          <div
            v-for="(row, index) in group.posts"
            :key="`post-${index}`"
            class="border-border-subtle flex flex-wrap items-center gap-2 border-b py-1.5 last:border-b-0"
            :data-test="`oncall-delivery-post-${group.run}-${index}`"
          >
            <OTag :variant="row.delivered ? 'success-soft' : 'warning-soft'" size="sm">
              {{ row.delivered ? t("oncall.roomPosted") : t("oncall.roomPostFailed") }}
            </OTag>
            <!-- A room, not a person — a user cell would imply an inbox. -->
            <span class="text-text-body text-sm">{{ raw(row.recipient ?? "") }}</span>
            <OTag v-if="row.channel" variant="default-soft" size="sm">
              {{ t(`oncall.channel_${row.channel}`) }}
            </OTag>
            <OTimeCell :value="row.at" unit="us" class="ms-auto" />
          </div>
        </template>
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
import type { Channel, DeliveryRecord } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
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

/// The engine's own split (`is_broadcast`): chat and webhook resolve to a
/// destination the whole team watches; everything else to one person's inbox,
/// handset or screen. Typed on the record — never parsed from the recipient.
const BROADCAST_CHANNELS = new Set<Channel>(["chat", "webhook"]);

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
    .map(([run, rows]) => ({
      run,
      people: rows.filter((row) => !row.channel || !BROADCAST_CHANNELS.has(row.channel)),
      posts: rows.filter((row) => !!row.channel && BROADCAST_CHANNELS.has(row.channel)),
    }));
});
</script>
