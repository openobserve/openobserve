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

<!-- The delivery rows the ledger holds for one object, one row per destination and event. -->
<template>
  <div class="flex flex-col gap-2" :data-test="`notification-deliveries-${kind}`">
    <div
      v-if="state === 'loading'"
      class="flex flex-col gap-2"
      data-test="notification-deliveries-loading"
    >
      <div v-for="n in 3" :key="n" class="bg-surface-panel rounded-default h-8 animate-pulse" />
    </div>
    <div
      v-else-if="state === 'forbidden'"
      class="text-text-secondary text-sm"
      data-test="notification-deliveries-forbidden"
    >
      {{ t("notificationDeliveries.forbidden") }}
    </div>
    <div
      v-else-if="state === 'error'"
      class="flex items-center gap-2 text-sm"
      role="alert"
      data-test="notification-deliveries-error"
    >
      <span class="text-input-error-text">{{ t("notificationDeliveries.loadFailed") }}</span>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="notification-deliveries-retry"
        @click="load"
        >{{ t("common.retry") }}</OButton
      >
    </div>
    <div
      v-else-if="!rows.length"
      class="text-text-secondary text-sm"
      data-test="notification-deliveries-empty"
    >
      {{ t("notificationDeliveries.empty") }}
    </div>
    <table v-else class="w-full text-sm" data-test="notification-deliveries-table">
      <thead>
        <tr class="text-text-secondary text-left text-xs">
          <th class="py-1 pe-3 font-medium">{{ t("notificationDeliveries.event") }}</th>
          <th class="py-1 pe-3 font-medium">{{ t("notificationDeliveries.destination") }}</th>
          <th class="py-1 pe-3 font-medium">{{ t("notificationDeliveries.template") }}</th>
          <th class="py-1 pe-3 font-medium">{{ t("notificationDeliveries.status") }}</th>
          <th class="py-1 font-medium">{{ t("notificationDeliveries.attempt") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="border-border-default border-t align-top"
          :data-test="`notification-deliveries-row-${row.destination}`"
        >
          <td class="py-1.5 pe-3">{{ row.event }}</td>
          <td class="py-1.5 pe-3">
            {{ row.destination }}
            <span class="text-text-secondary text-xs">({{ row.channel }})</span>
          </td>
          <td class="py-1.5 pe-3">{{ templateLabel(row) }}</td>
          <td class="py-1.5 pe-3">
            <OBadge :variant="statusVariant(row.status)" size="sm">{{
              t(statusKey(row.status))
            }}</OBadge>
            <div
              v-if="row.error || row.skip_reason"
              class="text-text-secondary pt-0.5 text-xs break-words"
              data-test="notification-deliveries-row-reason"
            >
              {{ row.error || row.skip_reason }}
            </div>
          </td>
          <td class="py-1.5">
            {{ t("notificationDeliveries.attemptOf", { n: row.attempt, max: row.max_attempts }) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import notificationDeliveries, { type DeliveryRow } from "@/services/notification_deliveries";

const props = withDefaults(
  defineProps<{
    kind: string;
    objectId: string;
    episodeId?: string;
    event?: string;
    /** Keeps only rows whose event ends with `:{eventSuffix}`, such as one run's events. */
    eventSuffix?: string;
  }>(),
  { episodeId: undefined, event: undefined, eventSuffix: undefined },
);

const { t } = useI18nTyped();
const store = useStore();

const state = ref<"loading" | "ready" | "error" | "forbidden">("loading");
const hits = ref<DeliveryRow[]>([]);

const rows = computed(() =>
  props.eventSuffix
    ? hits.value.filter((r) => r.event.endsWith(`:${props.eventSuffix}`))
    : hits.value,
);

const STATUS_KEYS = {
  sent: "notificationDeliveries.statusSent",
  failed: "notificationDeliveries.statusFailed",
  skipped: "notificationDeliveries.statusSkipped",
  pending: "notificationDeliveries.statusPending",
  queued: "notificationDeliveries.statusQueued",
} as const;

const statusKey = (status: DeliveryRow["status"]) => STATUS_KEYS[status] ?? STATUS_KEYS.pending;

const statusVariant = (status: DeliveryRow["status"]): BadgeVariant => {
  if (status === "sent") return "success-soft";
  if (status === "failed") return "error";
  if (status === "skipped") return "default-soft";
  return "warning-soft";
};

const templateLabel = (row: DeliveryRow) =>
  row.template_name
    ? raw(`${row.template_name} · ${row.template_source}`)
    : raw(row.template_source);

const load = async () => {
  if (!props.objectId && !props.episodeId) return;
  state.value = "loading";
  try {
    const res = await notificationDeliveries.list(store.state.selectedOrganization.identifier, {
      kind: props.kind,
      object_id: props.objectId || undefined,
      episode_id: props.episodeId,
      event: props.event,
      size: 50,
    });
    hits.value = res.data?.hits ?? [];
    state.value = "ready";
  } catch (e: any) {
    state.value = e?.response?.status === 403 ? "forbidden" : "error";
  }
};

watch(() => [props.kind, props.objectId, props.episodeId, props.event], load);
onMounted(load);

defineExpose({ load });
</script>
