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
  <section data-test="rca-blind-spots" :aria-labelledby="headingId" class="flex flex-col">
    <div class="mb-2.5 flex flex-wrap items-baseline gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaSummary.blindSpots") }}
      </h3>
      <span class="text-text-secondary text-xs">{{ blindSpots.length }}</span>
      <span class="text-text-secondary text-xs">
        {{ t("alerts.incidents.rcaSummary.blindSpotsSubtitle") }}
      </span>
    </div>

    <p
      v-if="blindSpots.length === 0"
      data-test="rca-blind-spots-empty"
      class="text-text-muted text-compact m-0"
    >
      {{
        live
          ? t("alerts.incidents.rcaSummary.noBlindSpotsLive")
          : t("alerts.incidents.rcaSummary.noBlindSpots")
      }}
    </p>
    <ul
      v-else
      class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y border p-0"
    >
      <li
        v-for="spot in blindSpots"
        :key="spot.id"
        data-test="rca-blind-spot"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3.5 py-2.5"
      >
        <OIcon name="visibility-off" size="sm" class="text-status-warning-text self-start pt-0.5" />
        <div class="min-w-0">
          <div class="text-text-heading text-sm font-semibold">{{ spot.title }}</div>
          <div class="text-text-secondary text-compact [text-wrap:pretty]">{{ spot.why }}</div>
        </div>
        <OTooltip v-if="actions[spot.id]?.lockedReason" :content="actions[spot.id]!.lockedReason!">
          <span class="inline-flex">
            <OButton
              data-test="rca-blind-spot-action"
              :data-fix="spot.fix"
              variant="outline"
              size="sm"
              disabled
            >
              <template #icon-left>
                <OIcon
                  name="lock"
                  class="text-icon-locked"
                  size="sm"
                  data-test="rca-blind-spot-action-lock"
                />
              </template>
              {{ actions[spot.id]!.label }}
            </OButton>
          </span>
        </OTooltip>
        <OButton
          v-else-if="actions[spot.id]"
          data-test="rca-blind-spot-action"
          :data-fix="spot.fix"
          variant="outline"
          size="sm"
          :icon-left="actions[spot.id]!.icon"
          @click="router.push(actions[spot.id]!.route)"
        >
          {{ actions[spot.id]!.label }}
        </OButton>
        <OButton
          v-else-if="spot.fix === 'resume_run' && canResume"
          data-test="rca-blind-spot-action"
          data-fix="resume_run"
          variant="outline"
          size="sm"
          icon-left="play-arrow"
          :loading="resuming"
          :disabled="triggering"
          @click="$emit('resume')"
        >
          {{ t("alerts.incidents.rcaSummary.fix.resumeRun") }}
        </OButton>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaBlindSpot, RcaBlindSpotFix } from "@/services/incidents";
import { rcaBlindSpotFeature, rcaBlindSpotRoute } from "@/utils/incidents/rcaEvidenceLinks";
import { useLicenseLock } from "@/composables/useFeatureLock";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(
  defineProps<{
    blindSpots: RcaBlindSpot[];
    org: string;
    /** The run is live: gaps can still appear. */
    live: boolean;
    /** The shown run is the latest and can be resumed (J9). */
    canResume?: boolean;
    resuming?: boolean;
    /** A trigger is in flight: Resume waits for it. */
    triggering?: boolean;
  }>(),
  { canResume: false, resuming: false, triggering: false },
);

defineEmits<{
  /** The `resume_run` blind spot's button. */
  resume: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const headingId = useId();
const featureLocks = {
  ai_toolsets: useLicenseLock("ai_toolsets"),
  pipelines: useLicenseLock("pipelines"),
};

const actionLabel = (fix: RcaBlindSpotFix): { label: I18nText; icon: IconName } | null => {
  switch (fix) {
    case "connect_toolset":
      return { label: t("alerts.incidents.rcaSummary.fix.connectToolset"), icon: "link" };
    case "ingest_data":
      return { label: t("alerts.incidents.rcaSummary.fix.ingestData"), icon: "open-in-new" };
    case "open_pipeline":
      return { label: t("alerts.incidents.rcaSummary.fix.openPipeline"), icon: "open-in-new" };
    case "sampling_rules":
      return { label: t("alerts.incidents.rcaSummary.fix.samplingRules"), icon: "open-in-new" };
    default:
      return null;
  }
};

/** Blind spot id → its button, for the spots that have one. */
const actions = computed(() => {
  const byId: Record<
    string,
    { label: I18nText; icon: IconName; route: RouteLocationRaw; lockedReason: I18nText | null }
  > = {};
  for (const spot of props.blindSpots) {
    const route = rcaBlindSpotRoute(spot.fix, props.org);
    const action = actionLabel(spot.fix);
    const feature = rcaBlindSpotFeature(spot.fix);
    const lock = feature ? featureLocks[feature] : null;
    const lockedReason = lock?.locked.value ? lock.lockedReason.value : null;
    if (route && action) byId[spot.id] = { ...action, route, lockedReason };
  }
  return byId;
});
</script>
