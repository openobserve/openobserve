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
    size="lg"
    :title="active ? raw(active.config) : t('fleet.fleets.rollouts')"
    :sub-title="active ? changeText(active) : fleetName"
    data-test="fleet-rollouts-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="rolloutId" class="flex flex-col gap-5">
      <div>
        <OButton
          variant="ghost"
          size="sm"
          icon-left="arrow-back"
          data-test="fleet-rollouts-back"
          @click="emit('update:rolloutId', null)"
        >
          {{ t("fleet.fleets.allRollouts") }}
        </OButton>
      </div>
      <template v-if="active">
        <OBanner
          v-if="detail.error.value"
          variant="error"
          dense
          :content="t('fleet.common.loadFailed')"
          data-test="fleet-rollouts-detail-stale"
        />
        <div class="flex flex-wrap items-center gap-2">
          <OTag
            type="fleetRolloutStatus"
            :value="rolloutTagValue(active)"
            data-test="fleet-rollouts-status"
          />
          <OTag type="fleetStrategy" :value="active.strategy" />
          <OText variant="meta">{{
            active.status === "scheduled"
              ? t("fleet.rollouts.scheduledBy", { user: raw(active.startedBy) })
              : t("fleet.rollouts.startedBy", { user: raw(active.startedBy) })
          }}</OText>
        </div>

        <FleetRolloutOutcome
          :rollout="active"
          :stable="stableOf(active.fleetId)"
          @navigate="emit('navigate', $event)"
          @revert="emit('revert', active.fleetId, $event)"
          @retry="emit('retry', active)"
        />

        <OTimeline v-if="active.events.length" data-test="fleet-rollouts-timeline">
          <OTimelineItem
            v-for="(ev, i) in active.events"
            :key="i"
            :title="eventTitle(active, ev)"
            :subtitle="raw(new Date(ev.at).toLocaleTimeString())"
            :variant="eventVariant(active, ev.key)"
          />
        </OTimeline>

        <!-- The backend records an empty rollout with a zero-size phase that never runs. -->
        <FleetRolloutPhases v-if="rolloutTagValue(active) !== 'empty'" :rollout="active" />
      </template>
      <OEmptyState
        v-else-if="isForbidden(detail.error.value)"
        size="block"
        preset="no-access"
        data-test="fleet-rollouts-detail-forbidden"
      />
      <OEmptyState
        v-else-if="isNotFound(detail.error.value)"
        size="block"
        preset="no-data"
        :title="t('fleet.rollouts.notFound')"
        :description="t('fleet.rollouts.notFoundDescription')"
        data-test="fleet-rollouts-detail-not-found"
      />
      <OEmptyState
        v-else-if="detail.error.value"
        size="block"
        preset="load-error"
        data-test="fleet-rollouts-detail-error"
        @action="detail.refetch()"
      />
      <div v-else class="flex justify-center py-6" data-test="fleet-rollouts-detail-loading">
        <OSpinner />
      </div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <OBanner
        v-if="stale"
        variant="error"
        dense
        :content="t('fleet.common.loadFailed')"
        data-test="fleet-rollouts-stale"
      />
      <FleetRolloutTable
        :rows="rows"
        :loading="list.loading.value"
        :error="loadError"
        :forbidden="forbidden"
        data-test="fleet-rollouts-table"
        @open="emit('update:rolloutId', $event.id)"
        @retry="list.refetch()"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetRolloutPhases from "./FleetRolloutPhases.vue";
import FleetRolloutOutcome from "./FleetRolloutOutcome.vue";
import FleetRolloutTable from "./FleetRolloutTable.vue";
import { useRolloutText } from "./rolloutText";
import {
  byActiveThenNewest,
  isForbidden,
  isNotFound,
  rolloutTagValue,
  useFleetRollout,
  useFleetRollouts,
  useFleets,
  type RolloutRow,
} from "./useFleetApi";

type Version = { config: string; version: number };

const props = defineProps<{
  open: boolean;
  fleetId: string;
  fleetName: I18nText;
  rolloutId: string | null;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:rolloutId": [id: string | null];
  /** Carries the rollout's own fleet, which a link may open before the fleet is selected. */
  revert: [fleetId: string, to: Version];
  retry: [rollout: RolloutRow];
  navigate: [target: { tab: string; query: Record<string, string> }];
}>();

const { t } = useI18nTyped();
const { changeText } = useRolloutText();

const list = useFleetRollouts();
const fleets = useFleets();
const forbidden = computed(() => isForbidden(list.error.value));
const rows = computed(() =>
  list.rows.value.filter((r) => r.fleetId === props.fleetId).sort(byActiveThenNewest),
);
// Judged on this fleet's rows: cached rows of other fleets must not hide a failed read.
const loadError = computed(() =>
  list.error.value && !forbidden.value && !rows.value.length ? String(list.error.value) : null,
);
const stale = computed(() => !!list.error.value && !forbidden.value && rows.value.length > 0);
const detail = useFleetRollout(
  () => props.rolloutId,
  () => props.open && !!props.rolloutId,
);
// The list row stands in only while the detail is pending; a detail 403 or 404 must win over a cached row.
const active = computed(() => {
  if (!props.rolloutId) return null;
  if (detail.detail.value) return detail.detail.value;
  if (detail.error.value) return null;
  return list.rows.value.find((r) => r.id === props.rolloutId) ?? null;
});

const stableOf = (fleetId: string) =>
  fleets.rows.value.find((f) => f.id === fleetId)?.stable ?? null;

const EVENT_VARIANT: Record<string, TimelineItemVariant> = {
  deploying: "primary",
  observing: "info",
  gatePassed: "success",
  gateFailed: "destructive",
  rejected: "destructive",
  halted: "destructive",
  superseded: "muted",
  autoReverted: "destructive",
  completed: "success",
};

function eventVariant(r: RolloutRow, key: string): TimelineItemVariant {
  return rolloutTagValue(r) === "empty" ? "muted" : (EVENT_VARIANT[key] ?? "muted");
}

function eventTitle(r: RolloutRow, ev: RolloutRow["events"][number]) {
  switch (ev.key) {
    case "deploying": {
      // A 3a event carries no phase and sent to every member.
      const count = (ev.phase != null ? r.phases[ev.phase]?.size : undefined) ?? r.total;
      return t("fleet.rollouts.eventDeploying", { count }, count);
    }
    case "observing":
      return t("fleet.rollouts.eventObserving");
    case "gatePassed":
      return t("fleet.rollouts.eventGatePassed");
    case "gateFailed":
      return t("fleet.rollouts.eventGateFailed");
    case "rejected":
      return t("fleet.rollouts.eventRejected", { count: r.failed }, r.failed);
    case "halted":
      return t("fleet.rollouts.eventHalted");
    case "superseded":
      return t("fleet.rollouts.eventSuperseded");
    case "autoReverted":
      return t("fleet.rollouts.eventAutoReverted");
    case "completed":
      return rolloutTagValue(r) === "empty"
        ? t("fleet.rollouts.noneTargeted")
        : t("fleet.badge.completed");
    default:
      return raw(ev.key);
  }
}
</script>
