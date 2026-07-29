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
    icon="track_changes"
    :back="backTarget"
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

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
      <div class="flex flex-col gap-4">
        <SloSection :title="t('slos.section.identity')">
          <OInput
            v-model="form.name"
            :label="t('slos.field.name')"
            :placeholder="t('slos.field.namePlaceholder')"
            required
            data-test="slos-addslo-name"
          />
          <OInput
            v-model="form.description"
            :label="t('slos.field.description')"
            type="textarea"
            class="mt-3"
            data-test="slos-addslo-description"
          />
          <!-- OTagInput's root is `h-full`; without a constraining wrapper it
               stretches to fill the section and swallows what follows. -->
          <div class="mt-3">
            <OTagInput
              v-model="form.tags"
              :label="t('slos.field.tags')"
              placeholder=""
              data-test="slos-addslo-tags"
            />
          </div>
        </SloSection>
  
          <SloSection :title="t('slos.section.sli')">
            <ORadioCards
              v-model="form.sli_type"
              :options="sliTypeOptions"
              data-test="slos-addslo-sli-type"
            />
  
            <template v-if="form.sli_type === 'count'">
              <div class="grid grid-cols-2 gap-3 mt-3">
                <OSelect
                  v-model="form.config.stream_type"
                  :label="t('slos.field.streamType')"
                  :options="streamTypeOptions"
                  data-test="slos-addslo-stream-type"
                />
                <OInput
                  v-model="form.config.stream"
                  :label="t('slos.field.stream')"
                  required
                  data-test="slos-addslo-stream"
                />
              </div>
              <OInput
                v-model="form.config.scope"
                :label="t('slos.field.scope')"
                :hint="t('slos.field.scopeHint')"
                class="mt-3"
                placeholder="service = 'checkout'"
                data-test="slos-addslo-scope"
              />
              <OInput
                v-model="form.config.good_expr"
                :label="t('slos.field.goodWhen')"
                :hint="t('slos.field.goodWhenHint')"
                class="mt-3"
                required
                placeholder="status_code < 500"
                data-test="slos-addslo-good-expr"
              />
            </template>
  
            <template v-else-if="form.sli_type === 'time_slice'">
              <div class="grid grid-cols-2 gap-3 mt-3">
                <OSelect
                  v-model="form.config.stream_type"
                  :label="t('slos.field.streamType')"
                  :options="streamTypeOptions"
                />
                <OInput v-model="form.config.stream" :label="t('slos.field.stream')" required />
              </div>
              <OInput
                v-model="form.config.query"
                :label="t('slos.field.aggregate')"
                :hint="t('slos.field.aggregateHint')"
                class="mt-3"
                required
                placeholder="approx_percentile_cont(duration_ms, 0.95)"
              />
              <div class="grid grid-cols-2 gap-3 mt-3">
                <OSelect
                  v-model="form.config.comparator"
                  :label="t('slos.field.comparator')"
                  :options="comparatorOptions"
                />
                <OInput
                  v-model.number="form.config.threshold"
                  :label="t('slos.field.threshold')"
                  type="number"
                />
              </div>
              <OInput v-model="form.config.scope" :label="t('slos.field.scope')" class="mt-3" />
            </template>
  
            <OBanner v-else variant="info" class="mt-3">
              {{ t("slos.alertSli.unavailable") }}
            </OBanner>
          </SloSection>
  
          <SloSection :title="t('slos.section.objective')">
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
              <div class="flex items-end pb-2 text-compact text-text-secondary">
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
          </SloSection>
  
          <SloSection :title="t('slos.section.grouping')">
            <!-- Constraining wrapper: OTagInput's root is `h-full`. -->
            <div>
              <OTagInput
                v-model="groupByList"
                :label="t('slos.field.groupBy')"
                placeholder=""
                data-test="slos-addslo-group-by"
              />
            </div>
          <OInput
            v-if="isGrouped"
            v-model.number="form.groups_estimate"
            :label="t('slos.field.groupsEstimate')"
            :hint="t('slos.field.groupsEstimateHint')"
            type="number"
            class="mt-3"
            data-test="slos-addslo-groups-estimate"
          />
        </SloSection>
      </div>

      <!-- Summary. Mirrors the backend's own arithmetic so a budget rejection
           at save time is never the first time a user sees the numbers. -->
      <SloSection :title="t('slos.section.summary')" class="h-fit sticky top-4">
        <dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-compact">
          <dt class="text-text-secondary">{{ t("slos.field.sliType") }}</dt>
          <dd>{{ sliTypeLabel(form.sli_type) }}</dd>

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
      </SloSection>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import SloSection from "@/components/slos/SloSection.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORadioCards from "@/lib/forms/OptionGroup/OOptionGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import sloService from "@/services/slos";
import { formatTarget, formatWindow, sliTypeLabel } from "@/composables/useSloFormat";

const { t } = useI18n();
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
  slice_interval_secs: 60,
  group_by: null,
  groups_estimate: null,
  enabled: true,
});

const groupByList = ref<string[]>([]);
const isGrouped = computed(() => groupByList.value.length > 0);

const sliTypeOptions = computed(() => [
  { value: "count", label: t("slos.type.count"), description: t("slos.type.countDescription") },
  { value: "time_slice", label: t("slos.type.timeSlice"), description: t("slos.type.timeSliceDescription") },
  { value: "alert", label: t("slos.type.alert"), description: t("slos.type.alertDescription"), disable: true },
]);

const streamTypeOptions = [
  { value: "logs", label: "logs" },
  { value: "metrics", label: "metrics" },
  { value: "traces", label: "traces" },
];

const comparatorOptions = [
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
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

// D30: grouped SLOs are pinned to 5-minute slices. Enforced here as well as at
// the API so the form cannot present a combination the backend will reject.
watch(isGrouped, (grouped) => {
  if (grouped) form.slice_interval_secs = 300;
});

/** "99.9%" is abstract. "43 minutes per 30 days" is what people decide on. */
const budgetDuration = computed(() => {
  const target = Number(form.target);
  if (!Number.isFinite(target) || target <= 0 || target >= 100) return "—";
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
  if (!Number.isFinite(target) || target <= 0 || target >= 100) return "—";
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
  query: { org_identifier: org.value },
}));

async function load() {
  if (!isEdit.value || !org.value) return;
  const res = await sloService.get(org.value, sloId.value);
  const body = res.data ?? {};
  // Unwrap the adjacent tagging back into the flat model the form edits.
  const cfg = body.config ?? {};
  const flat =
    body.sli_type === "count" ? (cfg.source?.query ?? cfg.source ?? {}) : cfg;
  Object.assign(form, {
    name: body.name,
    description: body.description ?? "",
    tags: body.tags ?? [],
    sli_type: body.sli_type,
    config: { stream_type: "logs", ...flat },
    target: body.target,
    window_secs: body.window_secs,
    slice_interval_secs: body.slice_interval_secs,
    groups_estimate: body.groups_estimate,
    enabled: body.enabled,
  });
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
    return { source: { mode: "single_query", query: pruned(form.config) } };
  }
  return pruned(form.config);
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

onMounted(load);
</script>
