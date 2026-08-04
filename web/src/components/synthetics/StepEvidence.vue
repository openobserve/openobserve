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

<script setup lang="ts">
/**
 * What the runner saw when a step failed (spec P5.4, items 3–5).
 *
 * The probe has written all of this on every failed run since Phase 5 and the
 * results view rendered none of it, so every failure looked the same: a timeout
 * string and a screenshot. Neither describes the application — the error says
 * what the runner was waiting for, and the screenshot shows the symptom.
 *
 * The blocks below are ordered by how directly they answer "is this the
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
 *
 * A third block, **settle timing**, used to sit between them: this run's settle
 * time against the baseline recording observed. It is gone because it could
 * almost never do its job. `observed_duration_ms` is written PER FAILURE, not
 * per step, so only the one failing step ever had a baseline; every other step
 * rendered a half-finished sentence with a dash where the comparison belonged.
 * Reviving it needs the probe to write that baseline per step — not another
 * pass at the rendering. `settleMs` is still on the record for whoever does.
 *
 * No verdict anywhere. The ordering is the guidance — presenting evidence and
 * letting the engineer conclude is the deliberate posture (spec X-6 permits one
 * heuristic in the whole system, and this is not it).
 *
 * ---
 *
 * CARD CHROME. Every section below is the house sectioned card: a bordered
 * container that CLIPS (`overflow-hidden`), a header strip carrying the title
 * and its qualifiers, a full-bleed `border-b` under that strip, then the body.
 * Padding sits on the header and body, never on the container — that is what
 * makes the divider run edge to edge instead of stopping short at a container
 * inset. Same structure as the Scorer/Job form sections and the Monitor Runs
 * breakdown cards; the class strings are repeated per section rather than
 * hoisted, matching how those files do it.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  FailureDetail,
  StepEvidence as StepEvidenceSummary,
} from "@/composables/synthetics/syntheticResultsSchema";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  detail: FailureDetail;
  /** Browser-side evidence for this step, when the probe captured any. */
  evidence?: StepEvidenceSummary | null;
  /** True when the capture cap bound during the run (X-8.2). */
  truncated?: boolean;
}>();

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

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Anything worth reading in the browser-side evidence for this step. */
const hasEvidence = computed(() => {
  const e = props.evidence;
  if (!e) return false;
  return e.consoleErrors > 0 || e.pageErrors > 0 || e.requestsFailed > 0 || e.responsesNon2xx > 0;
});

function outcomeVariant(outcome: string): "success" | "error" | "default" {
  if (outcome === "matched") return "success";
  if (outcome === "not_found") return "error";
  return "default";
}

/**
 * Raw enum values are the probe's vocabulary, not the reader's. `used_as_primary`
 * in a neutral badge said nothing about whether a fallback existed, which is the
 * one question a failed locator raises.
 */
const OUTCOME_LABEL: Record<string, string> = {
  matched: "synthetics.runDetail.locatorOutcomeMatched",
  not_found: "synthetics.runDetail.locatorOutcomeNotFound",
  used_as_primary: "synthetics.runDetail.locatorOutcomePrimary",
  not_tried: "synthetics.runDetail.locatorOutcomeNotTried",
};

function outcomeLabel(outcome: string): string {
  const key = OUTCOME_LABEL[outcome];
  // An outcome this UI does not know about is shown verbatim rather than
  // dropped — a new probe value must not render as a blank badge.
  return key ? t(key) : outcome;
}

/** How far down the ladder the probe actually got. */
const triedCount = computed(() => candidates.value.filter((c) => c.outcome !== "not_tried").length);

/**
 * One authored locator and no second rung.
 *
 * Distinct from "every candidate failed": there was nothing to fall back TO,
 * which is a property of how the step was recorded rather than of the page. On
 * the run that prompted this, every assert step in the journey was built this
 * way, and the panel had no way to say so.
 */
const noFallback = computed(() => candidates.value.length === 1);
</script>

