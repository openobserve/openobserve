<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  SLO form (alerts_2.md §6b.10).

  Two things the form does that a plain CRUD form would not:

  * It shows the error budget the target implies, live. "99.9%" is abstract; "43 minutes of downtime per 30 days" is what someone actually decides on.
  * It shows the row reservation before saving, because a budget rejection at save time with no warning is a bad experience — and the arithmetic is the same one the backend charges (S-14).

  Grouped SLOs are pinned to 5-minute slices (D30), enforced here as well as at
  the API so the form cannot present a combination the backend will reject.
-->
<template>
  <OPageLayout
    :title="isEdit ? t('slos.editTitle') : t('slos.newTitle')"
    icon="track-changes"
    :back="{ to: backTarget, label: t('slos.title') }"
    scroll
    pad-y
    title-data-test="slos-addslo-title"
  >
    <template #actions>
      <OButton variant="outline" size="sm-action" @click="cancel">
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="saving"
        data-test="slos-addslo-save"
        @click="save"
      >
        {{ t("common.save") }}
      </OButton>
    </template>

    <OBanner v-if="error" variant="error" class="mb-3" data-test="slos-addslo-error">
      {{ error }}
    </OBanner>

    <!-- A regeneration is not a normal edit: it discards every measurement
         taken under the old definition. Warned before saving, not after. -->
    <OBanner
      v-if="isEdit && definitionChanged"
      variant="warning"
      icon="restart_alt"
      class="mb-3"
      data-test="slos-addslo-regen-warning"
    >
      <span class="font-bold">{{ t("slos.regenerate.title") }}</span>
      {{ t("slos.regenerate.body") }}
    </OBanner>

    <!-- The right column is 33rem (was 22rem, +50%): it now hosts the two
         preview charts as well as the summary, and bars need the width to
         stay readable.
         `minmax(0, 1fr)` for the left, NOT `1fr`: a bare `1fr` carries an
         implicit `min-width: auto`, so the column refuses to shrink below its
         content's intrinsic width and the grid overflows the viewport — which
         is the horizontal page scroll. `minmax(0, …)` lets it actually take
         only the remaining space. -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_33rem]">
      <!-- `min-w-0` for the same reason as the track above: a flex item's
           default `min-width: auto` would let a wide child (the query
           editors) push the column past its share. -->
      <div class="flex min-w-0 flex-col gap-4">
        <OFormSection :title="t('slos.section.identity')">
          <!-- One row: folder, name, tags — in that order. The folder column
               is fixed-width so the name (the field people actually type in)
               takes the slack; tags get their own share. Wraps to a column on
               narrow screens rather than crushing three controls. -->
          <div class="grid grid-cols-1 items-end gap-3 md:grid-cols-[14rem_1fr_1fr]">
            <div>
              <label class="text-text-secondary mb-1 block text-xs">
                {{ t("slos.field.folder") }}
              </label>
              <!-- type="alerts": SLOs live in alert folders (there is no SLO
                   folder type), so this offers the same folders the Alerts
                   page does. -->
              <SelectFolderDropDown
                type="alerts"
                :active-folder-id="form.folder_id"
                @folder-selected="onFolderSelected"
              />
            </div>
            <OInput
              v-model="form.name"
              :label="t('slos.field.name')"
              :placeholder="t('slos.field.namePlaceholder')"
              required
              data-test="slos-addslo-name"
            />
            <!-- Label sits ABOVE the field, not floating inside it — the same
                 shape the alert form uses (and the same shape OInput renders
                 next door), so the row reads as one set of labelled fields.
                 The wrapper is also what stops OTagInput's `h-full` root from
                 stretching and swallowing what follows. -->
            <div class="flex flex-col gap-1">
              <label
                class="o-input-label text-compact text-input-label-text flex items-center gap-1 leading-tight font-medium"
              >
                {{ t("slos.field.tags") }}
              </label>
              <OTagInput
                v-model="form.tags"
                :placeholder="t('slos.field.tagsPlaceholder')"
                data-test="slos-addslo-tags"
              />
            </div>
          </div>
          <OInput
            v-model="form.description"
            :label="t('slos.field.description')"
            type="textarea"
            class="mt-3"
            data-test="slos-addslo-description"
          />
        </OFormSection>

        <OFormSection :title="t('slos.section.sli')">
          <OToggleGroup v-model="form.sli_type" data-test="slos-addslo-sli-type">
            <OToggleGroupItem
              v-for="opt in sliTypeOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              :data-test="`slos-addslo-sli-type-${opt.value}`"
            >
              <template #icon-left>
                <OIcon :name="opt.icon" size="sm" />
              </template>
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
          <p class="text-text-secondary mt-1 text-xs" data-test="slos-addslo-sli-type-description">
            {{ sliTypeDescription }}
          </p>

          <template v-if="form.sli_type === 'count'">
            <div class="mt-3 grid grid-cols-2 gap-3">
              <OSelect
                v-model="form.config.stream_type"
                :label="t('slos.field.streamType')"
                :options="streamTypeOptions"
                :searchable="false"
                data-test="slos-addslo-stream-type"
                @update:model-value="onStreamTypeChange"
              />
              <OSelect
                v-model="form.config.stream"
                :label="t('slos.field.stream')"
                :options="streamOptions"
                :loading="isFetchingStreams"
                :disabled="!form.config.stream_type"
                :placeholder="t('slos.field.streamPlaceholder')"
                required
                data-test="slos-addslo-stream"
              />
            </div>
            <!-- Different SHAPES, not dialects — so the choice comes before
                 the fields. Offered only here: PromQL cannot address logs. -->
            <OToggleGroup
              v-if="isMetricsStream"
              :model-value="metricsLanguage"
              :label="t('slos.field.queryLanguage')"
              class="mt-3"
              data-test="slos-addslo-count-language"
              @update:model-value="onMetricsLanguageChange"
            >
              <OToggleGroupItem
                v-for="opt in queryLanguageOptions"
                :key="opt.value"
                :value="opt.value"
                size="sm"
                :data-test="`slos-addslo-count-language-${opt.value}`"
              >
                {{ opt.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <!-- Two expressions and no predicate, because that is the shape
                 `CountSource::PromQl` has: a pre-aggregated counter holds no
                 rows for a `good_expr` to classify, so "good" only exists as
                 arithmetic between series. The variant stores no stream and no
                 scope; the stream picker above is left in place because it
                 still loads the schema the group-by list is drawn from, which
                 for a metrics stream is its label set. (Nothing reloads it on
                 an edit, since the stored source has no stream to reopen with —
                 grouping an existing PromQL count SLO means re-picking one.) -->
            <template v-if="isPromqlCount">
              <SloExpressionField
                v-model="form.config.good"
                editor-id="slo-count-promql-good-editor"
                :label="t('slos.field.countGoodPromql')"
                :hint="t('slos.field.countGoodPromqlHint')"
                language="prom_ql"
                required
                class="mt-3"
                data-test="slos-addslo-promql-good"
              />
              <SloExpressionField
                v-model="form.config.total"
                editor-id="slo-count-promql-total-editor"
                :label="t('slos.field.countTotalPromql')"
                :hint="t('slos.field.countTotalPromqlHint')"
                language="prom_ql"
                required
                class="mt-3"
                data-test="slos-addslo-promql-total"
              />
              <!-- The evaluator samples at slice ends, so a range selector that
                   is not one slice wide double-counts or misses events — with a
                   perfectly plausible SLI at the end of it. -->
              <p class="text-text-secondary mt-1 text-xs" data-test="slos-addslo-count-promql-hint">
                {{ t("slos.field.countPromqlRangeHint", { range: promqlRangeLiteral }) }}
              </p>
            </template>
            <template v-else>
              <SloExpressionField
                v-model="form.config.scope"
                editor-id="slo-scope-editor"
                :label="t('slos.field.scope')"
                :hint="t('slos.field.scopeHint')"
                :keywords="effectiveKeywords"
                :suggestions="effectiveSuggestions"
                :field-value-resolver="resolveFieldValues"
                class="mt-3"
                data-test="slos-addslo-scope"
              />
              <SloExpressionField
                v-model="form.config.good_expr"
                editor-id="slo-good-expr-editor"
                :label="t('slos.field.goodWhen')"
                :hint="t('slos.field.goodWhenHint')"
                :keywords="effectiveKeywords"
                :suggestions="effectiveSuggestions"
                :field-value-resolver="resolveFieldValues"
                required
                class="mt-3"
                data-test="slos-addslo-good-expr"
              />
            </template>
          </template>

          <template v-else-if="form.sli_type === 'time_slice'">
            <div class="mt-3 grid grid-cols-2 gap-3">
              <OSelect
                v-model="form.config.stream_type"
                :label="t('slos.field.streamType')"
                :options="streamTypeOptions"
                :searchable="false"
                data-test="slos-addslo-timeslice-stream-type"
                @update:model-value="onStreamTypeChange"
              />
              <OSelect
                v-model="form.config.stream"
                :label="t('slos.field.stream')"
                :options="streamOptions"
                :loading="isFetchingStreams"
                :disabled="!form.config.stream_type"
                :placeholder="t('slos.field.streamPlaceholder')"
                required
                data-test="slos-addslo-timeslice-stream"
              />
            </div>
            <OToggleGroup
              v-if="isMetricsStream"
              :model-value="metricsLanguage"
              :label="t('slos.field.queryLanguage')"
              class="mt-3"
              data-test="slos-addslo-timeslice-language"
              @update:model-value="onMetricsLanguageChange"
            >
              <OToggleGroupItem
                v-for="opt in queryLanguageOptions"
                :key="opt.value"
                :value="opt.value"
                size="sm"
                :data-test="`slos-addslo-timeslice-language-${opt.value}`"
              >
                {{ opt.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <!-- The same editor as `scope` below it and `good when` above,
                 because this is the same kind of thing: an expression over the
                 stream. It is in fact the field with the strongest claim on
                 the typeahead — the aggregate names a column, and a mistyped
                 column is invisible until the ingest query fails.
                 The field follows the CHOSEN language, so the same control
                 serves both. -->
            <SloExpressionField
              v-model="form.config.query"
              editor-id="slo-aggregate-editor"
              :label="aggregateLabel"
              :hint="aggregateHint"
              :language="timeSliceLanguage"
              :keywords="effectiveKeywords"
              :suggestions="effectiveSuggestions"
              :field-value-resolver="resolveFieldValues"
              class="mt-3"
              required
              data-test="slos-addslo-aggregate"
            />
            <!-- Prometheus keeps answering for a metric that stopped being
                 written, for as long as its lookback delta — so a freshness
                 objective built on a bare gauge notices silence late. -->
            <p
              v-if="isPromqlTimeSlice"
              class="text-text-secondary mt-1 text-xs"
              data-test="slos-addslo-promql-absent-note"
            >
              {{ t("slos.field.promqlAbsentHint") }}
            </p>
            <div class="mt-3 grid grid-cols-2 gap-3">
              <OSelect
                v-model="form.config.comparator"
                :label="t('slos.field.comparator')"
                :options="comparatorOptions"
                data-test="slos-addslo-comparator"
              />
              <OInput
                v-model.number="form.config.threshold"
                :label="t('slos.field.threshold')"
                type="number"
                data-test="slos-addslo-threshold"
              />
            </div>
            <!-- Hidden, not just ignored, in PromQL: a scope reaches a SQL
                 plan as a `WHERE (…)` fragment and a PromQL plan is the bare
                 expression, so there is nowhere to put one — the API rejects a
                 non-empty scope rather than narrow nothing. -->
            <SloExpressionField
              v-if="!isPromqlTimeSlice"
              v-model="form.config.scope"
              editor-id="slo-timeslice-scope-editor"
              :label="t('slos.field.scope')"
              :keywords="effectiveKeywords"
              :suggestions="effectiveSuggestions"
              :field-value-resolver="resolveFieldValues"
              class="mt-3"
              data-test="slos-addslo-timeslice-scope"
            />
          </template>

          <!-- The picker offers every alert in the org, but only the ones the
               server would accept are selectable — an ineligible alert stays
               listed with the reason, because "your alert is missing" is not
               an explanation and each reason has a remedy. -->
          <template v-else>
            <OSelect
              v-model="form.config.alert_id"
              :label="t('slos.alertSli.source')"
              :options="alertSourceOptions"
              :loading="isFetchingAlertSources"
              :placeholder="t('slos.alertSli.sourcePlaceholder')"
              required
              class="mt-3"
              data-test="slos-addslo-alert-source"
              @update:model-value="onAlertSourceChange"
            />
            <p class="text-text-secondary mt-1 text-xs" data-test="slos-addslo-alert-source-hint">
              {{ t("slos.alertSli.sourceHint") }}
            </p>
            <OBanner
              v-if="alertSourceError"
              variant="error"
              class="mt-3"
              data-test="slos-addslo-alert-source-error"
            >
              {{ alertSourceError }}
            </OBanner>
            <OBanner
              v-else-if="!isFetchingAlertSources && !hasEligibleAlert"
              variant="info"
              class="mt-3"
              data-test="slos-addslo-alert-source-empty"
            >
              {{ t("slos.alertSli.noneEligible") }}
            </OBanner>
          </template>
        </OFormSection>

        <OFormSection :title="t('slos.section.objective')">
          <div class="grid grid-cols-2 gap-3">
            <OInput
              v-model.number="form.target"
              :label="t('slos.field.target')"
              type="number"
              step="0.001"
              suffix="%"
              required
              data-test="slos-addslo-target"
            />
            <div class="text-compact text-text-secondary flex items-end pb-2">
              {{ budgetHint }}
            </div>
          </div>

          <!-- OToggleGroup renders OToggleGroupItem children; it has no
                 `options` prop. Passing one rendered an empty bar, which left
                 S-3's rolling window and S-4's slice interval unreachable. -->
          <OToggleGroup
            v-model="form.window_secs"
            :label="t('slos.field.window')"
            class="mt-3"
            data-test="slos-addslo-window"
          >
            <OToggleGroupItem
              v-for="opt in windowOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              :data-test="`slos-addslo-window-${opt.value}`"
            >
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OToggleGroup
            v-model="form.slice_interval_secs"
            :label="t('slos.field.sliceInterval')"
            class="mt-3"
            data-test="slos-addslo-slice"
          >
            <OToggleGroupItem
              v-for="opt in sliceOptions"
              :key="opt.value"
              :value="opt.value"
              :disabled="opt.disable"
              size="sm"
              :data-test="`slos-addslo-slice-${opt.value}`"
            >
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
          <p v-if="isGrouped" class="text-compact text-text-secondary mt-1">
            {{ t("slos.groupedSliceNote") }}
          </p>
          <!-- The choice is only ever interesting for one reason, and it is a
               different reason per SLI type — so say which one applies rather
               than describing both and leaving the reader to work out which
               half is theirs. -->
          <p
            v-else
            class="text-compact text-text-secondary mt-1"
            data-test="slos-addslo-slice-note"
          >
            {{ sliceNote }}
          </p>
        </OFormSection>

        <OFormSection :title="t('slos.section.grouping')">
          <!-- Constraining wrapper: OTagInput's root is `h-full`. -->
          <OSelect
            v-model="groupByList"
            :label="t('slos.field.groupBy')"
            :options="streamFieldNames"
            multiple
            :disabled="isAlertSli"
            :placeholder="t('slos.field.groupByPlaceholder')"
            data-test="slos-addslo-group-by"
          />
          <p
            v-if="isAlertSli"
            class="text-compact text-text-secondary mt-1"
            data-test="slos-addslo-group-by-locked"
          >
            {{ t("slos.alertSli.groupingLocked") }}
          </p>
          <OInput
            v-if="isGrouped"
            v-model.number="form.groups_estimate"
            :label="t('slos.field.groupsEstimate')"
            :hint="t('slos.field.groupsEstimateHint')"
            type="number"
            class="mt-3"
            data-test="slos-addslo-groups-estimate"
          />
        </OFormSection>
      </div>

      <div class="flex flex-col gap-4">
        <!-- Preview sits above the summary: it answers the question being
             asked while the left column is still being filled in. Which
             question that is depends on the SLI type — a count SLI is a
             PREDICATE and the doubt is whether it is right; a time-slice SLI
             is a NUMBER and the doubt is whether it is set anywhere sensible.
             So each gets its own preview rather than one being bent to serve
             both. An alert SLI's doubt is a third thing again — not "is this
             right" but "has this alert actually been running" — which is what
             the uptime ribbon answers. -->
        <SloPreviewChart
          v-if="showCountPreview"
          data-test="slos-addslo-preview-section"
          :stream-type="form.config.stream_type"
          :stream="form.config.stream"
          :scope="form.config.scope"
          :good-expr="form.config.good_expr"
          :good="form.config.good"
          :total="form.config.total"
          :query-language="countLanguage"
          :slice-interval-secs="form.slice_interval_secs"
        />
        <SloTimeSlicePreview
          v-else-if="form.sli_type === 'time_slice' && form.config.stream && form.config.query"
          data-test="slos-addslo-timeslice-preview-section"
          :stream-type="form.config.stream_type"
          :stream="form.config.stream"
          :scope="form.config.scope"
          :aggregate="form.config.query"
          :query-language="timeSliceLanguage"
          :grouped="isGrouped"
          :comparator="form.config.comparator"
          :threshold="form.config.threshold"
          :slice-interval-secs="form.slice_interval_secs"
          :target="form.target"
        />
        <SloAlertPreview
          v-else-if="isAlertSli && form.config.alert_id"
          data-test="slos-addslo-alert-preview-section"
          :alert-id="form.config.alert_id"
          :window-secs="form.window_secs"
          :slice-interval-secs="form.slice_interval_secs"
        />

        <!-- Summary. Mirrors the backend's own arithmetic so a budget rejection
           at save time is never the first time a user sees the numbers. -->
        <OFormSection :title="t('slos.section.summary')" class="h-fit">
          <dl class="text-compact grid grid-cols-[8rem_1fr] gap-y-2">
            <dt class="text-text-secondary">{{ t("slos.field.sliType") }}</dt>
            <dd>{{ sliTypeLabel(form.sli_type, t) }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.target") }}</dt>
            <dd>{{ formatTarget(form.target || 0) }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.window") }}</dt>
            <dd>{{ formatWindow(form.window_secs) }} {{ t("slos.rolling") }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.errorBudget") }}</dt>
            <dd>{{ budgetDuration }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.maxBurnRate") }}</dt>
            <dd>×{{ maxBurn }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.groupBy") }}</dt>
            <dd>{{ isGrouped ? groupByList.join(", ") : t("slos.noGrouping") }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.reservation") }}</dt>
            <dd>{{ reservationLabel }}</dd>
          </dl>

          <OBanner variant="info" class="mt-3">
            {{ t("slos.backfillNote") }}
          </OBanner>
        </OFormSection>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import SloAlertPreview from "@/components/slos/SloAlertPreview.vue";
import SloPreviewChart from "@/components/slos/SloPreviewChart.vue";
import SloTimeSlicePreview from "@/components/slos/SloTimeSlicePreview.vue";
import SloExpressionField from "@/components/slos/SloExpressionField.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import sloService from "@/services/slos";
import { formatTarget, formatWindow, sliTypeLabel } from "@/composables/useSloFormat";
import { smallestLegalSlice } from "@/utils/slos/alertSource";
import type { SloEligibleAlert } from "@/ts/interfaces/slo";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const saving = ref(false);
const error = ref<string | null>(null);
const original = ref<string>("");

const sloId = computed(() => String(route.params.slo_id || ""));
const isEdit = computed(() => !!sloId.value);
const org = computed(() => store.state.selectedOrganization?.identifier);

const form = reactive<any>({
  name: "",
  description: "",
  tags: [],
  sli_type: "count",
  config: { stream_type: "logs", stream: "", scope: "", good_expr: "" },
  target: 99.9,
  window_secs: 30 * 86400,
  // 5 minutes, not 1. For a count SLI the slice width does not touch the
  // arithmetic at all — the window SLI is Σgood/Σtotal, and repartitioning the
  // same events into different buckets changes neither sum — so a 60s slice
  // buys bit-identical numbers for 5× the stored rows (139,680 per series at
  // the 97-day horizon against 27,936). A time-slice SLI is the exception,
  // because there the slice IS the unit scored good or bad; see the hint under
  // the control.
  slice_interval_secs: 300,
  group_by: null,
  groups_estimate: null,
  enabled: true,
  // An ALERT folder — SLOs share that namespace rather than having their own
  // folder type. Seeded from the folder the list was showing so "New SLO" from
  // inside a folder lands in it, not in default.
  folder_id: (route.query.folder as string) || "default",
});

const groupByList = ref<string[]>([]);
const isGrouped = computed(() => groupByList.value.length > 0);

const sliTypeOptions = computed(() => [
  {
    value: "count",
    label: t("slos.type.count"),
    icon: "functions",
    description: t("slos.type.countDescription"),
  },
  {
    value: "time_slice",
    label: t("slos.type.timeSlice"),
    icon: "timelapse",
    description: t("slos.type.timeSliceDescription"),
  },
  {
    value: "alert",
    label: t("slos.type.alert"),
    icon: "gpp_maybe",
    description: t("slos.type.alertDescription"),
  },
]);

const isAlertSli = computed(() => form.sli_type === "alert");

const sliTypeDescription = computed(
  () => sliTypeOptions.value.find((o) => o.value === form.sli_type)?.description ?? "",
);

const streamTypeOptions = computed(() => [
  { value: "logs", label: t("common.logs") },
  { value: "metrics", label: t("common.metrics") },
  { value: "traces", label: t("common.traces") },
]);

// ── Stream picker ─────────────────────────────────────────────────────────
// Same shape as the alert form: pick a stream TYPE, then pick a stream NAME
// from what that type actually has. A free-text box let a typo through to the
// backend, where the SLO saves and then measures nothing — the failure only
// shows up later as permanent no-data.
const { getStreams } = useStreams(t);
const streamOptions = ref<string[]>([]);
const isFetchingStreams = ref(false);

async function loadStreams(streamType: string) {
  if (!streamType) {
    streamOptions.value = [];
    return;
  }
  isFetchingStreams.value = true;
  try {
    // `useStreams` caches per type, so switching back and forth is free.
    const res: any = await getStreams(streamType, false);
    streamOptions.value = (res?.list ?? []).map((s: any) => s.name);
  } catch {
    // A failed list must not block the form: leave the picker empty rather
    // than trapping the user on a page that cannot be completed.
    streamOptions.value = [];
  } finally {
    isFetchingStreams.value = false;
  }
}

/// Changing the type invalidates the chosen stream — a `logs` stream name is
/// not a `metrics` one, and silently keeping it would submit a stream that
/// does not exist under the new type.
function onStreamTypeChange(value: unknown) {
  form.config.stream = "";
  // Picking metrics is a fresh start, and PromQL is what one starts as. The
  // other types have no choice to offer, so the ref is left alone for them.
  if (String(value ?? "") === "metrics") metricsLanguage.value = "prom_ql";
  loadStreams(String(value ?? ""));
}

// ── Field typeahead ─────────────────────────────────────────────────────────
// The selected stream's schema feeds three places: token suggestions inside
// the scope / good-when expressions, and the group-by picker. Loaded when the
// stream changes; a failure leaves the inputs as plain text rather than
// blocking the form.
const { getStream } = useStreams(t);
const streamFields = ref<{ label: string; value: string }[]>([]);
const streamFieldNames = computed(() => streamFields.value.map((f) => f.value));

// The expression editors are the SAME editor the logs search bar uses, so
// their completions come from the SAME machinery — `updateFieldKeywords`
// builds the field list (dropping the timestamp column) and merges it with
// the SQL keyword and function sets. Nothing about autocomplete is
// reimplemented here.
const {
  autoCompleteData,
  effectiveKeywords,
  effectiveSuggestions,
  updateFieldKeywords,
  resolveFieldValues,
} = useSqlSuggestions();

async function loadStreamFields(streamName: string) {
  // Field VALUES are looked up under "org|streamType|streamName|field", so the
  // resolver returns nothing at all until this is set. Cleared alongside the
  // field list so a de-selected stream cannot keep offering its old values.
  autoCompleteData.value.org = org.value ?? "";
  autoCompleteData.value.streamType = String(form.config.stream_type ?? "");
  autoCompleteData.value.streamName = streamName;

  if (!streamName || !form.config.stream_type) {
    streamFields.value = [];
    updateFieldKeywords([]);
    return;
  }
  try {
    const data: any = await getStream(streamName, form.config.stream_type, true);
    const schema = data?.schema ?? [];
    streamFields.value = schema
      .map((c: any) => ({ label: c.name, value: c.name }))
      .sort((a: any, b: any) => a.value.localeCompare(b.value));
    updateFieldKeywords(schema);
  } catch {
    streamFields.value = [];
    updateFieldKeywords([]);
  }
}

watch(
  () => form.config.stream,
  (stream) => loadStreamFields(String(stream ?? "")),
);

// ── Query language ──────────────────────────────────────────────────────────
// A metrics stream is an ordinary stream with a `value` column, so SQL reaches
// it as well as PromQL does — `language_suits_stream` accepts both. Which one
// is therefore a CHOICE, not something the stream type can answer; the other
// stream types have no choice to make, because PromQL cannot address them.
const metricsLanguage = ref<"sql" | "prom_ql">("prom_ql");

const queryLanguageOptions = [
  { value: "prom_ql", label: raw("PromQL") },
  { value: "sql", label: raw("SQL") },
];

/** The narrowing point for both untyped sources of a language: the toggle's
 *  item value and a stored definition's. Anything unrecognised leaves the
 *  default standing rather than becoming it. */
function onMetricsLanguageChange(value: unknown) {
  if (value === "sql" || value === "prom_ql") metricsLanguage.value = value;
}

const isMetricsStream = computed(() => form.config.stream_type === "metrics");

const timeSliceLanguage = computed<"sql" | "prom_ql">(() =>
  isMetricsStream.value ? metricsLanguage.value : "sql",
);

const isPromqlTimeSlice = computed(
  () => form.sli_type === "time_slice" && timeSliceLanguage.value === "prom_ql",
);

const aggregateLabel = computed(() =>
  isPromqlTimeSlice.value ? t("slos.field.aggregatePromql") : t("slos.field.aggregate"),
);

const aggregateHint = computed(() =>
  isPromqlTimeSlice.value ? t("slos.field.aggregatePromqlHint") : t("slos.field.aggregateHint"),
);

// Derived from the MODEL, not from the stream-type picker's handler: one
// config object is shared across SLI types, so this branch can open with
// `metrics` already chosen and no event ever fired on its own picker.
watch(
  () => [form.sli_type, timeSliceLanguage.value],
  () => {
    // Left in place for the other SLI types, not deleted: the stored value is
    // the only record of which language the query was written in, and an
    // excursion through the count branch would otherwise erase it and let a
    // PromQL expression come back declared as SQL. `wireConfig` drops the key
    // where it does not belong.
    if (form.sli_type !== "time_slice") return;

    // `SliConfig::TimeSlice.comparator` has no serde default, so a dropdown the
    // user never opened is a 422 rather than an empty field. Seeded only when
    // blank — a stored comparator is the definition and must survive an edit.
    if (!form.config.comparator) form.config.comparator = "<";

    const next = timeSliceLanguage.value;
    const previous = form.config.query_language;
    form.config.query_language = next;
    // A FLIP, not a first assignment: a definition stored before the
    // discriminator existed carries none, and reading that absence as a change
    // would wipe its query the moment it is opened.
    if (previous && previous !== next) form.config.query = "";
    // The scope field is hidden in PromQL and a non-empty one is rejected, so
    // a fragment left by another language — or by the count branch, which
    // shares this object — must not ride along.
    if (next === "prom_ql") form.config.scope = "";
  },
  { immediate: true },
);

// ── Count SLI shape ─────────────────────────────────────────────────────────
// The same choice as the time-slice language, and the same default: PromQL
// over metrics. A PromQL count is `CountSource::PromQl` — two expressions and
// no stream — where a SQL one is `SingleQuery`, so this picks the SHAPE too.
const countLanguage = computed<"sql" | "prom_ql">(() =>
  isMetricsStream.value ? metricsLanguage.value : "sql",
);

const isPromqlCount = computed(
  () => form.sli_type === "count" && countLanguage.value === "prom_ql",
);

/** The range selector the expressions should carry: exactly one slice. */
const promqlRangeLiteral = computed(
  () => `${Math.max(1, Math.round(form.slice_interval_secs / 60))}m`,
);

const showCountPreview = computed(() => {
  if (form.sli_type !== "count") return false;
  // A PromQL count source has no stream, so requiring one would leave the
  // preview permanently blank; it needs BOTH expressions instead, because the
  // SLI is good ÷ total.
  return isPromqlCount.value
    ? !!form.config.good && !!form.config.total
    : !!form.config.stream && !!form.config.good_expr;
});

/** Which shape the count fields were last written for. A FLIP is what clears
 *  them — a first assignment must not, or hydrating a stored definition would
 *  wipe it on open. Mirrors the time-slice watcher above. */
let previousCountLanguage: "sql" | "prom_ql" | null = null;
watch(
  () => [form.sli_type, countLanguage.value],
  () => {
    if (form.sli_type !== "count") return;
    const next = countLanguage.value;
    const previous = previousCountLanguage;
    previousCountLanguage = next;
    if (!previous || previous === next) return;
    // The two shapes share one flat config, and `CountSource` ignores a spare
    // key rather than rejecting it — so a fragment left by the other shape
    // would ride into the payload in silence. Cleared in the MODEL, not merely
    // filtered at save: a value left in the form reappears on the way back.
    if (next === "prom_ql") {
      form.config.scope = "";
      form.config.good_expr = "";
    } else {
      form.config.good = "";
      form.config.total = "";
    }
  },
  { immediate: true },
);

const comparatorOptions = [
  { value: "<", label: raw("<") },
  { value: "<=", label: raw("<=") },
  { value: ">", label: raw(">") },
  { value: ">=", label: raw(">=") },
];

const windowOptions = computed(() => [
  { value: 7 * 86400, label: t("slos.window.7d") },
  { value: 30 * 86400, label: t("slos.window.30d") },
  { value: 90 * 86400, label: t("slos.window.90d") },
]);

const sliceOptions = computed(() => [
  { value: 60, label: t("slos.slice.1m"), disable: isGrouped.value },
  { value: 300, label: t("slos.slice.5m") },
]);

/** What the slice width actually costs or buys, which is not the same question
 *  per SLI type.
 *
 *  For a count SLI it buys nothing: the window SLI is Σgood/Σtotal, so
 *  repartitioning the same events leaves both sums untouched and a finer slice
 *  returns bit-identical numbers for five times the rows.
 *
 *  Where the slice is itself scored good or bad — time-slice, and alert-uptime
 *  when it ships — the width IS the definition, and it sets the smallest amount
 *  of budget one failure can spend. That is the case worth paying for. */
const sliceNote = computed(() =>
  form.sli_type === "time_slice" || form.sli_type === "alert"
    ? t("slos.sliceNote.perSlice")
    : t("slos.sliceNote.count"),
);

// D30: grouped SLOs are pinned to 5-minute slices. Enforced here as well as at
// the API so the form cannot present a combination the backend will reject.
watch(isGrouped, (grouped) => {
  if (grouped) form.slice_interval_secs = 300;
});

// ── Alert SLI source ────────────────────────────────────────────────────────
// The picker is the only place that can explain WHY an alert cannot be a
// source before the user hits save, so ineligible alerts stay in the list with
// the server's own reason attached rather than being filtered away.
const alertSources = ref<SloEligibleAlert[]>([]);
const isFetchingAlertSources = ref(false);
const alertSourceError = ref<string | null>(null);

const hasEligibleAlert = computed(() => alertSources.value.some((a) => a.eligible));

const alertSourceOptions = computed(() =>
  alertSources.value.map((a) => ({
    value: a.alert_id,
    label: a.eligible
      ? raw(a.name)
      : t("slos.alertSli.ineligibleOption", { name: a.name, reason: a.reason ?? "" }),
    disabled: !a.eligible,
  })),
);

async function loadAlertSources() {
  if (!org.value) return;
  isFetchingAlertSources.value = true;
  alertSourceError.value = null;
  try {
    const res = await sloService.eligibleAlerts(org.value);
    alertSources.value = res.data?.list ?? [];
  } catch {
    alertSources.value = [];
    alertSourceError.value = t("slos.alertSli.loadFailed");
  } finally {
    isFetchingAlertSources.value = false;
  }
}

/** §5.1.3: the smallest legal slice at least as wide as the source's cadence.
 *
 *  Not the cadence itself — slices are pinned to 60/300, so a 120s cadence has
 *  no matching slice. Applying it here is what keeps the common path away from
 *  the `AlertSliSourceTooInfrequent` rejection. A cadence with no legal slice
 *  leaves the choice alone: such a source is refused by the picker anyway. */
function onAlertSourceChange(value: unknown) {
  const picked = alertSources.value.find((a) => a.alert_id === String(value ?? ""));
  if (!picked) return;
  const slice = smallestLegalSlice(picked.frequency_secs);
  if (slice !== null) form.slice_interval_secs = slice;
}

// An alert SLI cannot be grouped (D65): the ledger records one run per alert,
// not per group. Forced off as well as disabled, so a group_by chosen under
// another SLI type cannot ride along into the payload.
watch(
  isAlertSli,
  (isAlert) => {
    if (!isAlert) {
      // The flat config object is shared across SLI types, so a source left
      // behind here would ride into the next type's payload.
      delete form.config.alert_id;
      return;
    }
    groupByList.value = [];
    loadAlertSources();
  },
  { immediate: true },
);

/** "99.9%" is abstract. "43 minutes per 30 days" is what people decide on. */
const budgetDuration = computed(() => {
  const target = Number(form.target);
  if (!Number.isFinite(target) || target <= 0 || target >= 100) return "-";
  const errorFraction = (100 - target) / 100;
  const seconds = form.window_secs * errorFraction;
  if (seconds >= 86400) return t("slos.budgetDays", { n: (seconds / 86400).toFixed(1) });
  if (seconds >= 3600) return t("slos.budgetHours", { n: (seconds / 3600).toFixed(1) });
  return t("slos.budgetMinutes", { n: Math.round(seconds / 60) });
});

const budgetHint = computed(() => t("slos.budgetHint", { budget: budgetDuration.value }));

/** The SA-6 cap: an SLI of 0% cannot burn faster than 1/(1−target). */
const maxBurn = computed(() => {
  const target = Number(form.target);
  if (!Number.isFinite(target) || target <= 0 || target >= 100) return "-";
  return Math.round(1 / (1 - target / 100));
});

/** The same arithmetic the backend charges (S-14), so a rejection at save is
 *  never the first time these numbers are seen. */
const reservation = computed(() => {
  const groups = isGrouped.value
    ? Math.min(500, Math.max(64, (Number(form.groups_estimate) || 0) * 2))
    : 1;
  const HORIZON = 97 * 86400;
  const slices = Math.floor(HORIZON / form.slice_interval_secs);
  return { groups, rows: Math.ceil(groups * slices * 1.2) };
});

const reservationLabel = computed(() =>
  t("slos.reservationSummary", {
    groups: reservation.value.groups,
    rows: reservation.value.rows.toLocaleString(),
  }),
);

/** Whether the edit will bump the generation and discard measurement.
 *
 *  Mirrors the backend's `definition_changed`: everything except name,
 *  description, tags, owner and enabled. `target` is deliberately excluded —
 *  it is applied at read time (D56). */
const definitionChanged = computed(() => {
  if (!original.value) return false;
  return original.value !== definitionKey();
});

function definitionKey(): string {
  return JSON.stringify({
    sli_type: form.sli_type,
    config: wireConfig(),
    group_by: groupByList.value.length ? groupByList.value : null,
    window_secs: form.window_secs,
    slice_interval_secs: form.slice_interval_secs,
  });
}

const backTarget = computed(() => ({
  name: "sloList",
  // Carry the folder back, or cancelling out of a folder lands on default and
  // the SLO just saved looks like it vanished.
  query: { org_identifier: org.value, folder: form.folder_id },
}));

function onFolderSelected(folder: any) {
  form.folder_id = folder?.folderId ?? folder?.value ?? form.folder_id;
}

async function load() {
  if (!isEdit.value || !org.value) return;
  const res = await sloService.get(org.value, sloId.value);
  const body = res.data ?? {};
  // Unwrap the adjacent tagging back into the flat model the form edits.
  const cfg = body.config ?? {};
  const source = body.sli_type === "count" ? cfg.source : null;
  const flat = body.sli_type === "count" ? (source?.query ?? source ?? {}) : cfg;
  // A PromQL count source carries no `stream_type` — its MODE is the only
  // record that it addresses metrics. Defaulting to `logs` would reopen it as a
  // SQL definition and re-save it as one. (A `single_query` source does carry
  // one, and the spread below lets it win.)
  const countStreamType = source?.mode === "prom_ql" ? "metrics" : "logs";
  // Which language the definition was WRITTEN in — the count source's mode, or
  // the time slice's own discriminator. Both are legal over metrics, so the
  // stream type cannot answer it.
  const storedLanguage: unknown =
    body.sli_type === "count"
      ? source?.mode === "prom_ql"
        ? "prom_ql"
        : "sql"
      : cfg.query_language;
  Object.assign(form, {
    name: body.name,
    description: body.description ?? "",
    tags: body.tags ?? [],
    sli_type: body.sli_type,
    config: { stream_type: countStreamType, ...flat },
    target: body.target,
    window_secs: body.window_secs,
    slice_interval_secs: body.slice_interval_secs,
    groups_estimate: body.groups_estimate,
    enabled: body.enabled,
  });
  if (form.config.stream_type === "metrics") onMetricsLanguageChange(storedLanguage);
  groupByList.value = body.group_by ?? [];
  original.value = definitionKey();
}

/// Drop empty strings rather than sending them.
///
/// An empty `scope` is not "no scope" to the validator — it is an empty
/// predicate, and it is rejected. Absent is what "all rows" looks like.
function pruned(o: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== "" && v !== null && v !== undefined),
  );
}

/// Map the flat form model onto the wire shape.
///
/// `CountSource` is adjacently tagged (`mode`/`query`), so a count SLI's
/// config is `{source: {mode, query: {...}}}` — NOT the flat object the form
/// edits. `SliConfig::TimeSlice` is a struct variant, so its fields do sit
/// directly under `config`. Getting this wrong is a 422 with no useful
/// message, which is exactly how it was found.
function wireConfig(): Record<string, any> {
  if (form.sli_type === "count") {
    // `CountSource::PromQl` is exactly two expressions — no stream, no scope —
    // and BOTH keys have to be present even when empty: a missing one fails
    // deserialization (422, which says nothing actionable), where an empty one
    // comes back as the validator's own `EmptyExpression`. So no `pruned` here.
    if (isPromqlCount.value) {
      return {
        source: {
          mode: "prom_ql",
          query: { good: form.config.good ?? "", total: form.config.total ?? "" },
        },
      };
    }
    // An ALLOW-list, not a spread minus the keys we happen to remember: one
    // flat config is shared across every SLI type, so a spread also carries the
    // time-slice branch's `query`/`comparator`/`threshold` and the PromQL arm's
    // `good`/`total`. Serde drops them, but they sit inside `definitionKey()`
    // and would raise the regeneration banner over a definition nobody changed.
    const { stream, stream_type, scope, good_expr } = form.config;
    return {
      source: { mode: "single_query", query: pruned({ stream, stream_type, scope, good_expr }) },
    };
  }
  // `SliConfig::Alert` carries exactly one field, and the flat form model
  // still holds the stream keys the other types use — sending those would be a
  // 422 with no useful message.
  if (form.sli_type === "alert") {
    return { alert_id: form.config.alert_id ?? "" };
  }
  return {
    ...pruned(form.config),
    // The API never infers the language, so every time-slice definition has to
    // declare it. The watcher above sets it from the chosen language; the
    // fallback is only for a config that reached here without passing through.
    query_language: form.config.query_language ?? "sql",
  };
}

function payload() {
  const { config: _flat, groups_estimate, ...rest } = form as any;
  return {
    ...rest,
    groups_estimate: isGrouped.value ? groups_estimate : null,
    group_by: groupByList.value.length ? groupByList.value : null,
    config: wireConfig(),
  };
}

async function save() {
  error.value = null;
  saving.value = true;
  try {
    if (isEdit.value) {
      await sloService.update(org.value, sloId.value, payload());
    } else {
      await sloService.create(org.value, payload());
    }
    toast({ variant: "success", message: t("slos.saved") });
    router.push(backTarget.value);
  } catch (e: any) {
    // The backend's budget rejection carries its arithmetic (§6b.4d); show it
    // verbatim rather than replacing it with a generic message.
    error.value = e?.response?.data?.message || e?.message || t("slos.saveFailed");
  } finally {
    saving.value = false;
  }
}

function cancel() {
  router.push(backTarget.value);
}

onMounted(async () => {
  // Hydrate the SLO first so an edit reports its stored stream_type, then load
  // that type's streams — otherwise the picker opens empty and the stream the
  // SLO already uses looks unset.
  await load();
  await loadStreams(form.config.stream_type);
  // The stream watcher does not fire for the hydrated value.
  await loadStreamFields(form.config.stream ?? "");
});
</script>
