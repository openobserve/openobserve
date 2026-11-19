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

<!-- Section 1 after the stream pick: intent chips whose slots fill from this stream, then ready-made alerts. -->
<template>
  <div class="flex min-w-0 flex-col gap-2 pt-2.5 pb-2" data-test="add-alert-intent-start">
    <p class="text-text-heading m-0 text-sm font-medium" data-test="add-alert-intent-question">
      {{ t("alerts.intent.question", { stream: raw(streamName) }) }}
    </p>
    <div class="flex min-w-0 flex-wrap gap-1.5" role="group" :aria-label="questionText">
      <OButton
        v-for="id in intents"
        :key="id"
        variant="outline"
        size="chip"
        :active="active === id || choosing === id"
        :aria-pressed="active === id || choosing === id"
        :loading="choosing === id"
        :data-test="`add-alert-intent-${id}`"
        @click="choose(id)"
        >{{ intentLabel(id) }}</OButton
      >
    </div>

    <div
      v-if="active && active !== 'promql'"
      class="text-text-body min-w-0 text-sm leading-8"
      data-test="add-alert-intent-sentence"
    >
      <OTag
        variant="default-soft"
        size="xs"
        class="me-1.5 align-middle"
        :label="
          needsChoice ? t('alerts.intent.needsChoice') : t('alerts.librarySuggest.suggestedStarter')
        "
        data-test="add-alert-intent-sentence-state"
      />
      <i18n-t :keypath="sentenceKey" tag="span" scope="global">
        <template #noun>{{ active === "anyEvent" ? nounOne : noun }}</template>
        <template #field>
          <span class="-me-1.5 inline-flex align-middle">
            <OSelect
              :model-value="slots.field ?? ''"
              :options="fieldOptions"
              appearance="inline"
              size="xs"
              searchable
              :placeholder="t('alerts.intent.slots.fieldPrompt')"
              :aria-label="t('alerts.intent.slots.field')"
              data-test="add-alert-intent-slot-field"
              @update:model-value="setSlot('field', $event)"
            />
          </span>
        </template>
        <template #value>
          <span class="-me-1.5 inline-flex align-middle">
            <OSelect
              :model-value="slots.values ?? []"
              :options="valueOptions"
              multiple
              searchable
              creatable
              appearance="inline"
              size="xs"
              :loading="valuesLoading"
              :disabled="!valueSource"
              :placeholder="t('alerts.intent.slots.valuePlaceholder')"
              :aria-label="t('alerts.intent.slots.value')"
              data-test="add-alert-intent-slot-value"
              @update:model-value="setValues($event)"
              @create="addValue($event)"
              :search-debounce="300"
              @search="valueSearch = $event"
              @close="reapply"
              ><template #trigger>{{ valuesText }}</template
              ><template #after-options
                ><p
                  class="text-text-secondary border-border-default m-0 border-t px-3 py-2 text-xs"
                  data-test="add-alert-intent-slot-value-help"
                >
                  {{ valueHelp }}
                </p></template
              ></OSelect
            >
          </span>
        </template>
        <template #group>
          <span class="-me-1.5 inline-flex align-middle">
            <OSelect
              :model-value="slots.group ?? ''"
              :options="groupOptions"
              appearance="inline"
              size="xs"
              searchable
              :placeholder="t('alerts.intent.slots.groupPrompt')"
              :aria-label="t('alerts.intent.slots.group')"
              data-test="add-alert-intent-slot-group"
              @update:model-value="setSlot('group', $event)"
            />
          </span>
        </template>
        <template #measure>
          <span class="-me-1.5 inline-flex align-middle">
            <OSelect
              :model-value="slots.measure ?? ''"
              :options="measureOptions"
              appearance="inline"
              size="xs"
              searchable
              :placeholder="t('alerts.intent.slots.fieldPrompt')"
              :aria-label="t('alerts.intent.slots.measure')"
              data-test="add-alert-intent-slot-measure"
              @update:model-value="setSlot('measure', $event)"
            />
          </span>
        </template>
        <template #label>
          <span class="-me-1.5 inline-flex align-middle">
            <OSelect
              :model-value="slots.label ?? ''"
              :options="labelOptions"
              appearance="inline"
              size="xs"
              searchable
              :placeholder="t('alerts.intent.slots.labelPrompt')"
              :aria-label="t('alerts.intent.slots.label')"
              data-test="add-alert-intent-slot-label"
              @update:model-value="setSlot('label', $event)"
            />
          </span>
        </template>
        <template #factor>
          <span class="inline-flex align-middle">
            <OInput
              :model-value="slots.factor ?? DEFAULT_FACTOR"
              type="number"
              size="xs"
              fit-content
              :min="1"
              :aria-label="t('alerts.intent.slots.factor')"
              data-test="add-alert-intent-slot-factor"
              @update:model-value="setFactor($event)"
            />
          </span>
        </template>
        <template #metric>
          <span class="font-mono">{{ raw(streamName) }}</span>
        </template>
        <template #bucket>{{ bucketWords }}</template>
        <template #window>
          <AlertWindowPhrase
            :minutes="periodMinutes"
            size="xs"
            data-test="add-alert-intent-slot-window"
            @update:minutes="setWindow"
          />
        </template>
      </i18n-t>
      <OButton
        v-if="offersGroup && slots.group === undefined && groupCandidates.all.length"
        variant="link"
        size="xs"
        class="ms-1.5"
        data-test="add-alert-intent-add-group"
        @click="addGroup"
        >{{ t("alerts.intent.addGroup") }}</OButton
      >
    </div>
    <p
      v-if="active === 'ratio' && familyText.length"
      class="text-text-secondary m-0 text-xs"
      data-test="add-alert-intent-family"
    >
      {{ t("alerts.intent.ratio.alsoCovers", { metrics: joinListMore(familyText, t) }) }}
    </p>

    <template v-if="showLibrary && area.state !== 'absent'">
      <div
        class="flex min-h-8 min-w-0 items-center justify-between gap-2 pt-1"
        data-test="add-alert-suggestions-header"
      >
        <p
          class="m-0 min-w-0 text-xs"
          :class="
            area.state === 'unavailable' || area.state === 'failed'
              ? 'text-status-warning-text'
              : 'text-text-secondary'
          "
          :role="area.state === 'loading' ? 'status' : undefined"
          data-test="add-alert-suggestions-status"
        >
          {{ headerText }}
          <OButton
            v-if="area.state === 'ready'"
            variant="link"
            size="xs"
            data-test="add-alert-suggestions-toggle"
            @click="folded = !folded"
            >{{ folded ? t("common.show") : t("common.hide") }}</OButton
          >
        </p>
        <OButton
          variant="outline"
          size="xs"
          :tabindex="applied ? -1 : undefined"
          data-test="add-alert-start-from-scratch"
          @click="emit('scratch')"
          >{{ t("alerts.librarySuggest.startFromScratch") }}</OButton
        >
      </div>
      <div
        v-if="area.state === 'ready' && !folded"
        class="grid grid-cols-2 gap-2 max-lg:grid-cols-1"
        data-test="add-alert-suggestion-cards"
      >
        <AlertSuggestionCard
          v-for="card in area.cards"
          :key="card.id"
          :suggestion="card"
          :on-stream="onStream"
          @open="openCard(card)"
          @open-existing="emit('open-alert', $event)"
        />
      </div>
      <OButton
        v-if="area.state === 'ready' && !folded && area.total > area.cards.length"
        variant="link"
        size="xs"
        class="self-start"
        :loading="showAll && allSuggestions.isFetching.value"
        data-test="add-alert-suggestions-see-all"
        @click="showAll = true"
        >{{ t("alerts.librarySuggest.seeAll", { count: formatNumber(area.total) }) }}</OButton
      >
    </template>
    <div v-else class="flex justify-end">
      <OButton
        variant="outline"
        size="xs"
        :tabindex="applied ? -1 : undefined"
        data-test="add-alert-start-from-scratch"
        @click="emit('scratch')"
        >{{ t("alerts.librarySuggest.startFromScratch") }}</OButton
      >
    </div>

    <LibraryDrawer
      :open="!!drawerCard"
      :entry="drawerEntry"
      ready
      mode="form"
      :stream-swap="drawerCard?.stream_swap ?? null"
      :preset-file="drawerCard?.prefill ?? null"
      @update:open="(open) => !open && (drawerCard = null)"
      @use="useCard"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import LibraryDrawer from "@/components/alertLibrary/LibraryDrawer.vue";
