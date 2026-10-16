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
    <div v-if="rollout.phases.length" class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <OText variant="panel-title">{{ t("fleet.rollouts.progress") }}</OText>
      </div>
      <div
        v-for="(phase, i) in rollout.phases"
        :key="phase.id"
        class="rounded-surface border-border-default flex flex-col gap-2 border p-3"
        :data-test="`fleet-rollout-phases-phase-${phase.id}`"
      >
        <div class="flex items-center gap-2">
          <OText variant="body-strong">{{
            t(phase.labelKey, { n: i + 1, count: phase.size })
          }}</OText>
          <OTag
            :variant="PHASE_VARIANT[phase.status] ?? 'default-soft'"
            size="xs"
            :label="phaseLabel(phase.status)"
          />
          <OText variant="meta" class="ms-auto tabular-nums">{{
            countsText(phase, phase.size)
          }}</OText>
        </div>
        <OProgressBar
          :value="phase.size ? phase.accepted / phase.size : 0"
          :variant="phase.failed ? 'danger' : phase.status === 'done' ? 'success' : 'default'"
          size="sm"
        />
        <OText v-if="phase.status === 'observing'" variant="meta">{{
          t("fleet.rollouts.eventObserving")
        }}</OText>
        <OText
          v-if="phase.failed && rollout.failure"
          variant="meta"
          class="text-status-error-text"
          >{{ failureText(rollout) }}</OText
        >
      </div>
    </div>

    <div v-if="rollout.gates.length" class="flex flex-col gap-2">
      <OText variant="panel-title">{{ t("fleet.rollouts.healthGates") }}</OText>
      <div
        v-for="gate in rollout.gates"
        :key="gate.id"
        class="border-border-default flex items-center gap-3 border-b py-2 last:border-b-0"
        :data-test="`fleet-rollout-phases-gate-${gate.id}`"
      >
        <OIcon
          :name="GATE_ICON[gate.status] ?? 'hourglass-empty'"
          size="sm"
          :class="GATE_CLASS[gate.status] ?? 'text-text-secondary'"
        />
        <OText variant="body" class="flex-1">{{ t(gate.labelKey) }}</OText>
        <OText variant="meta">{{
          t("fleet.rollouts.threshold", { value: raw(gate.threshold) })
        }}</OText>
        <OText
          variant="body-strong"
          class="w-12 text-end tabular-nums"
          :class="GATE_CLASS[gate.status]"
          >{{ gate.status === "pending" ? raw("—") : raw(gate.observed) }}</OText
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRolloutText } from "./rolloutText";
import type { RolloutRow } from "./useFleetApi";

defineProps<{ rollout: RolloutRow }>();

const { t } = useI18nTyped();
const { countsText, failureText } = useRolloutText();

const PHASE_VARIANT: Record<string, BadgeVariant> = {
  done: "success-soft",
  running: "primary-soft",
  pending: "default-soft",
  failed: "error-soft",
  stopped: "warning-soft",
  observing: "purple-soft",
};

const GATE_ICON: Record<string, IconName> = {
  passing: "check-circle",
  failing: "error",
  pending: "hourglass-empty",
};

const GATE_CLASS: Record<string, string> = {
  passing: "text-status-success-text",
  failing: "text-status-error-text",
  pending: "text-text-secondary",
};

function phaseLabel(status: string) {
  switch (status) {
    case "done":
      return t("fleet.rollouts.phaseDone");
    case "running":
      return t("fleet.badge.inProgress");
    case "failed":
      return t("fleet.rollouts.phaseFailed");
    case "pending":
      return t("fleet.rollouts.phasePending");
    case "observing":
      return t("fleet.rollouts.phaseObserving");
    case "stopped":
      return t("fleet.rollouts.phaseStopped");
    default:
      return raw(status);
  }
}
</script>
