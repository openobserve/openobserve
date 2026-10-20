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
  <div class="flex flex-col gap-5" :data-test="`fleet-rollout-phases-${rollout.id}`">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <OText variant="panel-title">{{ t("fleet.rollouts.phases") }}</OText>
        <OText variant="meta" class="ms-auto tabular-nums">{{ progressText(rollout) }}</OText>
      </div>
      <OProgressBar
        :value="rollout.total ? rollout.running / rollout.total : 0"
        :variant="
          rollout.status === 'halted'
            ? 'danger'
            : rollout.status === 'completed'
              ? 'success'
              : 'default'
        "
        size="sm"
      />
      <OTable
        :data="rollout.phases"
        :columns="phaseColumns"
        row-key="index"
        :frame="false"
        pagination="none"
        :show-global-filter="false"
        :row-rail-tone="(p: FleetRolloutPhase) => PHASE_RAIL[p.status] ?? null"
        data-test="fleet-rollout-phases-table"
      >
        <template #cell-index="{ row }">
          <span class="tabular-nums">{{ t("fleet.rollouts.phaseN", { n: row.index + 1 }) }}</span>
        </template>
        <template #cell-status="{ row }">
          <OTag
            :variant="PHASE_VARIANT[row.status] ?? 'default-soft'"
            size="xs"
            :label="phaseLabel(row.status)"
            :data-test="`fleet-rollout-phases-status-${row.index}`"
          />
        </template>
        <template #cell-rejected="{ row }">
          <span
            class="tabular-nums"
            :class="row.rejected ? 'text-status-error-text' : 'text-text-muted'"
            >{{ row.rejected }}</span
          >
        </template>
        <template #cell-gate="{ row }">
          <span
            v-if="row.gate"
            class="inline-flex items-center gap-1.5"
            :data-test="`fleet-rollout-phases-gate-${row.index}`"
          >
            <OIcon
              :name="row.gate.passed ? 'check-circle' : 'error'"
              size="sm"
              :class="row.gate.passed ? 'text-status-success-text' : 'text-status-error-text'"
            />
            <span>{{ row.gate.observed }}</span>
          </span>
          <span v-else class="text-text-muted">{{
            rollout.verify ? DASH : t("fleet.rollouts.noGate")
          }}</span>
        </template>
      </OTable>
    </div>

    <div v-if="rollout.members.length" class="flex flex-col gap-2">
      <OText variant="panel-title">{{ t("fleet.rollouts.members") }}</OText>
      <OTable
        :data="memberRows"
        :columns="memberColumns"
        row-key="collectorId"
        :frame="false"
        pagination="client"
        :page-size="10"
        :show-global-filter="false"
        :row-tone="(m: MemberRow) => (m.excluded ? 'muted' : null)"
        data-test="fleet-rollout-members-table"
      >
        <template #cell-name="{ row }">
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-medium">{{ row.name }}</span>
            <OTag
              v-if="row.excluded"
              variant="warning-soft"
              size="xs"
              :label="t('fleet.rollouts.excluded')"
              :data-test="`fleet-rollout-members-excluded-${row.collectorId}`"
            />
          </div>
        </template>
        <template #cell-phase="{ row }">
          <span class="tabular-nums">{{ row.phase + 1 }}</span>
        </template>
        <template #cell-state="{ row }">
          <OTag
            v-if="DELIVERY.includes(row.state)"
            type="fleetDelivery"
            :value="row.state"
            size="xs"
          />
          <span v-else class="text-text-secondary">{{ memberState(row.state) }}</span>
        </template>
        <template #cell-remote="{ row }">
          <span v-if="row.evidence?.remote_status" class="inline-flex flex-col">
            <span>{{ row.evidence.remote_status }}</span>
            <OText v-if="row.evidence.remote_hash" variant="mono" class="text-xs">{{
              row.evidence.remote_hash
            }}</OText>
          </span>
          <span v-else class="text-text-muted">{{ DASH }}</span>
        </template>
        <template #cell-marker="{ row }">
          <span v-if="row.evidence?.marker" class="tabular-nums">{{
            t("fleet.rollouts.publishSubtitle", {
              config: raw(row.evidence.marker.config),
              version: row.evidence.marker.version,
            })
          }}</span>
          <span v-else class="text-text-muted">{{ DASH }}</span>
        </template>
        <template #cell-heartbeat="{ row }">
          <OTimeCell v-if="row.heartbeat" :value="row.heartbeat" unit="ms" mode="relative" />
          <span v-else class="text-text-muted">{{ DASH }}</span>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { FleetDeliveryEvidence, FleetPhaseStatus, FleetRolloutPhase } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRolloutText } from "./rolloutText";
