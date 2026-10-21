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
          <OTag type="fleetBatching" :value="active.batching.kind" />
          <OText variant="meta" data-test="fleet-rollouts-plan">{{
            batchingText(active.batching)
          }}</OText>
          <OText variant="meta">{{
            active.verify ? t("fleet.rollouts.verifyOn") : t("fleet.rollouts.verifyOff")
          }}</OText>
          <OText v-if="active.autoRollback" variant="meta">{{
            t("fleet.rollouts.autoRollbackOn")
          }}</OText>
          <OText variant="meta" class="ms-auto">{{
            active.status === "scheduled"
              ? t("fleet.rollouts.scheduledBy", { user: raw(active.startedBy) })
              : t("fleet.rollouts.startedBy", { user: raw(active.startedBy) })
          }}</OText>
        </div>

        <FleetRolloutOutcome
          :rollout="active"
          :busy="exitMutation.isPending.value"
          @exit="onExit"
        />

        <FleetRolloutPhases v-if="rolloutTagValue(active) !== 'empty'" :rollout="active" />

        <div v-if="active.events.length" class="flex flex-col gap-2">
          <OText variant="panel-title">{{ t("fleet.rollouts.timeline") }}</OText>
          <OTimeline data-test="fleet-rollouts-timeline">
            <OTimelineItem
              v-for="(ev, i) in timeline"
              :key="i"
              :title="eventTitle(ev)"
              :subtitle="raw(new Date(ev.at).toLocaleString())"
              :variant="EVENT_VARIANT[ev.key] ?? 'muted'"
            >
              <OText v-if="ev.detail" variant="meta">{{ ev.detail }}</OText>
            </OTimelineItem>
          </OTimeline>
        </div>
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
import { useMutation } from "@tanstack/vue-query";
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
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query/useOrgId";
import { rolloutExitMutation } from "@/services/fleet.queries";
import type { FleetHaltExit } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetRolloutPhases from "./FleetRolloutPhases.vue";
import FleetRolloutOutcome from "./FleetRolloutOutcome.vue";
import FleetRolloutTable from "./FleetRolloutTable.vue";
import { useRolloutText } from "./rolloutText";
import {
  byActiveThenNewest,
  failingMembers,
  isForbidden,
  isNotFound,
  rolloutTagValue,
  serverMessage,
  useFleetRollout,
  useFleetRollouts,
  useFleets,
  type RolloutRow,
} from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  fleetId: string;
  fleetName: I18nText;
  rolloutId: string | null;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:rolloutId": [id: string | null];
  /** Fix forward publishes a new version, which happens in the configuration editor. */
  "fix-forward": [rollout: RolloutRow];
  navigate: [target: { tab: string; query: Record<string, string> }];
}>();

const EVENT_VARIANT: Record<string, TimelineItemVariant> = {
  started: "primary",
  scheduled: "info",
  deploying: "primary",
  converged: "success",
  observing: "info",
  gatePassed: "success",
  gateFailed: "destructive",
  rejected: "destructive",
  timedOut: "destructive",
  halted: "destructive",
  resumed: "primary",
  skipped: "info",
  rolledBack: "destructive",
  autoRolledBack: "destructive",
  superseded: "muted",
  completed: "success",
};

const { t } = useI18nTyped();
const { batchingText, changeText, exitLabel } = useRolloutText();
const { confirm } = useConfirmDialog();
const orgId = useOrgId();
const exitMutation = useMutation(() => rolloutExitMutation(orgId.value));

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
const timeline = computed(() => [...(active.value?.events ?? [])].sort((a, b) => b.at - a.at));

function eventTitle(ev: RolloutRow["events"][number]): I18nText {
  const phase = ev.phase != null ? ev.phase + 1 : null;
  switch (ev.key) {
    case "started":
      return t("fleet.rollouts.eventStarted");
    case "scheduled":
      return t("fleet.badge.scheduled");
    case "deploying":
      return phase
        ? t("fleet.rollouts.eventDeployingPhase", { n: phase })
        : t("fleet.rollouts.eventDeployingAll");
    case "converged":
      return t("fleet.rollouts.eventConverged", { n: phase ?? 1 });
    case "observing":
      return t("fleet.rollouts.eventObserving");
    case "gatePassed":
      return t("fleet.rollouts.eventGatePassed");
    case "gateFailed":
      return t("fleet.rollouts.eventGateFailed");
    case "rejected": {
      const count = (ev.phase != null ? active.value?.phases[ev.phase]?.rejected : 0) || 1;
      return t("fleet.rollouts.eventRejected", { count }, count);
    }
    case "timedOut":
      return t("fleet.rollouts.eventTimedOut");
    case "skippedOffline": {
      const count = Number(ev.detail) || 1;
      return t("fleet.rollouts.eventSkippedOffline", { count }, count);
    }
    case "halted":
      return t("fleet.rollouts.eventHalted");
    case "resumed":
      return t("fleet.rollouts.eventResumed");
    case "skipped":
      return t("fleet.rollouts.eventSkipped");
    case "rolledBack":
      return t("fleet.badge.rolledBack");
    case "autoRolledBack":
      return t("fleet.rollouts.autoRolledBack");
    case "superseded":
      return t("fleet.rollouts.eventSuperseded");
    case "completed":
      return t("fleet.badge.completed");
    default:
      return raw(ev.key);
  }
}

function stableVersion(r: RolloutRow) {
  return fleets.rows.value.find((f) => f.id === r.fleetId)?.stable ?? null;
}

async function confirmExit(r: RolloutRow, exit: FleetHaltExit): Promise<boolean> {
  const halted = r.phases.findIndex((p) => p.status === "failed" || p.status === "timed_out");
  const failing = failingMembers(r).length;
  const stable = stableVersion(r);
  const messages: Record<FleetHaltExit, I18nText> = {
    rollback: stable
      ? t("fleet.rollouts.confirmRollback", {
          config: raw(stable.config),
          version: stable.version,
        })
      : t("fleet.rollouts.confirmRollbackNoStable"),
    resume: t("fleet.rollouts.confirmResume", { n: halted >= 0 ? halted + 1 : 1 }),
    fix_forward: t("fleet.rollouts.confirmFixForward", { config: raw(r.config) }),
    skip: t("fleet.rollouts.confirmSkip", { count: failing }, failing),
  };
  return confirm({
    title: t("fleet.rollouts.confirmExitTitle", { exit: exitLabel(exit) }),
    message: messages[exit],
    confirmLabel: exitLabel(exit),
    confirmVariant: exit === "rollback" ? "destructive" : "primary",
    focusCancel: exit === "rollback" || exit === "skip",
  });
}

async function onExit(exit: FleetHaltExit) {
  const r = active.value;
  if (!r) return;
  const org = orgId.value;
  if (!(await confirmExit(r, exit)) || orgId.value !== org) return;
  if (exit === "fix_forward") {
    emit("fix-forward", r);
    return;
  }
  try {
    await exitMutation.mutateAsync({
      id: r.id,
      exit,
      collectorIds: exit === "skip" ? failingMembers(r) : undefined,
    });
    toast({ variant: "success", message: t("fleet.rollouts.exitDone", { exit: exitLabel(exit) }) });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
