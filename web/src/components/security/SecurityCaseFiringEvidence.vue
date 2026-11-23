<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The events behind one case firing, rendered like the Alerts page's Evidence tab. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import SecurityEvidenceEvent from "@/components/security/SecurityEvidenceEvent.vue";
import { detectionEvidenceQuery } from "@/services/securitySigma.queries";
import type { EvidenceGroup } from "@/services/securitySigma";
import { sourceTypesQuery } from "@/services/securitySources.queries";
import { normalizeEvents } from "@/utils/security/normalize";
import { evidenceValueField } from "@/utils/security/firings";
import { rowNamesEntity, type EntityRef } from "@/utils/security/entityMatch";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  org: string;
  alertId: string;
  /** The firing's time in microseconds; stored groups are keyed on it. */
  firedAt: number;
  /** The detection's look-back in minutes, so a firing without stored groups is re-derived over its window. */
  periodMinutes?: number;
  sourceType?: string;
  /** The case's entities; rows naming none of them are hidden until the analyst asks for all. */
  entities?: EntityRef[];
  dataTest?: string;
}>();

const { t } = useI18nTyped();

const SLACK_US = 60_000_000;
/** Rows shown per firing; the Alerts page holds the rest. */
const MAX_ROWS = 5;

const params = computed(() => ({
  firing_time: props.firedAt,
  start_time: props.firedAt - Math.max(1, props.periodMinutes ?? 15) * 60_000_000 - SLACK_US,
  end_time: props.firedAt + 1,
}));
const evidence = useQuery(() => ({
  ...detectionEvidenceQuery(props.org, props.alertId, params.value),
  enabled: !!props.org && !!props.alertId && props.firedAt > 0,
}));
const types = useQuery(() => ({
  ...sourceTypesQuery(props.org),
  enabled: !!props.org && !!props.sourceType,
}));
const source = computed(
  () => (types.data.value ?? []).find((s) => s.id === props.sourceType) ?? null,
);

const showAll = ref(false);
const entities = computed(() => props.entities ?? []);
/** A correlation group keyed on the entity is the entity's, whatever columns its rows carry. */
const entityRows = (g: EvidenceGroup) =>
  g.values && entities.value.length && rowNamesEntity(g.values, entities.value)
    ? g.rows
    : g.rows.filter((r) => rowNamesEntity(r, entities.value));
const filtered = computed(() =>
  (evidence.data.value?.groups ?? []).map((g) => ({
    group: g,
    rows: showAll.value ? g.rows : entityRows(g),
  })),
);
const hiddenRows = computed(() =>
  entities.value.length
    ? (evidence.data.value?.groups ?? []).reduce(
        (n, g) => n + g.rows.length - entityRows(g).length,
        0,
      )
    : 0,
);
const groups = computed(() =>
  filtered.value.map((f, i) => ({
    key: i,
    valueField: evidenceValueField(f.group.sql),
    events: normalizeEvents(f.rows.slice(0, MAX_ROWS), source.value),
  })),
);
const shown = computed(() => groups.value.reduce((n, g) => n + g.events.length, 0));
const failure = computed(() => {
  const e = evidence.error.value as any;
  if (e) return raw(e?.response?.data?.message) || t("siem.alerts.evidenceError");
  const reason = evidence.data.value?.error;
  return reason ? raw(reason) : "";
});
</script>

<template>
  <div class="flex flex-col" :data-test="dataTest ?? 'security-case-firing-evidence'">
    <div v-if="evidence.isPending.value" class="flex justify-center py-3">
      <OSpinner size="sm" />
    </div>
    <span
      v-else-if="failure"
      class="text-text-secondary px-3 py-2 text-xs"
      data-test="security-case-firing-evidence-error"
      >{{ failure }}</span
    >
    <template v-else>
      <div
        v-if="hiddenRows"
        class="flex items-center gap-2 px-3 py-1.5"
        data-test="security-case-firing-evidence-filter"
      >
        <span class="text-text-secondary min-w-0 flex-1 text-xs">{{
          showAll
            ? t("siem.cases.evidence.showingAll", { n: hiddenRows }, hiddenRows)
            : t("siem.cases.evidence.hiddenOther", { n: hiddenRows }, hiddenRows)
        }}</span>
        <OButton
          variant="ghost"
          size="sm"
          data-test="security-case-firing-evidence-toggle"
          @click="showAll = !showAll"
          >{{
            showAll ? t("siem.cases.evidence.onlyEntity") : t("siem.cases.evidence.showAll")
          }}</OButton
        >
      </div>
      <span
        v-if="!shown"
        class="text-text-secondary px-3 py-2 text-xs"
        data-test="security-case-firing-evidence-empty"
        >{{
          hiddenRows ? t("siem.cases.evidence.noneForEntity") : t("siem.cases.noEvidence")
        }}</span
      >
      <template v-for="g in groups" :key="g.key">
        <SecurityEvidenceEvent
          v-for="(event, i) in g.events"
          :key="`${g.key}-${i}`"
          :event="event"
          :value-field="g.valueField"
          class="border-border-subtle border-t"
          data-test="security-case-firing-evidence-row"
        />
      </template>
    </template>
  </div>
</template>
