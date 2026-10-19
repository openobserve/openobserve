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
      <span class="text-text-muted text-xs">
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
      <li
        v-for="entry in shown"
        :key="entry.number"
        :ref="(el) => setRowRef(entry.number, el)"
        data-test="rca-evidence-entry"
        :data-number="entry.number"
        :class="{ 'bg-surface-tint-accent': opened.has(entry.number) }"
      >
        <button
          type="button"
          data-test="rca-evidence-row"
          class="text-text-heading hover:bg-surface-subtle-hover grid w-full cursor-pointer grid-cols-[1.75rem_1.25rem_4rem_minmax(0,1fr)_auto_1.25rem] items-center gap-x-2.5 border-none bg-transparent py-2 ps-3.5 pe-3 text-start"
          :aria-expanded="opened.has(entry.number)"
          :aria-controls="rowId(entry.number)"
          @click="toggle(entry.number)"
        >
          <span
            class="rounded-default border-border-control text-3xs inline-grid h-5 min-w-5.5 place-items-center border font-mono font-semibold"
          >
            {{ entry.number }}
          </span>
          <OIcon :name="rcaEvidenceKindIcon(entry.kind)" size="sm" class="text-icon-color" />
          <span class="text-text-muted text-3xs font-mono font-bold uppercase">{{
            entry.kind
          }}</span>
          <span class="text-compact min-w-0 truncate">
            {{ rcaEvidenceTitle(entry) }}
            <span class="text-text-secondary">· {{ entry.result_summary }}</span>
          </span>
          <RcaPill :tone="entry.decisive ? 'strong' : 'neutral'">
            {{
              entry.decisive
                ? t("alerts.incidents.rcaSummary.decisive")
                : t("alerts.incidents.rcaSummary.supporting")
            }}
          </RcaPill>
          <OIcon
            :name="opened.has(entry.number) ? 'expand-less' : 'expand-more'"
            size="sm"
            class="text-icon-color"
          />
        </button>
        <div v-if="opened.has(entry.number)" :id="rowId(entry.number)" class="ps-12.5 pe-3.5 pb-3">
          <RcaEvidenceCard
            :entry="entry"
            :hypotheses="hypotheses"
            :org="org"
            @open-hypothesis="$emit('open-hypothesis', $event)"
          />
        </div>
      </li>
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
        <span class="text-text-muted text-xs font-normal">{{ unverified.length }}</span>
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
            <RcaPill tone="warn-dash">
              {{
                item.reason === "failed"
                  ? t("alerts.incidents.rcaSummary.unverifiedFailed")
                  : t("alerts.incidents.rcaSummary.unverifiedNotRun")
              }}
            </RcaPill>
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  rcaEvidenceKindIcon,
  rcaEvidenceTitle,
  type RcaEvidenceFilter,
} from "@/utils/incidents/rcaSummary";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
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
const baseId = useId();

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
const rowId = (number: number) => `${baseId}-${number}`;

const rows = new Map<number, HTMLElement>();
const setRowRef = (number: number, el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLElement) rows.set(number, el);
  else rows.delete(number);
};

const unverifiedSection = ref<HTMLElement | null>(null);

/** Opens entry `number` and scrolls it into view (a thread chip, VE24). */
const openEntry = async (number: number) => {
  if (!props.evidence.some((entry) => entry.number === number)) return;
  if (!filterRcaEvidence(props.evidence, filter.value).some((e) => e.number === number)) {
    filter.value = "all";
  }
  opened.value = new Set(opened.value).add(number);
  await nextTick();
  rows.get(number)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

/** Scrolls to "Cited but not verified" (the band chip, VE33). */
const showUnverified = async () => {
  await nextTick();
  unverifiedSection.value?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  unverifiedSection.value?.focus({ preventScroll: true });
};

defineExpose({ openEntry, showUnverified });
</script>