import AlertSuggestionCard from "./AlertSuggestionCard.vue";
import AlertWindowPhrase from "./AlertWindowPhrase.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { librarySuggestionsQuery } from "@/services/alert_library.queries";
import { promqlDaySeriesQuery } from "@/services/alert_preview.queries";
import { suggestionArea, useAnomalyLibraryAccess } from "@/composables/alerts/useAlertLibrary";
import {
  cachedValueCounts,
  loadValueCounts,
  type ValueCountContext,
} from "@/composables/alerts/useStreamDiscovery";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";
import {
  dataNoun,
  durationWords,
  formatNumber,
  joinListMore,
  joinListOrMore,
} from "@/utils/alerts/alertCopy";
import {
  DEFAULT_FACTOR,
  SHAPE_NUMBER_CAP,
  SHAPE_STRING_CAP,
  SHAPE_WINDOW_US,
  SAMPLE_ROWS,
  buildEventFill,
  buildMetricFill,
  cardsFolded,
  fieldsBySamplePresence,
  intentsFor,
  isCounterLike,
  labelPattern,
  patternText,
  labelProfile,
  familyMember,
  metricFamilySiblings,
  rankCategory,
  rankGroup,
  rankMeasure,
  rankMetricCategory,
  rankMetricGroup,
  pickedValues,
  starterValue,
  readFieldShapes,
  shapeQuerySql,
  slotFields,
  withCaseVariants,
  without,
  type IntentFill,
  type IntentId,
  type IntentSlots,
  type MetricFamilyMember,
  type MetricStreamInfo,
  type Ranked,
} from "@/utils/alerts/alertIntents";
import { entryFromSuggestion } from "@/utils/alerts/prefill/fromLibrary";
import { getUUID } from "@/utils/zincutils";
import type { AlreadySetUp, LibrarySuggestion } from "@/utils/alerts/librarySuggest.types";
import type { SeriesLabels } from "@/utils/alerts/promqlNoSeries";

