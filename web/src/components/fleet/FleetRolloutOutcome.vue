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
      <span class="font-medium">{{ outcome.title }}</span>
      <span>{{ outcome.body }}</span>
      <span v-if="outcome.hint">{{ outcome.hint }}</span>
      <span v-if="outcome.at" class="text-xs opacity-80">{{ outcome.at }}</span>
    </div>
    <template #actions>
      <OButton
        v-if="rollout.status === 'halted'"
        variant="outline"
        size="sm"
        icon-left="refresh"
        data-test="fleet-rollout-outcome-retry"
        @click="emit('retry')"
      >
        {{ t("fleet.fleets.retry") }}
      </OButton>
      <OButton
        v-if="revertTo"
        variant="outline"
        size="sm"
        icon-left="undo"
        data-test="fleet-rollout-outcome-revert"
        @click="emit('revert', revertTo)"
      >
        {{ t("fleet.fleets.revert", { version: revertTo.version }) }}
      </OButton>
      <OButton
        v-if="rollout.status !== 'completed'"
        variant="outline"
        size="sm"
        icon-left="edit"
        data-test="fleet-rollout-outcome-edit"
        @click="emit('navigate', { tab: 'editor', query: { id: rollout.config } })"
      >
        {{ t("fleet.rollouts.editConfig") }}
      </OButton>
      <OButton
        v-if="firstMember"
        variant="outline"
        size="sm"
        icon-left="dns"
        data-test="fleet-rollout-outcome-collector"
        @click="
          emit('navigate', {
            tab: 'fleets',
            query: rollout.fleetName === null ? { scope: 'all' } : { folder: rollout.fleetId },
          })
        "
      >
        {{ t("fleet.rollouts.viewCollectors") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRolloutText } from "./rolloutText";
import type { RolloutRow } from "./useFleetApi";

type Version = { config: string; version: number };

const props = defineProps<{
  rollout: RolloutRow;
  /** The stable version of the rollout's fleet, which a revert goes back to. */
  stable?: Version | null;
}>();
const emit = defineEmits<{
  navigate: [target: { tab: string; query: Record<string, string> }];
  revert: [to: Version];
  retry: [];
}>();

const { t } = useI18nTyped();
const { countsText, failureText, startsText } = useRolloutText();

const firstMember = computed(() => props.rollout.members[0]);

const revertTo = computed(() => {
  const r = props.rollout;
  const s = props.stable;
  if (r.status !== "halted" || !s) return null;
  return s.config === r.config && s.version === r.toVersion ? null : s;
});

const eventTime = (key: string) => {
  const at = props.rollout.events.find((e) => e.key === key)?.at;
  return at ? raw(new Date(at).toLocaleTimeString()) : undefined;
};

const outcome = computed<{
  variant: "success" | "warning" | "error" | "info";
  title: I18nText;
  body: I18nText;
  hint?: I18nText;
  at?: I18nText;
} | null>(() => {
  const r = props.rollout;
  if (r.status === "halted") {
    return {
      variant: "error",
      title: r.failure ? failureText(r) : t("fleet.fleets.halted"),
      body: countsText(r, r.total),
      hint: t("fleet.rollouts.outcomeHalted", { to: r.toVersion }),
      at: eventTime("halted"),
    };
  }
  // A superseded revision keeps the failure it halted on, so an automatic revert stays explained.
  if (r.status === "superseded") {
    const autoReverted = r.events.some((e) => e.key === "autoReverted");
    return {
      variant: r.failure ? "warning" : "info",
      title: r.failure ? failureText(r) : t("fleet.badge.superseded"),
      body: autoReverted
        ? t("fleet.rollouts.outcomeAutoReverted")
        : t("fleet.rollouts.outcomeSuperseded"),
      at: eventTime(autoReverted ? "autoReverted" : "superseded"),
    };
  }
  if (r.status === "completed" && r.total === 0) {
    return {
      variant: "info",
      title: t("fleet.rollouts.noneTargeted"),
      body: t("fleet.rollouts.outcomeNoneTargeted", { to: r.toVersion }),
      at: eventTime("completed"),
    };
  }
  if (r.status === "completed") {
    return {
      variant: "success",
      title: t("fleet.badge.completed"),
      body: t(
        "fleet.rollouts.outcomeCompleted",
        { count: r.accepted, to: r.toVersion },
        r.accepted,
      ),
      at: eventTime("completed"),
    };
  }
  if (r.status === "scheduled" && r.scheduledFor) {
    return {
      variant: "info",
      title: t("fleet.badge.scheduled"),
      body: startsText(r.scheduledFor),
    };
  }
  return null;
});
</script>
