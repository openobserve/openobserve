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

    <ul
      v-if="rows.length > 0"
      class="rounded-default border-border-default bg-surface-base divide-border-default m-0 mt-1.5 list-none divide-y border p-0"
    >
      <RcaFoldRow
        v-for="{ hypothesis, group } in rows"
        :key="hypothesis.id"
        data-test="rca-hypothesis"
        :data-status="hypothesis.status"
        :data-group="group"
        :data-hypothesis-id="hypothesis.id"
        tabindex="-1"
        class="transition-colors duration-700 outline-none"
        :class="{ 'bg-surface-tint-accent': highlighted === hypothesis.id }"
        :muted="hypothesis.status === 'ruled_out'"
        :open="expanded.has(hypothesis.id)"
        @update:open="setExpanded(hypothesis.id, $event)"
      >
        <template #lead>
          <span class="w-32 shrink-0">
            <RcaPill
              data-test="rca-hypothesis-status"
              :tone="RCA_HYPOTHESIS_TONE[hypothesis.status]"
              wrap
            >
              {{ rcaHypothesisStatusLabel(hypothesis.status, outcome) }}
            </RcaPill>
          </span>
        </template>
        <span data-test="rca-hypothesis-statement">
          <RcaInlineText :text="hypothesis.statement" />
        </span>
        <template #meta>
          <span
            data-test="rca-hypothesis-evidence-count"
            class="text-text-secondary shrink-0 text-xs font-normal"
          >
            {{ evidenceCount(hypothesis) }}
          </span>
        </template>
        <template v-if="canSteer || pending.has(hypothesis.id)" #actions>
          <span class="flex shrink-0 items-center gap-1">
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
          </span>
        </template>
        <template #body>
          <div
            v-if="hypothesis.reason"
            class="text-text-secondary text-compact ps-35 [text-wrap:pretty] max-md:ps-0"
          >
            <RcaInlineText :text="hypothesis.reason" />
          </div>
          <div class="flex flex-wrap items-center gap-1 ps-35 max-md:ps-0">
            <OButton
              v-for="number in hypothesis.evidence_numbers"
              :key="number"
              data-test="rca-hypothesis-chip"
              :variant="isOpen(hypothesis.id, number) ? 'primary' : 'outline'"
              size="icon-xs-sq"
              class="font-mono"
              :aria-expanded="isOpen(hypothesis.id, number)"
              :aria-controls="isOpen(hypothesis.id, number) ? cardId(hypothesis.id) : undefined"
              :aria-label="t('alerts.incidents.rcaSummary.openEvidence', { number })"
              @click="toggle(hypothesis.id, number)"
            >
              {{ number }}
            </OButton>
            <span
              v-for="id in hypothesis.unverified_ids"
              :key="id"
              data-test="rca-hypothesis-unverified"
              class="rounded-default border-status-warning-text text-status-warning-text text-3xs inline-flex h-5 items-center border border-dashed px-1.5 font-mono font-semibold"
            >
              {{ t("alerts.incidents.rcaSummary.notVerifiedId") }}
            </span>
            <span
              v-if="
                hypothesis.evidence_numbers.length === 0 && hypothesis.unverified_ids.length === 0
              "
              class="text-text-muted text-xs"
            >
              {{ t("alerts.incidents.rcaSummary.noEvidenceYet") }}
            </span>
            <OButton
              v-if="hypothesis.history.length > 0"
              data-test="rca-hypothesis-history-toggle"
              variant="ghost-primary"
              size="xs"
              class="ms-2"
              :icon-left="historyOpen.has(hypothesis.id) ? 'expand-less' : 'expand-more'"
              :aria-expanded="historyOpen.has(hypothesis.id)"
              :aria-controls="historyId(hypothesis.id)"
              @click="toggleHistory(hypothesis.id)"
            >
              {{
                t("alerts.incidents.rcaSummary.statusHistory", {
                  count: hypothesis.history.length,
                })
              }}
            </OButton>
          </div>
          <ol
            v-if="historyOpen.has(hypothesis.id)"
            :id="historyId(hypothesis.id)"
            data-test="rca-hypothesis-history"
            class="text-text-secondary m-0 flex list-none flex-col gap-0.5 p-0 ps-35 font-mono text-xs max-md:ps-0"
          >
            <li v-for="(change, idx) in hypothesis.history" :key="idx">
              {{ rcaStatusHistoryLine(change) }}
            </li>
          </ol>
          <RcaEvidenceCard
            v-if="open?.hypothesisId === hypothesis.id && openEntry"
            :id="cardId(hypothesis.id)"
            :entry="openEntry"
            :hypotheses="hypotheses"
            :hypothesis-id="hypothesis.id"
            :org="org"
            with-header
            @open-hypothesis="showHypothesis"
          />
        </template>
      </RcaFoldRow>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
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
  rcaHypothesisStatusLabel,
  rcaStatusHistoryLine,
} from "@/utils/incidents/rcaSummary";
import { rcaHypothesisActions } from "@/utils/incidents/rcaSteering";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import RcaFoldRow from "./RcaFoldRow.vue";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";

const props = withDefaults(
  defineProps<{
    hypotheses: RcaSummaryHypothesis[];
    outcome?: RcaOutcome;
    evidence: RcaEvidenceEntry[];
    org: string;
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

/** Rows in group order (explains, open, ruled out); the status pill names the group. */
const rows = computed(() =>
  groupRcaHypotheses(props.hypotheses, props.outcome).flatMap((group) =>
    group.items.map((hypothesis) => ({ hypothesis, group: group.id })),
  ),
);

const evidenceCount = (hypothesis: RcaSummaryHypothesis) => {
  const count = hypothesis.evidence_numbers.length;
  return t("alerts.incidents.rcaLight.evidenceCount", { count }, count);
};

const expanded = ref(new Set<string>());
const setExpanded = (id: string, value: boolean) => {
  const next = new Set(expanded.value);
  if (value) next.add(id);
  else next.delete(id);
  expanded.value = next;
};

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
/** Opens a hypothesis row, scrolls to it, focuses it and tints it briefly. */
const showHypothesis = async (id: string) => {
  setExpanded(id, true);
  await nextTick();
  const rowEls = section.value?.querySelectorAll<HTMLElement>("[data-hypothesis-id]") ?? [];
  const row = [...rowEls].find((el) => el.dataset.hypothesisId === id);
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