const props = defineProps<{
  streamType: string;
  streamName: string;
  columns: readonly { value: string; type?: string }[];
  metricStreams: readonly MetricStreamInfo[];
  periodMinutes: number;
  anomalyAvailable: boolean;
  /** When the cards fold; undefined keeps them open. */
  orgAlertCount?: number;
  showLibrary: boolean;
  /** The intent the form was last filled from; null once the user starts from scratch. */
  active: IntentId | null;
  /** An intent or card wrote the form, so Start from scratch undoes it and leaves the Tab order. */
  applied?: boolean;
  /** The type picked above the chips (`is_real_time`): "false", "true" or "anomaly". */
  howItChecks?: string;
}>();

const emit = defineEmits<{
  (e: "apply", payload: { fill: IntentFill; label: I18nText }): void;
  /** The chosen intent has a slot nothing on this stream passes for; the form waits for the user's pick. */
  (e: "pending", payload: { intent: IntentId; label: I18nText }): void;
  (e: "use-suggestion", suggestion: LibrarySuggestion): void;
  (e: "scratch"): void;
  (e: "open-alert", alert: AlreadySetUp): void;
  /** Kept until the host stops listening; "See all" now lists every match in place. */
  (e: "browse-library"): void;
  /** The sentence's window is the alert's look back. */
  (e: "update:period", minutes: number | ""): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const queryClient = useQueryClient();
const anomalyAccess = useAnomalyLibraryAccess();

// Anomaly histograms bucket by 5 minutes unless changed in section 2.
const ANOMALY_BUCKET_MINUTES = 5;
const FAMILY_CAP = 5;
// The server's own ceiling on library matches per request.
const ALL_SUGGESTIONS = 50;
const NO_GROUP = "__none__";

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const isMetrics = computed(() => props.streamType === "metrics");
// A type a chip set does not narrow the chips, so the row never loses the chip beside the one clicked.
const intents = computed(() =>
  intentsFor(props.streamType, {
    anomaly: props.anomalyAvailable,
    howItChecks: props.active ? undefined : props.howItChecks,
  }),
);
const noun = computed(() => dataNoun(props.streamType, "custom", 2, t));
const nounOne = computed(() => dataNoun(props.streamType, "custom", 1, t));
const questionText = computed(() => t("alerts.intent.question", { stream: raw(props.streamName) }));
const bucketWords = computed(() => durationWords(ANOMALY_BUCKET_MINUTES, t));

const slots = reactive<IntentSlots>({});
// The values a starter suggested; the user's first pick replaces them instead of joining them.
let seeded: string[] = [];
// The chip pressed while its slots are still being ranked and seeded.
const choosing = ref<IntentId | null>(null);

// ── Logs and traces: slot candidates by type, ranked by one shape search ──────
// Recent events pick the fields worth asking about, then one aggregate measures their shape.
const sampleSearch = useAlertStreamQuery();
const shapeSearch = useAlertStreamQuery();
const schemaFields = computed(() => props.columns.map((c) => ({ name: c.value, type: c.type })));
const carried = computed(() =>
  fieldsBySamplePresence(
    sampleSearch.hits.value,
    schemaFields.value.map((f) => f.name),
  ),
);
const byPresence = (names: string[]) => {
  const order = new Map(carried.value.map((name, i) => [name, i]));
  return [...names].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
};
const stringFields = computed(() => byPresence(slotFields(schemaFields.value, "string")));
const numberFields = computed(() => byPresence(slotFields(schemaFields.value, "number")));
const askedStrings = computed(() =>
  stringFields.value.filter((f) => carried.value.includes(f)).slice(0, SHAPE_STRING_CAP),
);
const askedNumbers = computed(() =>
  numberFields.value.filter((f) => carried.value.includes(f)).slice(0, SHAPE_NUMBER_CAP),
);
const shapes = computed(() =>
  readFieldShapes(
    shapeSearch.hits.value[0],
    askedStrings.value,
    askedNumbers.value,
    sampleSearch.hits.value,
  ),
);
// One kind of event wants the field naming the most kinds; a count or a share wants a rare minority.
const categoriesFor = (id: IntentId | null): Ranked =>
  without(
    isMetrics.value
      ? rankMetricCategory(profile.value, {
          group: slots.group,
          series: series.value[props.streamName],
        })
      : rankCategory(stringFields.value, shapes.value, id === "anyEvent" ? "variety" : "split"),
    slots.group,
  );
const categoryCandidates = computed(() => categoriesFor(props.active));
const groupCandidates = computed<Ranked>(() =>
  isMetrics.value
    ? rankMetricGroup(profile.value)
    : without(rankGroup(stringFields.value, shapes.value), slots.field),
);
const measureCandidates = computed(() => rankMeasure(numberFields.value, shapes.value));
// Defaults come only from a ranking over the data, so a chip waits for its searches to answer.
const rankingSettled = computed(() => {
  if (isMetrics.value) return !props.streamName || !!series.value[props.streamName];
  const sample = sampleSearch.state.value;
  if (!props.columns.length || sample === "failed") return true;
  if (sample !== "ready") return false;
  if (!(askedStrings.value.length + askedNumbers.value.length)) return true;
  return shapeSearch.state.value === "ready" || shapeSearch.state.value === "failed";
});
const whenRanked = () =>
  new Promise<void>((resolve) => {
    if (rankingSettled.value) return resolve();
    const stop = watch(rankingSettled, (done) => {
      if (!done) return;
      stop();
      resolve();
    });
  });

const lastHour = () => {
  const end = Date.now() * 1000;
  return { startTime: end - SHAPE_WINDOW_US, endTime: end };
};
watch(
  () => `${props.streamType}/${props.streamName}/${props.columns.length}`,
  () => {
    sampleSearch.cancel();
    shapeSearch.cancel();
    if (isMetrics.value || !props.streamName || !props.columns.length) return;
    sampleSearch.run({
      sql: `SELECT * FROM "${props.streamName.replace(/"/g, '""')}"`,
      streamType: props.streamType,
      size: SAMPLE_ROWS,
      ...lastHour(),
    });
  },
  { immediate: true },
);
watch(
  () => sampleSearch.state.value,
  (state) => {
    if (state !== "ready" || !(askedStrings.value.length + askedNumbers.value.length)) return;
    shapeSearch.run({
      sql: shapeQuerySql(props.streamName, askedStrings.value, askedNumbers.value),
      streamType: props.streamType,
      size: 1,
      ...lastHour(),
    });
  },
);

const valueContext = computed<ValueCountContext>(() => ({
  org: org.value,
  streamType: props.streamType,
  streamName: props.streamName,
}));
const fieldValues = computed(() =>
  slots.field && !isMetrics.value
    ? (cachedValueCounts(valueContext.value, slots.field)?.values ?? [])
    : [],
);
const valuesLoading = computed(
  () =>
    !isMetrics.value &&
    !!slots.field &&
    cachedValueCounts(valueContext.value, slots.field)?.state === "loading",
);

// ── Metrics: labels and values from the metric's own series ──────────────────
const series = ref<Record<string, SeriesLabels[]>>({});
const loadSeries = async (metric: string) => {
  if (series.value[metric]) return series.value[metric];
  try {
    const rows = await queryClient.fetchQuery(
      promqlDaySeriesQuery(org.value, metric, Date.now() * 1000),
    );
    series.value = { ...series.value, [metric]: rows };
    return rows;
  } catch {
    series.value = { ...series.value, [metric]: [] };
    return [];
  }
};
const profile = computed(() => labelProfile(series.value[props.streamName] ?? []));
const pickedMetric = computed(() => props.metricStreams.find((s) => s.name === props.streamName));
const siblings = computed(() =>
  pickedMetric.value
    ? metricFamilySiblings(pickedMetric.value, props.metricStreams).slice(0, FAMILY_CAP)
    : [],
);
// A naming generation joins the share only where its series carry the label under some spelling.
const family = computed<MetricFamilyMember[]>(() => {
  const label = slots.label;
  const memberOf = (metric: string): MetricFamilyMember[] => {
    const rows = series.value[metric] ?? [];
    const member = label ? familyMember(label, rows) : undefined;
    const groupOk = !slots.group || rows.some((one) => one[slots.group!] !== undefined);
    return member && groupOk ? [{ metric, ...member }] : [];
  };
  const own = memberOf(props.streamName)[0] ?? {
    metric: props.streamName,
    labels: label ? [label] : [],
    whole: true,
  };
  return label ? [own, ...siblings.value.flatMap(memberOf)] : [own];
});
const familyText = computed(() =>
  family.value.slice(1).map((m) =>
    m.labels.length === 1 && m.labels[0] === slots.label
      ? m.metric
      : t("alerts.intent.ratio.memberReads", {
          metric: raw(m.metric),
          labels: joinListOrMore(m.labels, t),
        }),
  ),
);
const labelValues = computed(
  () => profile.value.find((p) => p.label === slots.label)?.values ?? [],
);

watch(
  () => `${props.streamType}/${props.streamName}`,
  async () => {
    choosing.value = null;
    for (const key of Object.keys(slots) as (keyof IntentSlots)[]) delete slots[key];
    seeded = [];
    if (isMetrics.value && props.streamName) await loadSeries(props.streamName);
  },
  { immediate: true },
);

// ── Options for the slot pickers ─────────────────────────────────────────────
const asOptions = (names: string[]): SelectOption[] =>
  names.map((name) => ({ label: raw(name), value: name }));
const fieldOptions = computed(() => asOptions(categoryCandidates.value.all));
const groupOptions = computed<SelectOption[]>(() => [
  { label: t("alerts.intent.noGroup"), value: NO_GROUP },
  ...asOptions(groupCandidates.value.all),
]);
const measureOptions = computed(() => asOptions(measureCandidates.value.all));
const labelOptions = computed(() => asOptions(categoryCandidates.value.all));
const valueSource = computed(() => (isMetrics.value ? slots.label : slots.field));
// The top values come back capped, so a typed search also asks the server for values containing it.
const valueSearch = ref("");
watch(valueSearch, (text) => {
  const ctx = valueContext.value;
  const entry = slots.field ? cachedValueCounts(ctx, slots.field) : undefined;
  if (isMetrics.value || !slots.field || !text.trim() || !entry?.truncated) return;
  void loadValueCounts(ctx, slots.field, text.trim());
});
const searchedValues = computed(() =>
  slots.field && valueSearch.value.trim() && !isMetrics.value
    ? (cachedValueCounts(valueContext.value, slots.field, valueSearch.value.trim())?.values ?? [])
    : [],
);
const valueOptions = computed<SelectOption[]>(() => {
  const base = isMetrics.value ? labelValues.value : fieldValues.value;
  const seen = [
    ...base,
    ...searchedValues.value.filter((v) => !base.some((b) => b.value === v.value)),
  ];
  const listed = seen
    .filter((v) => v.value !== "")
    .map((v) => ({
      label: raw(v.value),
      value: v.value,
      suffix: formatNumber(v.count),
    }));
  const typed = (slots.values ?? [])
    .filter((v) => !seen.some((s) => s.value === v))
    .map((v) => ({ label: raw(patternText(v, slots.patterns)), value: v }));
  return [...patternOptions.value, ...typed, ...listed];
});

// A "5xx" typed for a metric label offers every value it covers, since the query reads values as a regex.
const patternOptions = computed<SelectOption[]>(() => {
  const search = valueSearch.value.trim();
  if (!isMetrics.value || !search) return [];
  const regex = labelPattern(
    search,
    labelValues.value.map((v) => v.value),
  );
  if (regex === search || slots.values?.includes(regex)) return [];
  const re = new RegExp(`^(?:${regex})$`);
  const covered = labelValues.value.filter((v) => re.test(v.value));
  return [
    {
      label: t("alerts.intent.slots.patternOption", { pattern: raw(search) }),
      value: regex,
      suffix: formatNumber(covered.reduce((sum, v) => sum + v.count, 0)),
    },
  ];
});
const valueHelp = computed(() =>
  isMetrics.value
    ? t("alerts.intent.slots.valueHelpSeries", { example: raw("5xx") })
    : t("alerts.intent.slots.valueHelpEvents", { noun: noun.value }),
);

// The picked values read as words in the sentence, so the picker sizes to them like the other slots.
const valuesText = computed<I18nText>(() =>
  slots.values?.length
    ? joinListOrMore(
        slots.values.map((v) => patternText(v, slots.patterns)),
        t,
      )
    : t("alerts.intent.slots.valuePrompt"),
);

const offersGroup = computed(() => !!props.active && wantsGroup(props.active));
const SENTENCES: Record<IntentId, [I18nKey, I18nKey]> = {
  countWhere: ["alerts.intent.countWhere.sentence", "alerts.intent.countWhere.sentenceAll"],
  percentile: ["alerts.intent.percentile.sentencePer", "alerts.intent.percentile.sentenceAll"],
  anyEvent: ["alerts.intent.anyEvent.sentence", "alerts.intent.anyEvent.sentence"],
  unusualVolume: ["alerts.intent.unusualVolume.sentence", "alerts.intent.unusualVolume.sentence"],
  compareLastWeek: [
    "alerts.intent.compareLastWeek.sentenceWhere",
    "alerts.intent.compareLastWeek.sentenceWhere",
  ],
  metricAbove: ["alerts.intent.metricAbove.sentencePer", "alerts.intent.metricAbove.sentenceAll"],
  ratio: ["alerts.intent.ratio.sentenceWhere", "alerts.intent.ratio.sentenceWhereAll"],
  unusualChange: ["alerts.intent.unusualChange.sentence", "alerts.intent.unusualChange.sentence"],
  promql: ["alerts.intent.promql.label", "alerts.intent.promql.label"],
};
const RATE_SENTENCES: [I18nKey, I18nKey] = [
  "alerts.intent.metricAbove.rateSentencePer",
  "alerts.intent.metricAbove.rateSentenceAll",
];
// Only a type the metric declares turns "above a value" into a rate; an unknown one keeps the average.
const isCounter = computed(
  () =>
    isMetrics.value &&
    !!pickedMetric.value?.metrics_meta?.metric_type &&
    isCounterLike(pickedMetric.value),
);
// An empty group ("") is one the user asked for but has not picked yet.
const sentenceKey = computed<I18nKey>(() => {
  const pair =
    props.active === "metricAbove" && isCounter.value
      ? RATE_SENTENCES
      : SENTENCES[props.active ?? "countWhere"];
  return slots.group !== undefined ? pair[0] : pair[1];
});
const intentLabel = (id: IntentId) =>
  t(`alerts.intent.${id}.label` as I18nKey, { noun: noun.value });

// ── Filling the form ─────────────────────────────────────────────────────────
const fillFor = (id: IntentId): IntentFill =>
  isMetrics.value
    ? buildMetricFill(
        id,
        {
          ...slots,
          metric: props.streamName,
          family: family.value,
          counter: id === "ratio" ? isCounterLike(pickedMetric.value) : isCounter.value,
        },
        { periodMinutes: props.periodMinutes },
      )
    : buildEventFill(id, slots, { stream: props.streamName, id: getUUID });

const wantsGroup = (id: IntentId) =>
  ["countWhere", "percentile", "metricAbove", "ratio"].includes(id);
const wantsValue = (id: IntentId) =>
  ["countWhere", "anyEvent", "compareLastWeek", "ratio"].includes(id);
/** A filter or measure the intent cannot run without is still empty. */
const missingFor = (id: IntentId) =>
  (wantsValue(id) && (!valueSource.value || !slots.values?.length)) ||
  (id === "percentile" && !slots.measure);
const needsChoice = computed(() => !!props.active && missingFor(props.active));

const apply = (id: IntentId) => {
  const label = intentLabel(id);
  if (missingFor(id)) emit("pending", { intent: id, label });
  else emit("apply", { fill: fillFor(id), label });
};

/** Fills empty slots with the first candidate that passes the slot's rule; none passing leaves it empty. */
const seedSlots = (id: IntentId) => {
  if (!wantsGroup(id)) slots.group = undefined;
  else if (slots.group === undefined) slots.group = groupCandidates.value.fit[0];
  if (id === "percentile") slots.measure ??= measureCandidates.value.fit[0];
  if (id === "compareLastWeek") slots.factor ??= DEFAULT_FACTOR;
  if (!wantsValue(id)) return;
  if (isMetrics.value) slots.label ??= categoriesFor(id).fit[0];
  else slots.field ??= categoriesFor(id).fit[0];
};

// The preview's default range (3 look-back windows, at least 5 min), so its value counts are shared.
const previewWindowUs = () => Math.max(3 * props.periodMinutes, 5) * 60_000_000;

/** The value slot waits for the field's counts, then suggests the largest minority seen recently. */
const seedValues = async (id: IntentId) => {
  if (!wantsValue(id) || slots.values?.length) return;
  if (isMetrics.value) {
    const value = starterValue(labelValues.value);
    slots.values = value ? [value] : [];
    seeded = [...slots.values];
    return;
  }
  const field = slots.field;
  if (!field) return;
  const [day, recent] = await Promise.all([
    loadValueCounts(valueContext.value, field),
    loadValueCounts({ ...valueContext.value, windowUs: previewWindowUs() }, field),
  ]);
  if (slots.field !== field || slots.values?.length) return;
  const value = starterValue(day.values, recent.values);
  slots.values = value ? withCaseVariants([value], day.values) : [];
  seeded = [...slots.values];
};

const choose = async (id: IntentId) => {
  analytics.track("alert_intent_applied", { intent: id, stream_type: props.streamType });
  choosing.value = id;
  await whenRanked();
  if (choosing.value !== id) return;
  seedSlots(id);
  await Promise.all([seedValues(id), ...(id === "ratio" ? siblings.value.map(loadSeries) : [])]);
  if (choosing.value !== id) return;
  choosing.value = null;
  apply(id);
};

const reapply = () => props.active && apply(props.active);

const asText = (value: SelectModelValue): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const setSlot = async (slot: "field" | "group" | "measure" | "label", value: SelectModelValue) => {
  const next = asText(value);
  slots[slot] = next && next !== NO_GROUP ? next : undefined;
  if (slot === "field" || slot === "label") {
    slots.values = [];
    slots.patterns = [];
    if (props.active) await seedValues(props.active);
  }
  if (isMetrics.value) await Promise.all(siblings.value.map(loadSeries));
  reapply();
};

const addGroup = () => {
  const first = groupCandidates.value.fit[0];
  if (first) void setSlot("group", first);
  else slots.group = "";
};

// Only a regex the picker made from a typed "5xx" stays a pattern; a value the series carry is matched literally.
const keepPatterns = (added: string[]) => {
  slots.patterns = [...new Set([...(slots.patterns ?? []), ...added])].filter((p) =>
    slots.values?.includes(p),
  );
};

/** A newly picked value brings its case variants, so ERROR also counts error; the form follows on close. */
const setValues = (value: SelectModelValue) => {
  const picked = (Array.isArray(value) ? value : [value]).map(asText).filter(Boolean);
  const previous = slots.values ?? [];
  const added = picked.filter((v) => !previous.includes(v));
  const variants = isMetrics.value ? [] : withCaseVariants(added, fieldValues.value);
  slots.values = [...new Set([...pickedValues(picked, previous, seeded), ...variants])];
  const offered = patternOptions.value.map((o) => String(o.value));
  keepPatterns(added.filter((v) => offered.includes(v)));
  seeded = [];
};

const addValue = (value: string) => {
  const typed = value.trim();
  const text = isMetrics.value
    ? labelPattern(
        typed,
        labelValues.value.map((v) => v.value),
      )
    : typed;
  if (!text) return;
  const previous = slots.values ?? [];
  slots.values = [...new Set(pickedValues([...previous, text], previous, seeded))];
  keepPatterns(text === typed ? [] : [text]);
  seeded = [];
};

// A rate window is written into the query, so the query follows a new window.
const setWindow = async (minutes: number | "") => {
  emit("update:period", minutes);
  const readsWindow =
    props.active === "ratio" || (props.active === "metricAbove" && isCounter.value);
  if (!readsWindow || !(Number(minutes) > 0)) return;
  await nextTick();
  reapply();
};

const setFactor = (value: unknown) => {
  const n = Number(value);
  slots.factor = Number.isFinite(n) && n > 0 ? n : DEFAULT_FACTOR;
  reapply();
};

// ── Ready-made alerts (B-2) ──────────────────────────────────────────────────
const suggestions = useQuery(
  computed(() => ({
    ...librarySuggestionsQuery(org.value, {
      stream_type: props.streamType as "logs" | "metrics" | "traces",
      stream_name: props.streamName,
    }),
    enabled: props.showLibrary && !!props.streamName && !!org.value,
  })),
);
// "See all" lists every match here, so the form is never left for the library.
const showAll = ref(false);
const allSuggestions = useQuery(
  computed(() => ({
    ...librarySuggestionsQuery(org.value, {
      stream_type: props.streamType as "logs" | "metrics" | "traces",
      stream_name: props.streamName,
      limit: ALL_SUGGESTIONS,
    }),
    enabled: showAll.value && props.showLibrary && !!props.streamName && !!org.value,
  })),
);
watch(
  () => props.streamName,
  () => (showAll.value = false),
);
const area = computed(() => {
  const all = showAll.value ? allSuggestions.data.value : undefined;
  return suggestionArea(
    {
      pending: !all && suggestions.isPending.value,
      error: all ? null : suggestions.error.value,
      data: all ?? suggestions.data.value,
    },
    anomalyAccess.value,
    all ? Infinity : undefined,
  );
});
const folded = ref(cardsFolded(props.orgAlertCount));
// Cards that land after the user has started on the form stay folded in their header line, so nothing moves.
let actedWhileLoading = false;
const markActed = () => (actedWhileLoading = true);
const stopWatchingActs = () => {
  document.removeEventListener("pointerdown", markActed, true);
  document.removeEventListener("keydown", markActed, true);
};
watch(
  () => area.value.state,
  (state, before) => {
    if (state === "loading") {
      actedWhileLoading = false;
      document.addEventListener("pointerdown", markActed, true);
      document.addEventListener("keydown", markActed, true);
      return;
    }
    stopWatchingActs();
    if (before === "loading" && state === "ready" && actedWhileLoading) folded.value = true;
  },
  { immediate: true },
);
onBeforeUnmount(stopWatchingActs);
watch(
  () => props.orgAlertCount,
  (count, before) => {
    if (before === undefined) folded.value = cardsFolded(count);
  },
);
const headerText = computed<I18nText>(() => {
  switch (area.value.state) {
    case "loading":
      return t("alerts.librarySuggest.loading", { stream: raw(props.streamName) });
    case "failed":
      return t("alerts.librarySuggest.failed");
    case "unavailable":
      return t("alerts.librarySuggest.unavailable");
    case "none":
      return t("alerts.librarySuggest.none");
    default:
      return t(
        "alerts.librarySuggest.folded",
        { count: formatNumber(area.value.total) },
        area.value.total,
      );
  }
});

const onStream = computed<ReadonlySet<string>>(
  () =>
    new Set([
      ...props.columns.map((c) => c.value),
      ...(isMetrics.value ? props.metricStreams.map((s) => s.name) : []),
    ]),
);

const drawerCard = ref<LibrarySuggestion | null>(null);
const drawerEntry = computed(() =>
  drawerCard.value ? entryFromSuggestion(drawerCard.value) : null,
);
const openCard = (card: LibrarySuggestion) => {
  analytics.track("alert_suggestion_opened", {
    library_id: card.id,
    rank: area.value.cards.indexOf(card) + 1,
    confidence: card.fit,
  });
  drawerCard.value = card;
};
const useCard = () => {
  const card = drawerCard.value;
  if (!card) return;
  analytics.track("alert_suggestion_applied", {
    library_id: card.id,
    rank: area.value.cards.indexOf(card) + 1,
    confidence: card.fit,
  });
  emit("use-suggestion", card);
  drawerCard.value = null;
};
</script>
