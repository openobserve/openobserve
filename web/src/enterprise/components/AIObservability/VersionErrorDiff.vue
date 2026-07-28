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
    - Introduced: classes only in B, the newer version (crit — new problems).
    - Fixed: classes only in A, the baseline (good — gone in the new version).
    - Shared: classes in both, with A/B counts + a delta arrow. delta = A − B, so
      delta<0 means the count ROSE in B (more errors = worse = red ▲) and delta>0
      means it FELL (fewer = better = green ▼).
    The three groups render side-by-side in a capped, scrollable grid so a version
    with many failure classes never grows the panel tall enough to push the chart
    below the fold.
  Empty groups collapse entirely. When there's nothing to compare
  (`insufficient`, or no diff available yet), a single muted note renders
  instead of the groups.
-->
<template>
  <OCard
    class="rounded-surface! border-border-default bg-surface-panel border"
    data-test="version-error-diff"
  >
    <OCardSection role="header" class="flex flex-col gap-0.5 p-3!">
      <span class="text-text-body text-sm font-semibold">{{
        t("aiObservability.errorDiff.title")
      }}</span>
      <span v-if="!showEmpty" class="text-text-muted text-xs">
        {{ t("aiObservability.errorDiff.subtitle", { a: labelA, b: labelB }) }}
      </span>
    </OCardSection>

    <OCardSection v-if="showEmpty" role="body" class="p-3! pt-0!">
      <span class="text-text-muted text-xs" data-test="version-error-diff-empty">
        {{ t("aiObservability.errorDiff.noData") }}
      </span>
    </OCardSection>

    <!-- Three parallel groups side-by-side (not stacked) and the body height is
         capped + scrollable, so a version with many failure classes never grows
         the panel tall enough to push the trend chart below the fold. -->
    <OCardSection
      v-else
      role="body"
      class="grid max-h-64 grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto p-3! pt-0! sm:grid-cols-2 lg:grid-cols-3"
    >
      <div v-if="errorDiff!.introduced.length" data-test="version-error-diff-group-introduced">
        <div class="border-border-default flex items-baseline gap-1.5 border-b pb-1">
          <span class="text-error-600 text-xs font-semibold uppercase">
            {{ t("aiObservability.errorDiff.introduced") }}
          </span>
          <span class="text-2xs text-text-muted">{{
            t("aiObservability.errorDiff.introducedHint", { b: labelB })
          }}</span>
        </div>
        <ul class="mt-1.5 flex flex-col gap-1">
          <li
            v-for="row in errorDiff!.introduced"
            :key="row.fail_class"
            class="text-text-body flex items-center justify-between gap-2 text-sm"
            :data-test="`version-error-diff-row-introduced-${row.fail_class}`"
          >
            <span class="truncate">{{ row.fail_class }}</span>
            <span class="text-error-600 shrink-0 font-medium tabular-nums">+{{ row.count }}</span>
          </li>
        </ul>
      </div>

      <div v-if="errorDiff!.fixed.length" data-test="version-error-diff-group-fixed">
        <div class="border-border-default flex items-baseline gap-1.5 border-b pb-1">
          <span class="text-success-600 text-xs font-semibold uppercase">
            {{ t("aiObservability.errorDiff.fixed") }}
          </span>
          <span class="text-2xs text-text-muted">{{
            t("aiObservability.errorDiff.fixedHint", { b: labelB })
          }}</span>
        </div>
        <ul class="mt-1.5 flex flex-col gap-1">
          <li
            v-for="row in errorDiff!.fixed"
            :key="row.fail_class"
            class="text-text-body flex items-center justify-between gap-2 text-sm"
            :data-test="`version-error-diff-row-fixed-${row.fail_class}`"
          >
            <span class="truncate">{{ row.fail_class }}</span>
            <span class="text-success-600 shrink-0 font-medium tabular-nums">−{{ row.count }}</span>
          </li>
        </ul>
      </div>

      <div v-if="errorDiff!.shared.length" data-test="version-error-diff-group-shared">
        <div
          class="border-border-default flex items-baseline justify-between gap-1.5 border-b pb-1"
        >
          <span class="flex items-baseline gap-1.5">
            <span class="text-text-secondary text-xs font-semibold uppercase">
              {{ t("aiObservability.errorDiff.shared") }}
            </span>
          </span>
          <span class="text-2xs inline-flex items-center gap-1">
            <span class="text-accent font-medium">{{ labelA }}</span>
            <span class="text-text-muted">→</span>
            <span class="text-series-b font-medium">{{ labelB }}</span>
          </span>
        </div>
        <ul class="mt-1.5 flex flex-col gap-1">
          <li
            v-for="row in errorDiff!.shared"
            :key="row.fail_class"
            class="text-text-body flex items-center justify-between gap-2 text-sm"
            :data-test="`version-error-diff-row-shared-${row.fail_class}`"
          >
            <span class="truncate">{{ row.fail_class }}</span>
            <span class="inline-flex shrink-0 items-center gap-1 tabular-nums">
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

// Shared-row delta is `count_a − count_b`, and B is the NEWER version. So the
// change from A→B is the negation: B has MORE errors when delta<0 (count rose in
// the new version = WORSE, red ▲) and FEWER when delta>0 (count fell = BETTER,
// green ▼). The arrow points the direction the count moved from A to B.
function sharedDeltaColorClass(delta: number): string {
  if (delta < 0) return "text-error-600"; // B > A → more errors in the new version
  if (delta > 0) return "text-success-600"; // B < A → fewer errors in the new version
  return "text-text-secondary";
}

function sharedDeltaSymbol(delta: number): string {
  if (delta < 0) return "▲"; // rose in B
  if (delta > 0) return "▼"; // fell in B
  return "—";
}
</script>