<template>
  <div class="flex flex-col gap-3" data-test="synthetics-run-detail-step-evidence">
    <!-- Item 3: which locator candidates were tried, and what happened. -->
    <section
      v-if="candidates.length"
      class="card-container rounded-default border-border-default bg-card-glass-bg flex flex-col overflow-hidden border"
      data-test="synthetics-run-detail-locator-resolution"
    >
      <!-- Heading and finding on one line. The count answers "was a fallback
           tried?" before any row is read — "1 of 3 tried" and "1 of 1 tried" are
           different findings — and the verdict that follows it is the same
           sentence continued, so stacking them read as two separate remarks. -->
      <div class="border-border-default flex flex-wrap items-baseline gap-x-2 border-b px-3 py-2">
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("synthetics.runDetail.locatorResolution") }}
        </h4>
        <span class="text-text-secondary text-xs" data-test="synthetics-run-detail-locator-count">
          {{
            t("synthetics.runDetail.locatorTriedOf", {
              tried: triedCount,
              total: candidates.length,
            })
          }}
        </span>
        <span
          v-if="noneMatched"
          class="text-text-secondary text-xs"
          data-test="synthetics-run-detail-locator-none-matched"
        >
          {{ `\u00b7 ${t("synthetics.runDetail.locatorNoneMatched")}` }}
        </span>
        <span
          v-else-if="healed"
          class="text-text-secondary text-xs"
          data-test="synthetics-run-detail-locator-healed"
        >
          {{ `\u00b7 ${t("synthetics.runDetail.locatorHealed")}` }}
        </span>
      </div>
      <div class="flex flex-col gap-2 px-3 py-2.5">
        <!-- A step with one locator did not "fail to heal" — it had nothing to
             heal with. That is a recording property, and it is actionable in a
             way the outcome badge never was. -->
        <p
          v-if="noFallback"
          class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
          data-test="synthetics-run-detail-locator-no-fallback"
        >
          <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{{ t("synthetics.runDetail.locatorNoFallback") }}</span>
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <!-- Untried rungs are dimmed, not hidden: the same treatment a skipped
               step gets in the timeline. Hiding them would restore exactly the
               ambiguity this section exists to remove. -->
          <li
            v-for="(c, i) in candidates"
            :key="`${c.kind}-${i}`"
            class="flex items-center gap-2 text-xs"
            :class="c.outcome === 'not_tried' ? 'opacity-50' : ''"
            data-test="synthetics-run-detail-locator-candidate"
          >
            <OBadge :variant="outcomeVariant(c.outcome)" size="sm">{{
              outcomeLabel(c.outcome)
            }}</OBadge>
            <span class="text-text-secondary shrink-0">{{ c.kind }}</span>
            <span class="text-text-body min-w-0 flex-1 truncate font-mono">{{ c.value }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Item 4: which recorded signals arrived, and which did not. -->
    <section
      v-if="signals.length"
      class="card-container rounded-default border-border-default bg-card-glass-bg flex flex-col overflow-hidden border"
      data-test="synthetics-run-detail-settle-signals"
    >
      <!-- The stale note qualifies the heading rather than following it: a
           recorded signal that never arrived is what the list below is FOR. -->
      <div
        class="border-border-default flex flex-wrap items-baseline items-center gap-x-2 border-b px-3 py-2"
      >
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("synthetics.runDetail.settleSignals") }}
        </h4>
        <OTooltip :content="t('synthetics.runDetail.settleStaleNote')">
          <span
            v-if="staleSignals.length"
            class="text-status-warning-text flex items-start gap-1 text-xs"
            data-test="synthetics-run-detail-settle-stale-note"
          >
            <OIcon name="warning" size="sm" class="shrink-0" aria-hidden="true" />
          </span>
        </OTooltip>
      </div>
      <div class="flex flex-col gap-2 px-3 py-2.5">
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li
            v-for="(s, i) in signals"
            :key="`${s.signal}-${i}`"
            class="flex items-center gap-2 text-xs"
          >
            <OBadge :variant="s.status === 'fired' ? 'success' : 'error'" size="sm">
              {{ s.status }}
            </OBadge>
            <span class="text-text-body min-w-0 flex-1 truncate font-mono">{{ s.signal }}</span>
            <span class="text-text-secondary shrink-0">{{ fmtMs(s.waitedMs) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!--
      What the page SAID and what it ASKED FOR (design §5.2). Items 1-3 above
      describe the runner's experience; these describe the application's, which
      is the difference between "an element did not appear" and "the login call
      returned 503".
    -->
    <section
      v-if="hasEvidence"
      class="card-container rounded-default border-border-default bg-card-glass-bg flex flex-col overflow-hidden border"
      data-test="synthetics-run-detail-app-evidence"
    >
      <div class="border-border-default flex flex-wrap items-baseline gap-x-2 border-b px-3 py-2">
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("synthetics.runDetail.applicationEvidence") }}
        </h4>
      </div>
      <div class="flex flex-col gap-2 px-3 py-2.5">
        <!-- Non-2xx first: ordering is the guidance, since there is no verdict. -->
        <ul
          v-if="evidence!.worstResponses.length"
          class="m-0 flex list-none flex-col gap-1 p-0"
          data-test="synthetics-run-detail-worst-responses"
        >
          <li
            v-for="(r, i) in evidence!.worstResponses"
            :key="`${r.method}-${r.url}-${i}`"
            class="flex items-center gap-2 text-xs"
          >
            <OBadge variant="error" size="sm">{{ r.status }}</OBadge>
            <span class="text-text-secondary shrink-0">{{ r.method }}</span>
            <span class="text-text-body min-w-0 flex-1 truncate font-mono">{{ r.url }}</span>
            <span v-if="r.count > 1" class="text-text-secondary shrink-0">x{{ r.count }}</span>
          </li>
        </ul>

        <ul
          v-if="evidence!.firstConsoleErrors.length"
          class="m-0 flex list-none flex-col gap-1 p-0"
          data-test="synthetics-run-detail-console-errors"
        >
          <li
            v-for="(line, i) in evidence!.firstConsoleErrors"
            :key="i"
            class="text-text-body font-mono text-xs break-words"
          >
            {{ line }}
          </li>
        </ul>

        <p class="text-text-secondary m-0 text-xs">
          {{
            t("synthetics.runDetail.evidenceCounts", {
              consoleErrors: evidence!.consoleErrors,
              pageErrors: evidence!.pageErrors,
              failed: evidence!.requestsFailed,
              nonOk: evidence!.responsesNon2xx,
            })
          }}
        </p>
      </div>
    </section>

    <!-- X-8.2: reduced fidelity is reported, never silent. -->
    <p
      v-if="truncated"
      class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
      data-test="synthetics-run-detail-evidence-truncated"
    >
      <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{{ t("synthetics.runDetail.evidenceTruncated") }}</span>
    </p>
  </div>
</template>
