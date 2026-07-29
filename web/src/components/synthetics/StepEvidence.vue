<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * What the runner saw when a step failed (spec P5.4, items 3–5).
 *
 * The probe has written all of this on every failed run since Phase 5 and the
 * results view rendered none of it, so every failure looked the same: a timeout
 * string and a screenshot. Neither describes the application — the error says
 * what the runner was waiting for, and the screenshot shows the symptom.
 *
 * The three blocks below are ordered by how directly they answer "is this the
 * application, or is this us?":
 *
 *  1. **Locator resolution** answers "locator rot?" mechanically. If candidate 1
 *     was not found and candidate 3 matched, the markup changed and the step
 *     healed. If every candidate was not found, the element genuinely was not
 *     there.
 *  2. **Settle signals** are the strongest application-is-at-fault indicator
 *     already on the record. A stale `**\/auth/login` response says the page
 *     never got the response it depended on — a categorically different
 *     statement from "an element did not appear".
 *  3. **Settle timing** separates slow-but-healthy from broken on one line:
 *     "settled in 2.3 s when recorded, 41 s today".
 *
 * No verdict anywhere. The ordering is the guidance — presenting evidence and
 * letting the engineer conclude is the deliberate posture (spec X-6 permits one
 * heuristic in the whole system, and this is not it).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FailureDetail } from "@/composables/synthetics/syntheticResultsSchema";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{ detail: FailureDetail }>();

const { t } = useI18n();

const candidates = computed(() => props.detail.candidatesTried ?? []);
const signals = computed(() => props.detail.settleSignals ?? []);

/** True when no candidate resolved — the element was genuinely absent. */
const noneMatched = computed(
  () => candidates.value.length > 0 && candidates.value.every((c) => c.outcome === "not_found"),
);

/**
 * The step used a fallback, so the markup moved under it.
 *
 * Only meaningful when something matched at a rank below the primary — that is
 * the definition of healing, and it is a different diagnosis from "not found".
 */
const healed = computed(() => {
  const i = candidates.value.findIndex((c) => c.outcome === "matched");
  return i > 0;
});

const staleSignals = computed(() => signals.value.filter((s) => s.status === "stale"));

/** Settling cost far more than it did when recorded — slow, not necessarily broken. */
const settleRatio = computed(() => {
  const now = props.detail.settleMs;
  const then = props.detail.observedDurationMs;
  if (!now || !then || then <= 0) return null;
  return now / then;
});

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function outcomeVariant(outcome: string): "success" | "error" | "default" {
  if (outcome === "matched") return "success";
  if (outcome === "not_found") return "error";
  return "default";
}
</script>

<template>
  <div class="flex flex-col gap-3" data-test="synthetics-run-detail-step-evidence">
    <!-- Item 3: which locator candidates were tried, and what happened. -->
    <section v-if="candidates.length" data-test="synthetics-run-detail-locator-resolution">
      <h4 class="text-text-heading m-0 mb-1 text-xs font-semibold">
        {{ t("synthetics.runDetail.locatorResolution") }}
      </h4>
      <p
        v-if="noneMatched"
        class="text-text-secondary m-0 mb-1 text-xs"
        data-test="synthetics-run-detail-locator-none-matched"
      >
        {{ t("synthetics.runDetail.locatorNoneMatched") }}
      </p>
      <p
        v-else-if="healed"
        class="text-text-secondary m-0 mb-1 text-xs"
        data-test="synthetics-run-detail-locator-healed"
      >
        {{ t("synthetics.runDetail.locatorHealed") }}
      </p>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li
          v-for="(c, i) in candidates"
          :key="`${c.kind}-${i}`"
          class="flex items-center gap-2 text-xs"
        >
          <OBadge :variant="outcomeVariant(c.outcome)" size="sm">{{ c.outcome }}</OBadge>
          <span class="text-text-secondary shrink-0">{{ c.kind }}</span>
          <span class="text-text-body min-w-0 flex-1 truncate font-mono">{{ c.value }}</span>
        </li>
      </ul>
    </section>

    <!-- Item 4: which recorded signals arrived, and which did not. -->
    <section v-if="signals.length" data-test="synthetics-run-detail-settle-signals">
      <h4 class="text-text-heading m-0 mb-1 text-xs font-semibold">
        {{ t("synthetics.runDetail.settleSignals") }}
      </h4>
      <p
        v-if="staleSignals.length"
        class="text-status-warning-text m-0 mb-1 flex items-start gap-1 text-xs"
        data-test="synthetics-run-detail-settle-stale-note"
      >
        <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{{ t("synthetics.runDetail.settleStaleNote") }}</span>
      </p>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li v-for="(s, i) in signals" :key="`${s.signal}-${i}`" class="flex items-center gap-2 text-xs">
          <OBadge :variant="s.status === 'fired' ? 'success' : 'error'" size="sm">
            {{ s.status }}
          </OBadge>
          <span class="text-text-body min-w-0 flex-1 truncate font-mono">{{ s.signal }}</span>
          <span class="text-text-secondary shrink-0">{{ fmtMs(s.waitedMs) }}</span>
        </li>
      </ul>
    </section>

    <!-- Item 5: what settling cost today, against what recording observed. -->
    <section
      v-if="detail.settleMs !== null || detail.observedDurationMs !== null"
      data-test="synthetics-run-detail-settle-timing"
    >
      <h4 class="text-text-heading m-0 mb-1 text-xs font-semibold">
        {{ t("synthetics.runDetail.settleTiming") }}
      </h4>
      <p class="text-text-secondary m-0 text-xs">
        {{
          t("synthetics.runDetail.settleTimingValue", {
            now: fmtMs(detail.settleMs),
            recorded: fmtMs(detail.observedDurationMs),
          })
        }}
        <span
          v-if="settleRatio && settleRatio >= 2"
          class="text-status-warning-text"
          data-test="synthetics-run-detail-settle-slower"
        >
          {{ t("synthetics.runDetail.settleSlower", { times: settleRatio.toFixed(1) }) }}
        </span>
      </p>
    </section>
  </div>
</template>
