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
<!--
  VersionErrorDiff — compact "Failure changes" panel for the version-compare
  view. Renders the tri-state error diff (introduced/fixed/shared failure
  classes) the compare endpoint returns alongside latency/cost:
    - Introduced: failure classes only seen in arm A (crit — new problems).
    - Fixed: failure classes only seen in arm B (good — resolved problems).
    - Shared: failure classes in both arms, with an A/B count + a delta arrow
      colored the same way VersionDeltaStrip colors an up-worse metric
      (delta>0 = worse = crit, delta<0 = better = good, 0 = neutral).
  Empty groups collapse entirely. When there's nothing to compare
  (`insufficient`, or no diff available yet), a single muted note renders
  instead of the groups.
-->
<template>
  <OCard
    class="rounded-surface! border border-border-default bg-surface-panel"
    data-test="version-error-diff"
  >
    <OCardSection role="header" class="flex flex-col gap-0.5 p-3!">
      <span class="text-sm font-semibold text-text-body">{{ t("aiObservability.errorDiff.title") }}</span>
      <span v-if="!showEmpty" class="text-xs text-text-muted">
        {{ t("aiObservability.errorDiff.subtitle", { a: labelA, b: labelB }) }}
      </span>
    </OCardSection>

    <OCardSection v-if="showEmpty" role="body" class="p-3! pt-0!">
      <span class="text-xs text-text-muted" data-test="version-error-diff-empty">
        {{ t("aiObservability.errorDiff.noData") }}
      </span>
    </OCardSection>

    <OCardSection v-else role="body" class="flex flex-col gap-3 p-3! pt-0!">
      <div
        v-if="errorDiff!.introduced.length"
        data-test="version-error-diff-group-introduced"
      >
        <span class="flex items-baseline gap-1.5">
          <span class="text-xs font-semibold uppercase text-error-600">
            {{ t("aiObservability.errorDiff.introduced") }}
          </span>
          <span class="text-xs text-text-muted">{{ t("aiObservability.errorDiff.introducedHint", { b: labelB }) }}</span>
        </span>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="row in errorDiff!.introduced"
            :key="row.fail_class"
            class="flex items-center justify-between text-sm text-text-body"
            :data-test="`version-error-diff-row-introduced-${row.fail_class}`"
          >
            <span>{{ row.fail_class }}</span>
            <span class="font-medium text-error-600">{{ row.count }}</span>
          </li>
        </ul>
      </div>

      <div v-if="errorDiff!.fixed.length" data-test="version-error-diff-group-fixed">
        <span class="flex items-baseline gap-1.5">
          <span class="text-xs font-semibold uppercase text-success-600">
            {{ t("aiObservability.errorDiff.fixed") }}
          </span>
          <span class="text-xs text-text-muted">{{ t("aiObservability.errorDiff.fixedHint", { b: labelB }) }}</span>
        </span>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="row in errorDiff!.fixed"
            :key="row.fail_class"
            class="flex items-center justify-between text-sm text-text-body"
            :data-test="`version-error-diff-row-fixed-${row.fail_class}`"
          >
            <span>{{ row.fail_class }}</span>
            <span class="font-medium text-success-600">{{ row.count }}</span>
          </li>
        </ul>
      </div>

      <div v-if="errorDiff!.shared.length" data-test="version-error-diff-group-shared">
        <div class="flex items-baseline justify-between">
          <span class="flex items-baseline gap-1.5">
            <span class="text-xs font-semibold uppercase text-text-secondary">
              {{ t("aiObservability.errorDiff.shared") }}
            </span>
            <span class="text-xs text-text-muted">{{ t("aiObservability.errorDiff.sharedHint") }}</span>
          </span>
          <span class="inline-flex items-center gap-1 text-xs">
            <span class="text-accent font-medium">{{ labelA }}</span>
            <span class="text-text-muted">→</span>
            <span class="text-series-b font-medium">{{ labelB }}</span>
          </span>
        </div>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="row in errorDiff!.shared"
            :key="row.fail_class"
            class="flex items-center justify-between text-sm text-text-body"
            :data-test="`version-error-diff-row-shared-${row.fail_class}`"
          >
            <span>{{ row.fail_class }}</span>
            <span class="inline-flex items-center gap-1">
              <span class="text-accent font-medium">{{ row.count_a }}</span>
              <span class="text-text-muted">/</span>
              <span class="text-series-b font-medium">{{ row.count_b }}</span>
              <span
                class="font-semibold"
                :class="sharedDeltaColorClass(row.delta)"
                :data-test="`version-error-diff-delta-${row.fail_class}`"
              >
                {{ sharedDeltaSymbol(row.delta) }}
              </span>
            </span>
          </li>
        </ul>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import type { ErrorDiff } from "@/services/gen-ai-agent-mapping.service";

const props = withDefaults(
  defineProps<{
    errorDiff: ErrorDiff | null;
    /** Actual version strings so headings read "1.4.0"/"1.5.0", not "A"/"B". */
    versionA?: string;
    versionB?: string;
  }>(),
  { versionA: "", versionB: "" },
);

const { t } = useI18n();

// Human labels for the two arms — the real version when known, else the generic
// "Version A/B" fallback so the panel is never blank.
const labelA = computed(() => props.versionA || t("aiObservability.errorDiff.legendA"));
const labelB = computed(() => props.versionB || t("aiObservability.errorDiff.legendB"));

const showEmpty = computed(() => !props.errorDiff || props.errorDiff.insufficient);

// Shared-row delta verdict: higher count in A (delta>0) is worse (crit),
// lower (delta<0) is better (good), unchanged is neutral. Mirrors
// VersionDeltaStrip's up-worse coloring convention.
function sharedDeltaColorClass(delta: number): string {
  if (delta > 0) return "text-error-600";
  if (delta < 0) return "text-success-600";
  return "text-text-secondary";
}

function sharedDeltaSymbol(delta: number): string {
  if (delta > 0) return "▲";
  if (delta < 0) return "▼";
  return "—";
}
</script>