import { useFleetCollectors, type RolloutRow } from "./useFleetApi";

interface MemberRow {
  collectorId: string;
  name: string;
  phase: number;
  state: string;
  excluded: boolean;
  evidence: FleetDeliveryEvidence | null;
  heartbeat: number | null;
}

const props = defineProps<{ rollout: RolloutRow }>();

const DASH = raw("—");
const DELIVERY = ["assigned", "sent", "accepted", "running", "rejected"];

const PHASE_VARIANT: Partial<Record<FleetPhaseStatus, BadgeVariant>> = {
  pending: "default-soft",
  deploying: "primary-soft",
  converging: "primary-soft",
  observing: "purple-soft",
  verifying: "purple-soft",
  done: "success-soft",
  failed: "error-soft",
  stopped: "warning-soft",
  timed_out: "error-soft",
};

const PHASE_RAIL: Partial<Record<FleetPhaseStatus, RowRailTone>> = {
  failed: "error",
  timed_out: "error",
  deploying: "primary",
  converging: "primary",
  observing: "primary",
  verifying: "primary",
};

const { t } = useI18nTyped();
const { progressText } = useRolloutText();
// Member evidence falls back to the collector list while the rollout read carries none.
const collectors = useFleetCollectors();

const byId = computed(() => new Map(collectors.rows.value.map((c) => [c.id, c])));

const memberRows = computed<MemberRow[]>(() =>
  props.rollout.members.map((m) => {
    const c = byId.value.get(m.collectorId);
    return {
      ...m,
      name: c?.name ?? m.collectorId,
      heartbeat: m.evidence?.last_heartbeat_at ?? c?.lastSeen ?? null,
    };
  }),
);

function phaseLabel(status: FleetPhaseStatus): I18nText {
  const labels: Record<FleetPhaseStatus, I18nText> = {
    pending: t("fleet.rollouts.phasePending"),
    deploying: t("fleet.rollouts.phaseDeploying"),
    converging: t("fleet.rollouts.phaseConverging"),
    observing: t("fleet.rollouts.phaseObserving"),
    verifying: t("fleet.rollouts.phaseVerifying"),
    done: t("fleet.rollouts.phaseDone"),
    failed: t("fleet.rollouts.phaseFailed"),
    stopped: t("fleet.rollouts.phaseStopped"),
    timed_out: t("fleet.rollouts.phaseTimedOut"),
  };
  return labels[status] ?? raw(status);
}

function memberState(state: string): I18nText {
  if (state === "pending") return t("fleet.rollouts.phasePending");
  if (state === "removed") return t("fleet.rollouts.memberRemoved");
  return raw(state);
}

const phaseColumns = computed<OTableColumnDef<FleetRolloutPhase>[]>(() => [
  { id: "index", header: t("fleet.rollouts.phase"), accessorKey: "index", size: 90 },
  { id: "size", header: t("fleet.rollouts.size"), accessorKey: "size", size: 70 },
  { id: "status", header: t("fleet.common.status"), accessorKey: "status", size: 120 },
  { id: "targeted", header: t("fleet.rollouts.targeted"), accessorKey: "targeted", size: 90 },
  { id: "sent", header: t("fleet.rollouts.sent"), accessorKey: "sent", size: 70 },
  { id: "confirmed", header: t("fleet.rollouts.confirmed"), accessorKey: "confirmed", size: 100 },
  { id: "rejected", header: t("fleet.rollouts.rejected"), accessorKey: "rejected", size: 90 },
  {
    id: "gate",
    header: t("fleet.rollouts.gate"),
    accessorFn: (p) => p.gate?.observed ?? "",
    size: 160,
  },
]);

const memberColumns = computed<OTableColumnDef<MemberRow>[]>(() => [
  { id: "name", header: t("fleet.collectors.collector"), accessorKey: "name", size: 200 },
  { id: "phase", header: t("fleet.rollouts.phase"), accessorKey: "phase", size: 70 },
  { id: "state", header: t("fleet.collectors.delivery"), accessorKey: "state", size: 110 },
  {
    id: "remote",
    header: t("fleet.collectors.remoteStatus"),
    accessorFn: (m) => m.evidence?.remote_status ?? "",
    size: 130,
  },
  {
    id: "marker",
    header: t("fleet.collectors.marker"),
    accessorFn: (m) => m.evidence?.marker?.version ?? "",
    size: 140,
  },
  {
    id: "heartbeat",
    header: t("fleet.collectors.lastHeartbeat"),
    accessorKey: "heartbeat",
    size: 130,
  },
]);
</script>
