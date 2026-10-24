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
  <OBanner
    v-if="outcome"
    :variant="outcome.variant"
    dense
    preserve-whitespace
    data-test="fleet-rollout-outcome"
  >
    <div class="flex flex-col gap-0.5">
      <span class="font-medium" data-test="fleet-rollout-outcome-title">{{ outcome.title }}</span>
      <span data-test="fleet-rollout-outcome-body">{{ outcome.body }}</span>
      <span v-if="outcome.at" class="text-xs">{{ outcome.at }}</span>
    </div>
    <template v-if="rollout.status === 'halted' && rollout.halt" #actions>
      <span v-for="exit in HALT_EXITS" :key="exit" class="inline-flex">
        <OButton
          :variant="exit === 'rollback' ? 'outline-destructive' : 'outline'"
          size="sm"
          :icon-left="EXIT_ICON[exit]"
          :disabled="!offered(exit) || busy"
          :data-test="`fleet-rollout-outcome-${exit}`"
          @click="emit('exit', exit)"
        >
          {{ exitLabel(exit) }}
        </OButton>
        <!-- A disabled button gets no pointer events, so the reason hangs on its wrapper. -->
        <OTooltip v-if="!offered(exit)" :content="unavailableText(exit)" />
      </span>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { FleetHaltExit } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRolloutText } from "./rolloutText";
import { failingMembers, HALT_EXITS, rolloutConfirmed, type RolloutRow } from "./useFleetApi";

const props = defineProps<{ rollout: RolloutRow; busy?: boolean }>();
const emit = defineEmits<{ exit: [exit: FleetHaltExit] }>();

const EXIT_ICON: Record<FleetHaltExit, IconName> = {
  rollback: "undo",
  resume: "play-arrow",
  fix_forward: "edit",
  skip: "fast-forward",
};

const { t } = useI18nTyped();
const { exitLabel, haltClassText, progressText, startsText } = useRolloutText();

// Skip needs collectors to exclude, even when the server lists it.
const offered = (exit: FleetHaltExit) =>
  !!props.rollout.halt?.exits.includes(exit) &&
  (exit !== "skip" || failingMembers(props.rollout).length > 0);

function unavailableText(exit: FleetHaltExit): I18nText {
  if (exit === "skip" && props.rollout.halt?.exits.includes("skip"))
    return t("fleet.rollouts.skipNothing");
  if (exit === "resume" && props.rollout.halt?.class === "proven_bad")
    return t("fleet.rollouts.resumeProvenBad");
  return t("fleet.rollouts.exitNotOffered");
}

const at = (ms: number | null | undefined) => (ms ? raw(new Date(ms).toLocaleString()) : undefined);

const outcome = computed<{
  variant: "success" | "warning" | "error" | "info";
  title: I18nText;
  body: I18nText;
  at?: I18nText;
} | null>(() => {
  const r = props.rollout;
  if (r.status === "halted" && r.halt) {
    return {
      variant: "error",
      title: t("fleet.rollouts.haltedTitle", { class: haltClassText(r.halt.class) }),
      body: raw(r.halt.reason),
      at: at(r.halt.at),
    };
  }
  if (r.status === "rolled_back") {
    return {
      variant: "warning",
      title: r.autoRollback ? t("fleet.rollouts.autoRolledBack") : t("fleet.badge.rolledBack"),
      body: t("fleet.rollouts.outcomeRolledBack"),
      at: at(r.endedAt),
    };
  }
  if (r.status === "superseded") {
    return {
      variant: "info",
      title: t("fleet.badge.superseded"),
      body: t("fleet.rollouts.outcomeSuperseded"),
      at: at(r.endedAt),
    };
  }
  if (r.status === "completed" && r.total === 0) {
    return {
      variant: "info",
      title: t("fleet.rollouts.noneTargeted"),
      body: t("fleet.rollouts.outcomeNoneTargeted", { to: r.toVersion }),
      at: at(r.endedAt),
    };
  }
  if (r.status === "completed") {
    const count = rolloutConfirmed(r);
    return {
      variant: "success",
      title: t("fleet.badge.completed"),
      body: t("fleet.rollouts.outcomeCompleted", { count, to: r.toVersion }, count),
      at: at(r.endedAt),
    };
  }
  if (r.status === "scheduled" && r.start.kind === "at") {
    return { variant: "info", title: t("fleet.badge.scheduled"), body: startsText(r.start.at) };
  }
  if (r.status === "in_progress") {
    return { variant: "info", title: t("fleet.badge.inProgress"), body: progressText(r) };
  }
  return null;
});
</script>
