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
    <div
      class="flex min-w-0 flex-wrap items-center gap-1.5"
      role="group"
      :aria-label="questionText"
    >
      <span
        class="text-text-heading me-1.5 text-xs font-semibold whitespace-nowrap"
        aria-hidden="true"
        data-test="add-alert-intent-question"
        >{{ t("alerts.intent.lead") }}</span
      >
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
      class="text-text-body flex min-w-0 flex-col text-sm"
      data-test="add-alert-intent-sentence"
    >
      <OSettingRow :label="t('alerts.intent.rows.watch')" data-test="add-alert-intent-row-watch">
        <i18n-t :keypath="watchKey" tag="span" scope="global" class="contents">
          <template #noun>{{ active === "anyEvent" ? nounOne : noun }}</template>
          <template #metric>
            <span class="text-text-heading min-w-0 font-medium wrap-anywhere">{{
              raw(streamName)
            }}</span>
          </template>
          <template #bucket>{{ bucketWords }}</template>
          <template #measure>
            <span v-if="isMetrics" class="text-text-heading min-w-0 font-medium wrap-anywhere">{{
              raw(streamName)
            }}</span>
            <OSelect
              v-else
              :model-value="slots.measure ?? ''"
              :options="measureOptions"
              size="sm"
              searchable
              :class="SLOT_FIELD"
              :placeholder="t('alerts.intent.rows.pickField')"
              :aria-label="t('alerts.intent.slots.measure')"
              :dropdown-style="SLOT_MENU"
              data-test="add-alert-intent-slot-measure"
              @update:model-value="setSlot('measure', $event)"
            />
          </template>
          <template #agg>
            <OSelect
              :model-value="formAgg"
              :options="aggOptions"
              size="sm"
              :searchable="false"
              :class="SLOT_FIELD"
              :aria-label="t('alerts.queryConfig.aggregationFunction')"
              :dropdown-style="SLOT_MENU"
              data-test="add-alert-intent-slot-agg"
              @update:model-value="setSlot('agg', $event)"
            />
          </template>
        </i18n-t>
        <OTag
          v-if="needsChoice && missingSlot === 'measure'"
          v-bind="STATE_TAG"
          :label="t('alerts.intent.needsChoice')"
        />
        <template v-if="active === 'ratio' && familyText.length" #note>
          <span data-test="add-alert-intent-family">{{
            t("alerts.intent.ratio.alsoCovers", { metrics: joinListMore(familyText, t) })
          }}</span>
        </template>
      </OSettingRow>

      <OSettingRow
        v-if="wantsValueSlot || (active === 'unusualVolume' && groupCandidates.all.length)"
        :label="t('alerts.intent.rows.where')"
        data-test="add-alert-intent-row-where"
      >
        <OSelect
          v-if="active === 'unusualVolume' && !scoped"
          :model-value="NO_GROUP"
          :options="fieldOptions"
          size="sm"
          searchable
          :class="SLOT_FIELD"
          :aria-label="t('alerts.intent.slots.field')"
          :dropdown-style="SLOT_MENU"
          data-test="add-alert-intent-slot-field"
          @update:model-value="setSlot('field', $event)"
        />
        <i18n-t
          v-else
          :keypath="isMetrics ? 'alerts.intent.rows.labelMatches' : 'alerts.intent.rows.fieldIs'"
          tag="span"
          scope="global"
          class="contents"
        >
          <template #field>
            <OSelect
              :model-value="slots.field ?? ''"
              :options="fieldOptions"
              size="sm"
              searchable
              :class="SLOT_FIELD"
              :placeholder="t('alerts.intent.rows.pickField')"
              :aria-label="t('alerts.intent.slots.field')"
              :dropdown-style="SLOT_MENU"
              data-test="add-alert-intent-slot-field"
              @update:model-value="setSlot('field', $event)"
            />
          </template>
          <template #label>
            <OSelect
              :model-value="slots.label ?? ''"
              :options="labelOptions"
              size="sm"
              searchable
              :class="SLOT_FIELD"
              :placeholder="t('alerts.intent.rows.pickLabel')"
              :aria-label="t('alerts.intent.slots.label')"
              :dropdown-style="LABEL_MENU"
              data-test="add-alert-intent-slot-label"
              @update:model-value="setSlot('label', $event)"
            />
          </template>
          <template #value>
            <OSelect
              :model-value="slots.values ?? []"
              :options="valueOptions"
              multiple
              searchable
              creatable
              size="sm"
              :class="SLOT_FIELD"
              :loading="valuesLoading"
              :disabled="!valueSource"
              :placeholder="t('alerts.intent.slots.valuePlaceholder')"
              :aria-label="t('alerts.intent.slots.value')"
              :dropdown-style="SLOT_MENU"
              data-test="add-alert-intent-slot-value"
              @update:model-value="setValues($event)"
              @create="addValue($event)"
              :search-debounce="300"
              @search="valueSearch = $event"
              @close="reapply"
              ><template #trigger
                ><span
                  class="min-w-0 truncate text-start text-sm"
                  :class="slots.values?.length ? 'text-select-text' : 'text-select-placeholder'"
                  >{{ valuesText }}</span
                ></template
              ><template #after-options
                ><p
                  class="text-text-secondary border-border-default m-0 w-0 min-w-full border-t px-3 py-2 text-xs"
                  data-test="add-alert-intent-slot-value-help"
                >
                  {{ valueHelp }}
                </p></template
              ></OSelect
            >
          </template>
        </i18n-t>
        <OTag
          v-if="needsChoice && missingSlot === 'value'"
          v-bind="STATE_TAG"
          :label="t('alerts.intent.needsChoice')"
        />
        <OButton
          v-if="swapOffer"
          variant="link"
          size="sm"
          data-test="add-alert-intent-use-instead"
          @click="swapValue"
          >{{ t("alerts.intent.useInstead", { value: raw(swapOffer) }) }}</OButton
        >
        <OButton
          v-if="otherSpellings.length"
          variant="link"
          size="sm"
          data-test="add-alert-intent-also-match"
          @click="addSpellings"
          >{{ t("alerts.intent.alsoMatch", { values: joinListMore(otherSpellings, t) }) }}</OButton
        >
      </OSettingRow>

      <OSettingRow
        v-if="offersGroup"
        :label="t('alerts.intent.rows.per')"
        data-test="add-alert-intent-row-per"
      >
        <OSelect
          :model-value="slots.group || NO_GROUP"
          :options="groupOptions"
          size="sm"
          searchable
          :class="SLOT_FIELD"
          :aria-label="t('alerts.intent.slots.group')"
          :dropdown-style="SLOT_MENU"
          data-test="add-alert-intent-slot-group"
          @update:model-value="setSlot('group', $event)"
        />
      </OSettingRow>

      <OSettingRow
        v-if="showsWindow"
        :label="t('alerts.intent.rows.over')"
        data-test="add-alert-intent-row-over"
      >
        <i18n-t
          keypath="alerts.intent.rows.lastMinutes"
          :plural="periodMinutes > 0 ? periodMinutes : 2"
          tag="span"
          scope="global"
          class="contents"
        >
          <template #n>
            <OInput
              :model-value="periodMinutes > 0 ? periodMinutes : ''"
              type="number"
              size="sm"
              fit-content
              :min="1"
              :debounce="300"
              :error="!(periodMinutes > 0)"
              :aria-label="t('alerts.form.names.lookBack')"
              data-test="add-alert-intent-slot-window"
              @update:model-value="
                setWindow($event === '' || $event === null ? '' : Number($event))
              "
            />
          </template>
        </i18n-t>
      </OSettingRow>

      <OSettingRow
        v-if="active === 'compareLastWeek'"
        :label="t('alerts.intent.rows.alertWhen')"
        data-test="add-alert-intent-row-when"
      >
        <i18n-t
          keypath="alerts.intent.rows.timesLastWeek"
          tag="span"
          scope="global"
          class="contents"
        >
          <template #factor>
            <OInput
              :model-value="slots.factor ?? DEFAULT_FACTOR"
              type="number"
              size="sm"
              fit-content
              :min="1"
              :aria-label="t('alerts.intent.slots.factor')"
              data-test="add-alert-intent-slot-factor"
              @update:model-value="setFactor($event)"
            />
          </template>
        </i18n-t>
      </OSettingRow>

      <OSettingRow
        v-if="thresholdKind && (threshold || needsChoice)"
        :label="t('alerts.intent.rows.alertWhen')"
        data-test="add-alert-intent-row-when"
      >
        <template v-if="threshold && guide">
          <OFormSelect
            :name="threshold.operator"
            :options="guide.operators.value"
            size="sm"
            :searchable="false"
            :class="SLOT_FIELD"
            :aria-label="t('alerts.form.names.comparison')"
            :dropdown-style="SLOT_MENU"
            data-test="add-alert-intent-slot-operator"
            @update:model-value="guide.change(threshold.operator, $event)"
          />
          <span class="inline-flex" data-error-focus>
            <OFormInput
              :name="guide.spanDuration.value ? DURATION_PATH : threshold.value"
              type="number"
              size="sm"
              fit-content
              class="min-w-28!"
              :placeholder="t('alerts.placeholders.value')"
              :aria-label="t('alerts.alertIfNoOfEvents')"
              data-test="add-alert-intent-slot-threshold-input"
              @update:model-value="
                typeThreshold(guide.spanDuration.value ? DURATION_PATH : threshold.value, $event)
              "
            >
              <template #error />
            </OFormInput>
          </span>
          <OSelect
            v-if="guide.spanDuration.value"
            :model-value="guide.durationUnit.value"
            :options="guide.durationUnits.value"
            size="sm"
            :searchable="false"
            :class="SLOT_FIELD"
            :aria-label="t('common.unitFor', { label: t('alerts.alertIfNoOfEvents') })"
            data-test="add-alert-intent-slot-threshold-unit-select"
            @update:model-value="guide.setDurationUnit($event)"
          />
          <span v-else-if="unitWord" data-test="add-alert-intent-slot-threshold-unit">{{
            unitWord
          }}</span>
          <OTag
            v-if="thresholdMissing"
            v-bind="STATE_TAG"
            :label="t('alerts.sections.condition.noThreshold')"
          />
        </template>
        <span
          v-else
          class="text-text-secondary leading-8.5"
          data-test="add-alert-intent-threshold-waits"
          >{{ t("alerts.intent.rows.thresholdWaits") }}</span
        >
        <template #note>
          <AlertMessageLine
            :error="threshold ? thresholdError : null"
            error-data-test="add-alert-intent-threshold-error"
            :note="threshold ? guide?.note.value : null"
            :help="threshold ? guide?.help.value : null"
            data-test="add-alert-intent-threshold-message"
          />
        </template>
      </OSettingRow>

      <div v-if="offersDefaults" class="pt-1 pb-2">
        <slot name="defaults" />
      </div>
    </div>

    <template v-if="showLibrary && area.state !== 'absent'">
      <div
        class="flex min-h-7 min-w-0 items-center justify-between gap-2"
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
          :set-up-comparison="setUpComparison(card)"
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
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { get } from "lodash-es";
import { useStore } from "vuex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import LibraryDrawer from "@/components/alertLibrary/LibraryDrawer.vue";
import AlertSuggestionCard from "./AlertSuggestionCard.vue";
import AlertMessageLine from "./AlertMessageLine.vue";
import { ALERT_FORM_CONTEXT_KEY } from "./alertFormContext";
import { shownFieldError } from "@/composables/alerts/shownFieldError";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { librarySuggestionsQuery } from "@/services/alert_library.queries";
import { firingAlertsQuery } from "@/services/alerts.queries";
import {
  installedThresholdDiffers,
  type AlertThreshold,
  type LookAlikeAlert,
} from "@/utils/alerts/lookAlike";
import { operatorSymbol } from "@/utils/alerts/alertReadBack";
import { promqlDaySeriesQuery } from "@/services/alert_preview.queries";
import { suggestionArea, useAnomalyLibraryAccess } from "@/composables/alerts/useAlertLibrary";
import {
  cachedValueCounts,
  loadValueCounts,
  type ValueCountContext,
} from "@/composables/alerts/useStreamDiscovery";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";
import { publishGroupRanking } from "@/composables/alerts/groupRanking";
import {
  dataNoun,
  durationWords,
  formatNumber,
  joinListMore,
  joinListOrMore,
} from "@/utils/alerts/alertCopy";
import {
  ANOMALY_BUCKET_MINUTES,
  BUCKET_LABEL,
  DEFAULT_FACTOR,
  METRIC_AGGS,
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
  labelSpellings,
  metricFamilySiblings,
  rankCategory,
  rankGroup,
  rankMeasure,
  rankMetricCategory,
  rankMetricGroup,
  orgGroupUse,
  pickedValues,
  spellingVariants,
  starterAlternative,
  starterValue,
  readFieldShapes,
  shapeQuerySql,
  slotFields,
  thresholdPaths,
  withCaseVariants,
  hasCaseVariants,
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
  /** The user typed a threshold in the sentence, so it is theirs as if typed in step 2. */
  (e: "threshold"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const queryClient = useQueryClient();
const anomalyAccess = useAnomalyLibraryAccess();

const FAMILY_CAP = 5;
// The server's own ceiling on library matches per request.
const ALL_SUGGESTIONS = 50;
const NO_GROUP = "__none__";
// The inline slot is as narrow as its word, so its menu takes room for full field names.
const SLOT_MENU = { minWidth: "min(18rem, calc(100vw - 2rem))" };
// Room for two spellings of one label side by side.
const LABEL_MENU = { minWidth: "min(28rem, calc(100vw - 2rem))" };
// A slot hugs its value, never cut below the row's width, and keeps a field's width when nearly empty.
const SLOT_FIELD = "w-fit! max-w-full min-w-28";
const STATE_TAG = {
  variant: "default-soft",
  size: "xs",
  "data-test": "add-alert-intent-sentence-state",
} as const;

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const isMetrics = computed(() => props.streamType === "metrics");
// A type a chip set does not narrow the chips, so the row never loses the chip beside the one clicked.
// The type as it was when a chip was pressed: a chip that sets the type keeps its row, one picked under it filters it.
const typeAtPick = ref<string | undefined>();
// A histogram's bucket series carry the bucket label; the schema says so before any series load.
const isBucket = computed(
  () => isMetrics.value && props.columns.some((c) => c.value === BUCKET_LABEL),
);
const intents = computed(() =>
  intentsFor(props.streamType, {
    anomaly: props.anomalyAvailable,
    howItChecks: props.active ? typeAtPick.value : props.howItChecks,
    bucket: isBucket.value,
  }),
);
const noun = computed(() => dataNoun(props.streamType, "custom", 2, t));
const nounOne = computed(() => dataNoun(props.streamType, "custom", 1, t));
const questionText = computed(() => t("alerts.intent.question", { stream: raw(props.streamName) }));
const bucketWords = computed(() => durationWords(ANOMALY_BUCKET_MINUTES, t));

const slots = reactive<IntentSlots>({});
// The values a starter suggested; the user's first pick replaces them instead of joining them.
const seeded = ref<string[]>([]);
// A value the data cannot tell from the suggested one, offered as a one-click swap while it stands.
const alternative = ref<string | undefined>();
// The chip pressed while its slots are still being ranked and seeded.
const choosing = ref<IntentId | null>(null);

// The org's alerts say which fields it already groups by; the list page caches the same read.
const orgAlerts = useQuery(() =>
  Object.assign(firingAlertsQuery(org.value), { enabled: !!org.value }),
);
const orgUse = computed(() =>
  orgGroupUse((orgAlerts.data.value?.list ?? []) as Parameters<typeof orgGroupUse>[0]),
);

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
  id === "unusualVolume"
    ? groupCandidates.value
    : without(
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
    ? rankMetricGroup(profile.value, { metric: props.streamName, orgUse: orgUse.value })
    : without(rankGroup(stringFields.value, shapes.value, orgUse.value), slots.field),
);
const measureCandidates = computed(() => rankMeasure(numberFields.value, shapes.value));
// Defaults come only from a ranking over the data, so a chip waits for its searches to answer.
const rankingSettled = computed(() => {
  if (orgAlerts.isPending.value && orgAlerts.fetchStatus.value !== "idle") return false;
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
// Step 2's group-by picker lists in this order, so both pickers lead with the same fields.
const groupOrder = computed(() =>
  isMetrics.value
    ? rankMetricGroup(profile.value, { metric: props.streamName, orgUse: orgUse.value }).all
    : rankGroup(stringFields.value, shapes.value, orgUse.value).all,
);
watch(
  () =>
    rankingSettled.value && props.streamName
      ? [props.streamType, props.streamName, ...groupOrder.value].join("\n")
      : "",
  (order) => {
    if (!order) return;
    const key = { org: org.value, streamType: props.streamType, streamName: props.streamName };
    publishGroupRanking(key, groupOrder.value);
  },
);
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
// The other naming generations are named before a label is picked, not only once it is.
const familyText = computed(() =>
  slots.label
    ? family.value.slice(1).map((m) =>
        m.labels.length === 1 && m.labels[0] === slots.label
          ? m.metric
          : t("alerts.intent.ratio.memberReads", {
              metric: raw(m.metric),
              labels: joinListOrMore(m.labels, t),
            }),
      )
    : [...siblings.value],
);
const labelValues = computed(
  () => profile.value.find((p) => p.label === slots.label)?.values ?? [],
);

watch(
  () => `${props.streamType}/${props.streamName}`,
  async () => {
    choosing.value = null;
    for (const key of Object.keys(slots) as (keyof IntentSlots)[]) delete slots[key];
    seeded.value = [];
    alternative.value = undefined;
    if (isMetrics.value && props.streamName) await loadSeries(props.streamName);
  },
  { immediate: true },
);

// ── Options for the slot pickers ─────────────────────────────────────────────
const asOptions = (names: string[]): SelectOption[] =>
  names.map((name) => ({ label: raw(name), value: name }));
const fieldOptions = computed<SelectOption[]>(() =>
  props.active === "unusualVolume"
    ? [
        { label: t("alerts.intent.noFilter"), value: NO_GROUP },
        ...asOptions(categoryCandidates.value.all),
      ]
    : asOptions(categoryCandidates.value.all),
);
const groupOptions = computed<SelectOption[]>(() => [
  { label: t("alerts.intent.noGroup"), value: NO_GROUP },
  ...asOptions(groupCandidates.value.all),
]);
const measureOptions = computed(() => asOptions(measureCandidates.value.all));
// Spellings of one label from two naming generations are read together, so they are one choice.
const labelOptions = computed<SelectOption[]>(() =>
  labelSpellings(categoryCandidates.value.all, series.value[props.streamName] ?? []).map(
    (spellings) => ({
      label: spellings.length > 1 ? joinListOrMore(spellings, t) : raw(spellings[0]),
      value: spellings.find((l) => l === slots.label) ?? spellings[0],
    }),
  ),
);
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
    : hasCaseVariants(fieldValues.value)
      ? t("alerts.intent.slots.valueHelpEventsCaseAdded", { noun: noun.value })
      : t("alerts.intent.slots.valueHelpEvents", { noun: noun.value }),
);

// The picked values read as one joined phrase, so the field sizes to them like the other slots.
const valuesText = computed<I18nText>(() =>
  slots.values?.length
    ? joinListOrMore(
        slots.values.map((v) => patternText(v, slots.patterns)),
        t,
      )
    : t("alerts.intent.slots.valuePlaceholder"),
);

const offersGroup = computed(() => !!props.active && wantsGroup(props.active));
const scoped = computed(() => props.active === "unusualVolume" && slots.field !== undefined);
const wantsValueSlot = computed(() => !!props.active && (wantsValue(props.active) || scoped.value));
// Only a type the metric declares turns "above a value" into a rate; an unknown one keeps the average.
const isCounter = computed(
  () =>
    isMetrics.value &&
    !!pickedMetric.value?.metrics_meta?.metric_type &&
    isCounterLike(pickedMetric.value),
);
const WATCH: Record<IntentId, I18nKey> = {
  countWhere: "alerts.intent.rows.countOf",
  percentile: "alerts.intent.rows.percentileOf",
  anyEvent: "alerts.intent.rows.eachEvent",
  unusualVolume: "alerts.intent.rows.unusualNumber",
  compareLastWeek: "alerts.intent.rows.countOf",
  metricAbove: "alerts.intent.rows.aggOf",
  ratio: "alerts.intent.rows.shareOf",
  unusualChange: "alerts.intent.rows.unusualChange",
  promql: "alerts.intent.promql.label",
};
const watchKey = computed<I18nKey>(() =>
  props.active === "metricAbove" && isCounter.value
    ? "alerts.intent.rows.perSecond"
    : WATCH[props.active ?? "countWhere"],
);
const WINDOWED = new Set<IntentId>([
  "countWhere",
  "percentile",
  "compareLastWeek",
  "metricAbove",
  "ratio",
]);
const showsWindow = computed(() => !!props.active && WINDOWED.has(props.active));
const intentLabel = (id: IntentId) =>
  id === "percentile" && isMetrics.value
    ? t("alerts.intent.percentile.labelMetric")
    : t(`alerts.intent.${id}.label` as I18nKey, { noun: noun.value });

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
/** The slot the intent cannot run without that is still empty. */
const missingSlotFor = (id: IntentId): "value" | "measure" | null =>
  (wantsValue(id) && (!valueSource.value || !slots.values?.length)) ||
  (id === "unusualVolume" && !!slots.field && !slots.values?.length)
    ? "value"
    : id === "percentile" && !isMetrics.value && !slots.measure
      ? "measure"
      : null;
const missingFor = (id: IntentId) => missingSlotFor(id) !== null;
const missingSlot = computed(() => (props.active ? missingSlotFor(props.active) : null));
const needsChoice = computed(() => missingSlot.value !== null);

// ── The threshold: step 2's own form fields, typed at the end of the sentence ──
const form = inject(FORM_CONTEXT_KEY, null);
const guide = inject(ALERT_FORM_CONTEXT_KEY, null)?.thresholdGuide;
const formValues = form?.useStore((s: { values: unknown }) => s.values);
const read = (path: string) => get(formValues?.value, path);
const DURATION_PATH = "_ui.durationValue";
const VALUE_PATHS = [
  "trigger_condition.threshold",
  "query_condition.aggregation.having.value",
  "query_condition.promql_condition.value",
];
const errors = Object.fromEntries(VALUE_PATHS.map((path) => [path, shownFieldError(form, path)]));
/** Where the active starter keeps its threshold, held while the sentence still waits for a choice. */
const thresholdKind = computed(() => (props.active ? thresholdPaths(fillFor(props.active)) : null));
// Bound only while the form holds what the starter wrote; a query rebuilt in step 2 is edited there.
const threshold = computed(() => {
  const paths = thresholdKind.value;
  if (!paths || needsChoice.value || !guide?.value) return null;
  const type = fillFor(props.active!).values["query_condition.type"];
  if (read("query_condition.type") !== type) return null;
  if (type === "promql") return paths;
  const aggregated = paths.value.startsWith("query_condition.aggregation");
  return aggregated === !!read("query_condition.aggregation") ? paths : null;
});
const thresholdValue = computed(() => (threshold.value ? read(threshold.value.value) : undefined));
const thresholdMissing = computed(
  () => !!threshold.value && (thresholdValue.value === "" || thresholdValue.value == null),
);
const thresholdError = computed(() =>
  threshold.value ? errors[threshold.value.value]?.value : undefined,
);
// A count names what it counts; any other value takes the unit step 2 shows beside its field.
const unitWord = computed(() =>
  props.active === "countWhere"
    ? dataNoun(props.streamType, "custom", Number(thresholdValue.value) === 1 ? 1 : 2, t)
    : (guide?.value?.unit.value ?? ""),
);
const formAgg = computed(() => String(read("query_condition.aggregation.function") ?? "avg"));
const aggOptions = computed<SelectOption[]>(() =>
  [...new Set<string>([...METRIC_AGGS, formAgg.value])].map((fn) => ({
    label: t(`alerts.queryConfig.functions.${fn}` as I18nKey),
    value: fn,
  })),
);
const typeThreshold = (path: string, value: unknown) => {
  guide?.value?.change(path, value);
  emit("threshold");
};
const offersDefaults = computed(
  () => !!props.active && props.active !== "unusualVolume" && props.active !== "unusualChange",
);

const apply = (id: IntentId) => {
  const label = intentLabel(id);
  if (missingFor(id)) emit("pending", { intent: id, label });
  else emit("apply", { fill: fillFor(id), label });
};

/** Fills empty slots with the first candidate that passes the slot's rule; none passing leaves it empty. */
const seedSlots = (id: IntentId) => {
  if (!wantsGroup(id)) slots.group = undefined;
  else if (slots.group === undefined) slots.group = groupCandidates.value.fit[0];
  if (id === "percentile" && !isMetrics.value) slots.measure ??= measureCandidates.value.fit[0];
  if (id === "compareLastWeek") slots.factor ??= DEFAULT_FACTOR;
  if (!wantsValue(id)) return;
  if (isMetrics.value) slots.label ??= categoriesFor(id).fit[0];
  else slots.field ??= categoriesFor(id).fit[0];
};

// The preview's default range (3 look-back windows, at least 5 min), so its value counts are shared.
const previewWindowUs = () => Math.max(3 * props.periodMinutes, 5) * 60_000_000;

/** The value slot waits for the field's counts, then suggests the largest minority seen recently. */
const seedValues = async (id: IntentId) => {
  // Which one entity a volume watches is the user's pick, so only its values load.
  if (id === "unusualVolume" && slots.field && !isMetrics.value) {
    void loadValueCounts(valueContext.value, slots.field);
    return;
  }
  if (!wantsValue(id) || slots.values?.length) return;
  if (isMetrics.value) {
    const value = starterValue(labelValues.value);
    slots.values = value ? [value] : [];
    seeded.value = [...(slots.values ?? [])];
    alternative.value = starterAlternative(labelValues.value);
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
  seeded.value = [...(slots.values ?? [])];
  alternative.value = starterAlternative(day.values, recent.values);
};

const choose = async (id: IntentId) => {
  analytics.track("alert_intent_applied", { intent: id, stream_type: props.streamType });
  if (!props.active) typeAtPick.value = props.howItChecks;
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

const setSlot = async (
  slot: "field" | "group" | "measure" | "label" | "agg",
  value: SelectModelValue,
) => {
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
  const next = pickedValues(picked, previous, seeded.value);
  slots.values = [...new Set([...next.values, ...variants])];
  const offered = patternOptions.value.map((o) => String(o.value));
  keepPatterns(added.filter((v) => offered.includes(v)));
  seeded.value = next.seeded;
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
  const next = pickedValues([...new Set([...previous, text])], previous, seeded.value);
  slots.values = next.values;
  keepPatterns(text === typed ? [] : [text]);
  seeded.value = next.seeded;
};

const seenValues = computed(() => (isMetrics.value ? labelValues.value : fieldValues.value));
// Shown only while the suggested value still stands, so a user's own pick is never second-guessed.
const swapOffer = computed(() =>
  alternative.value &&
  seeded.value.length > 0 &&
  (slots.values ?? []).every((v) => seeded.value.includes(v))
    ? alternative.value
    : undefined,
);
const swapValue = () => {
  const value = swapOffer.value;
  if (!value) return;
  const was = seeded.value.find((v) => seenValues.value.some((s) => s.value === v));
  slots.values = isMetrics.value ? [value] : withCaseVariants([value], seenValues.value);
  seeded.value = [...(slots.values ?? [])];
  alternative.value = was;
  reapply();
};
const otherSpellings = computed(() =>
  wantsValueSlot.value ? spellingVariants(slots.values ?? [], seenValues.value) : [],
);
const addSpellings = () => {
  slots.values = [...(slots.values ?? []), ...otherSpellings.value];
  seeded.value = [];
  reapply();
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
// The org's alerts say whether a card's installed copy alerts at another value than the card does.
const installed = orgAlerts;
const comparisonText = (c: AlertThreshold) =>
  raw(`${operatorSymbol(c.operator)} ${formatNumber(c.value)}`);
const setUpComparison = (card: LibrarySuggestion) => {
  const id = card.already_set_up[0]?.alert_id;
  const row = (installed.data.value?.list ?? []).find((r) => r.alert_id === id);
  const differs = row ? installedThresholdDiffers(card.prefill, row as LookAlikeAlert) : null;
  return differs
    ? { installed: comparisonText(differs.installed), suggested: comparisonText(differs.suggested) }
    : undefined;
};
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
