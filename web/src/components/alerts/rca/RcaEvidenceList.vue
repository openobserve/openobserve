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
  <section data-test="rca-evidence-list" :aria-labelledby="headingId" class="flex flex-col">
    <div class="mb-2.5 flex flex-wrap items-center gap-2">
      <h3 :id="headingId" class="text-text-heading m-0 text-base font-bold">
        {{ t("alerts.incidents.rcaSummary.evidence") }}
      </h3>
      <span class="text-text-secondary text-xs">
        {{
          t("alerts.incidents.rcaSummary.evidenceCount", {
            count: evidence.length,
            decisive: decisiveCount,
          })
        }}
      </span>
      <span class="flex-1" />
      <OToggleGroup
        v-if="evidence.length > 0"
        :model-value="filter"
        data-test="rca-evidence-filter"
        :aria-label="t('alerts.incidents.rcaSummary.evidenceFilter')"
        @update:model-value="
          (value) => {
            if (value === 'all' || value === 'decisive' || value === 'supporting') filter = value;
          }
        "
      >
        <OToggleGroupItem
          v-for="option in filterOptions"
          :key="option.value"
          :value="option.value"
          :data-test="`rca-evidence-filter-${option.value}`"
          size="sm"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <p
      v-if="evidence.length === 0"
      data-test="rca-evidence-empty"
      class="text-text-muted text-compact m-0"
    >
      {{ t("alerts.incidents.rcaSummary.noEvidence") }}
    </p>
    <ul
      v-else
      class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y overflow-hidden border p-0"
    >
      <RcaFoldRow
        v-for="entry in shown"
        :key="entry.number"
        :ref="(el) => setRowRef(entry.number, el)"
        data-test="rca-evidence-entry"
        :data-number="entry.number"
        :class="{ 'bg-surface-tint-accent': opened.has(entry.number) }"
        :open="opened.has(entry.number)"
        @update:open="toggle(entry.number)"
      >
        <template #lead>
          <span
            class="rounded-default border-border-control text-3xs inline-grid h-5 min-w-5.5 shrink-0 place-items-center border font-mono font-semibold"
          >
            {{ entry.number }}
          </span>
        </template>
        <span class="font-normal"><RcaInlineText :text="claim(entry)" /></span>
        <template #meta>
          <RcaPill :tone="entry.decisive ? 'strong' : 'neutral'">
            {{
              entry.decisive
                ? t("alerts.incidents.rcaSummary.decisive")
                : t("alerts.incidents.rcaSummary.supporting")
            }}
          </RcaPill>
        </template>
        <template #body>
          <RcaEvidenceCard
            :entry="entry"
            :hypotheses="hypotheses"
            :org="org"
            with-header
            @open-hypothesis="$emit('open-hypothesis', $event)"
          />
        </template>
      </RcaFoldRow>
    </ul>

    <div
      v-if="unverified.length > 0"
      ref="unverifiedSection"
      data-test="rca-unverified"
      class="mt-4 flex flex-col"
      tabindex="-1"
    >
      <h4 class="text-text-heading m-0 mb-2 text-sm font-bold">
        {{ t("alerts.incidents.rcaSummary.citedNotVerified") }}
        <span class="text-text-secondary text-xs font-normal">{{ unverified.length }}</span>
      </h4>
      <ul
        class="rounded-default border-border-default bg-surface-base divide-border-default m-0 list-none divide-y border border-dashed p-0"
      >
        <li
          v-for="item in unverified"
          :key="`${item.hypothesis_id}:${item.evidence_id}`"
          data-test="rca-unverified-entry"
          class="flex flex-col gap-1 px-3.5 py-2.5"
        >
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-status-warning-text font-mono font-semibold">{{
              item.evidence_id
            }}</span>
            <span class="text-text-secondary font-mono">{{ item.tool }}</span>
            <span
              v-if="item.ref"
              data-test="rca-unverified-ref"
              class="text-text-secondary font-mono"
              >{{ t("alerts.incidents.rcaSummary.unverifiedRef", { ref: item.ref }) }}</span
            >
            <RcaPill tone="warn-dash">{{ reasonLabel(item.reason) }}</RcaPill>
          </div>
          <pre
            v-if="item.query"
            class="text-text-body m-0 font-mono text-xs break-words whitespace-pre-wrap"
            >{{ item.query }}</pre>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, type ComponentPublicInstance } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";
import type {
  RcaEvidenceEntry,
  RcaSummaryHypothesis,
  RcaUnverifiedCitation,
} from "@/services/incidents";
import {
  filterRcaEvidence,
  rcaEvidenceClaim,
  type RcaEvidenceFilter,
} from "@/utils/incidents/rcaSummary";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import RcaFoldRow from "./RcaFoldRow.vue";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";

const props = defineProps<{
  evidence: RcaEvidenceEntry[];
  unverified: RcaUnverifiedCitation[];
  hypotheses: RcaSummaryHypothesis[];
  org: string;
}>();

defineEmits<{
  /** A citation's hypothesis link was clicked. */
  "open-hypothesis": [hypothesisId: string];
}>();

const { t } = useI18nTyped();
const headingId = useId();

const filter = ref<RcaEvidenceFilter>("all");
const decisiveCount = computed(() => props.evidence.filter((entry) => entry.decisive).length);
const filterOptions = computed(() => [
  { value: "all" as const, label: t("alerts.incidents.rcaSummary.filterAll") },
  {
    value: "decisive" as const,
    label: t("alerts.incidents.rcaSummary.filterDecisive", { count: decisiveCount.value }),
  },
  { value: "supporting" as const, label: t("alerts.incidents.rcaSummary.filterSupporting") },
]);
const shown = computed(() => filterRcaEvidence(props.evidence, filter.value));

const opened = ref(new Set<number>());
const toggle = (number: number) => {
  const next = new Set(opened.value);
  if (!next.delete(number)) next.add(number);
  opened.value = next;
};

const claim = rcaEvidenceClaim;

const rows = new Map<number, HTMLElement>();
const setRowRef = (number: number, el: Element | ComponentPublicInstance | null) => {
  const node = el && "$el" in el ? el.$el : el;
  if (node instanceof HTMLElement) rows.set(number, node);
  else rows.delete(number);
};

const unverifiedSection = ref<HTMLElement | null>(null);

const reasonLabel = (reason: RcaUnverifiedCitation["reason"]) => {
  switch (reason) {
    case "failed":
      return t("alerts.incidents.rcaSummary.unverifiedFailed");
    case "ambiguous":
      return t("alerts.incidents.rcaSummary.unverifiedAmbiguous");
    case "not_run":
      return t("alerts.incidents.rcaSummary.unverifiedNotRun");
  }
};

/** Opens entry `number` and scrolls it into view (a thread chip). */
const openEntry = async (number: number) => {
  if (!props.evidence.some((entry) => entry.number === number)) return;
  if (!filterRcaEvidence(props.evidence, filter.value).some((e) => e.number === number)) {
    filter.value = "all";
  }
  opened.value = new Set(opened.value).add(number);
  await nextTick();
  rows.get(number)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

/** Scrolls to "Cited but not verified" (the band chip). */
const showUnverified = async () => {
  await nextTick();
  unverifiedSection.value?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  unverifiedSection.value?.focus({ preventScroll: true });
};

defineExpose({ openEntry, showUnverified });
</script>
