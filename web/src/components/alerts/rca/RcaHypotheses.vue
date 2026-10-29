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
  <section
    ref="section"
    data-test="rca-hypotheses"
    :aria-labelledby="headingId"
    class="flex flex-col"
  >
    <div class="mb-1 flex items-baseline gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaSummary.hypotheses") }}
      </h3>
      <span class="text-text-secondary text-xs">{{ hypotheses.length }}</span>
    </div>

    <p
      v-if="hypotheses.length === 0"
      data-test="rca-hypotheses-empty"
      class="text-text-secondary text-compact m-0 mt-2"
    >
      {{ t("alerts.incidents.rcaSummary.noHypotheses") }}
    </p>

    <div
      v-for="group in groups"
      :key="group.id"
      data-test="rca-hypothesis-group"
      :data-group="group.id"
    >
      <h4 class="text-text-secondary mt-3 mb-1.5 flex items-center gap-1.5 text-xs font-bold">
        {{ rcaHypothesisGroupTitle(group.id, live) }}
        <span
          class="bg-surface-tint-neutral text-text-secondary text-3xs inline-flex h-4.5 items-center rounded-full px-1.5"
        >
          {{ group.items.length }}
        </span>
      </h4>
      <ul
        class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y border p-0"
      >
        <li
          v-for="hypothesis in group.items"
          :key="hypothesis.id"
          data-test="rca-hypothesis"
          :data-status="hypothesis.status"
          :data-hypothesis-id="hypothesis.id"
          tabindex="-1"
          class="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-2.5 transition-colors duration-700 outline-none"
          :class="{ 'bg-surface-tint-accent': highlighted === hypothesis.id }"
        >
          <!-- The status column wraps a long label ("Root cause · not confirmed"). -->
          <span class="min-w-0 pt-px">
            <RcaPill
              data-test="rca-hypothesis-status"
              :tone="RCA_HYPOTHESIS_TONE[hypothesis.status]"
              wrap
            >
              {{ rcaHypothesisStatusLabel(hypothesis.status, outcome) }}
            </RcaPill>
          </span>

          <div class="min-w-0">
            <div
              data-test="rca-hypothesis-statement"
              class="text-sm font-semibold"
              :class="
                hypothesis.status === 'ruled_out' ? 'text-text-secondary' : 'text-text-heading'
              "
            >
              <RcaInlineText :text="hypothesis.statement" />
            </div>
            <div
              v-if="hypothesis.reason"
              class="text-text-secondary text-compact [text-wrap:pretty]"
            >
              <RcaInlineText :text="hypothesis.reason" />
            </div>

            <template v-if="hypothesis.history.length > 0">
              <button
                type="button"
                data-test="rca-hypothesis-history-toggle"
                class="text-text-secondary mt-1 flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs"
                :aria-expanded="historyOpen.has(hypothesis.id)"
                :aria-controls="historyId(hypothesis.id)"
                @click="toggleHistory(hypothesis.id)"
              >
                <OIcon
                  :name="historyOpen.has(hypothesis.id) ? 'expand-less' : 'expand-more'"
                  size="sm"
                />
                {{
                  t("alerts.incidents.rcaSummary.statusHistory", {
                    count: hypothesis.history.length,
                  })
                }}
              </button>
              <ol
                v-if="historyOpen.has(hypothesis.id)"
                :id="historyId(hypothesis.id)"
                data-test="rca-hypothesis-history"
                class="text-text-secondary m-0 mt-1 flex list-none flex-col gap-0.5 p-0 font-mono text-xs"
              >
                <li v-for="(change, idx) in hypothesis.history" :key="idx">
                  {{ rcaStatusHistoryLine(change) }}
                </li>
              </ol>
            </template>

            <RcaEvidenceCard
              v-if="open?.hypothesisId === hypothesis.id && openEntry"
              :id="cardId(hypothesis.id)"
              class="mt-2"
              :entry="openEntry"
              :hypotheses="hypotheses"
              :hypothesis-id="hypothesis.id"
              @open-hypothesis="showHypothesis"
              :org="org"
              with-header
            />
          </div>

          <div class="flex flex-wrap items-center justify-end gap-1 pt-px">
            <button
              v-for="number in hypothesis.evidence_numbers"
              :key="number"
              type="button"
              data-test="rca-hypothesis-chip"
              class="rounded-default text-3xs inline-grid h-5 min-w-5.5 cursor-pointer place-items-center border px-1.5 font-mono font-semibold"
              :class="
                isOpen(hypothesis.id, number)
                  ? 'bg-accent text-text-inverse border-transparent'
                  : 'border-border-control bg-surface-base text-text-heading hover:bg-surface-subtle-hover'
              "
              :aria-expanded="isOpen(hypothesis.id, number)"
              :aria-controls="isOpen(hypothesis.id, number) ? cardId(hypothesis.id) : undefined"
              :aria-label="t('alerts.incidents.rcaSummary.openEvidence', { number })"
              @click="toggle(hypothesis.id, number)"
            >
              {{ number }}
            </button>
            <span
              v-for="id in hypothesis.unverified_ids"
              :key="id"
              data-test="rca-hypothesis-unverified"
              class="rounded-default border-status-warning-text text-status-warning-text text-3xs inline-flex h-5 items-center border border-dashed px-1.5 font-mono font-semibold"
            >
              {{ t("alerts.incidents.rcaSummary.notVerifiedId", { id }) }}
            </span>
            <span
              v-if="
                hypothesis.evidence_numbers.length === 0 && hypothesis.unverified_ids.length === 0
              "
              class="text-text-muted text-xs"
            >
              {{ t("alerts.incidents.rcaSummary.noEvidenceYet") }}
            </span>
            <template v-if="canSteer">
              <OButton
                v-for="action in rcaHypothesisActions(hypothesis.status)"
                :key="action"
                :data-test="`rca-hypothesis-action-${action}`"
                variant="outline"
                size="xs"
                :disabled="sending || pending.has(hypothesis.id)"
                :aria-label="actionAriaLabel(action, hypothesis.statement)"
                @click="$emit('steer-action', { hypothesisId: hypothesis.id, action })"
              >
                {{ ACTION_LABEL[action] }}
              </OButton>
            </template>
            <span
              v-if="pending.has(hypothesis.id)"
              data-test="rca-hypothesis-pending"
              class="text-text-secondary text-xs font-semibold"
            >
              {{
                t("alerts.incidents.rcaSteer.action.pending", {
                  author: pending.get(hypothesis.id) ?? "",
                })
              }}
            </span>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  RcaEvidenceEntry,
  RcaOutcome,
  RcaSteerAction,
  RcaSummaryHypothesis,
} from "@/services/incidents";
import {
  RCA_HYPOTHESIS_TONE,
  groupRcaHypotheses,
  rcaHypothesisGroupTitle,
  rcaHypothesisStatusLabel,
  rcaStatusHistoryLine,
} from "@/utils/incidents/rcaSummary";
import { rcaHypothesisActions } from "@/utils/incidents/rcaSteering";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";

const props = withDefaults(
  defineProps<{
    hypotheses: RcaSummaryHypothesis[];
    outcome?: RcaOutcome;
    evidence: RcaEvidenceEntry[];
    org: string;
    /** The run is live: the open group reads "Being tested". */
    live: boolean;
    /** The run takes messages and the user may send them: rows offer actions. */
    canSteer?: boolean;
    /** Hypothesis id → local part of the author of its unread action. */
    pending?: Map<string, string>;
    /** An action is being sent. */
    sending?: boolean;
  }>(),
  { outcome: undefined, canSteer: false, pending: () => new Map(), sending: false },
);

defineEmits<{
  "steer-action": [request: { hypothesisId: string; action: RcaSteerAction }];
}>();

const { t } = useI18nTyped();
const headingId = useId();
const baseId = useId();
const section = ref<HTMLElement | null>(null);

const ACTION_LABEL: Record<RcaSteerAction, I18nText> = {
  disprove: t("alerts.incidents.rcaSteer.action.disprove"),
  reopen: t("alerts.incidents.rcaSteer.action.reopen"),
  test_first: t("alerts.incidents.rcaSteer.action.testFirst"),
};

const actionAriaLabel = (action: RcaSteerAction, statement: string): I18nText => {
  switch (action) {
    case "disprove":
      return t("alerts.incidents.rcaSteer.action.disproveLabel", { statement });
    case "reopen":
      return t("alerts.incidents.rcaSteer.action.reopenLabel", { statement });
    case "test_first":
      return t("alerts.incidents.rcaSteer.action.testFirstLabel", { statement });
  }
};

const groups = computed(() => groupRcaHypotheses(props.hypotheses, props.outcome));

const historyOpen = ref(new Set<string>());
const toggleHistory = (id: string) => {
  const next = new Set(historyOpen.value);
  if (!next.delete(id)) next.add(id);
  historyOpen.value = next;
};
const historyId = (id: string) => `${baseId}-history-${id}`;

const open = ref<{ hypothesisId: string; number: number } | null>(null);
const isOpen = (hypothesisId: string, number: number) =>
  open.value?.hypothesisId === hypothesisId && open.value.number === number;
const toggle = (hypothesisId: string, number: number) => {
  open.value = isOpen(hypothesisId, number) ? null : { hypothesisId, number };
};
const cardId = (id: string) => `${baseId}-card-${id}`;

const openEntry = computed(
  () => props.evidence.find((entry) => entry.number === open.value?.number) ?? null,
);

const highlighted = ref<string | null>(null);
let highlightTimer: number | undefined;
/** Scrolls to a hypothesis row, focuses it and tints it briefly (an evidence link). */
const showHypothesis = (id: string) => {
  const rows = section.value?.querySelectorAll<HTMLElement>("[data-hypothesis-id]") ?? [];
  const row = [...rows].find((el) => el.dataset.hypothesisId === id);
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.focus({ preventScroll: true });
  highlighted.value = id;
  clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => (highlighted.value = null), 1_500);
};
onUnmounted(() => clearTimeout(highlightTimer));

defineExpose({ showHypothesis });
</script>
