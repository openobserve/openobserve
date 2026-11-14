<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Closing a case records why: the verdict feeds detection tuning, the reason the next analyst. -->
<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { CASE_VERDICTS } from "@/utils/security/cases";
import type { BulkOutcome, CasePriority } from "@/services/securityCases";
import {
  BENIGN_SUPPRESS_DEFAULT_MINUTES,
  CLOSE_SUPPRESS_MINUTES,
  makeCaseCloseSchema,
  type CaseCloseForm,
  type CaseCloseValues,
} from "./SecurityCaseCloseDialog.schema";

/** A P1/P2 case in the selection, listed so it is never closed by accident. */
export interface HighPriorityCase {
  id: string;
  title: string;
  priority: CasePriority;
  entity: string;
}

/** One case's outcome after a bulk close. */
export interface CloseResultRow extends HighPriorityCase {
  outcome: BulkOutcome;
  error?: string;
}

const props = defineProps<{
  open: boolean;
  /** Resolves true once the server closed the case(s). */
  close: (values: CaseCloseForm) => Promise<boolean>;
  /** Cases closed at once; the title names the count when more than one case is selected. */
  count?: number;
  /** P1/P2 cases in a bulk selection; they stay open unless the analyst includes them. */
  high?: HighPriorityCase[];
  /** Starts on a benign verdict with a suppression, for "close as benign and suppress". */
  suppressPreset?: boolean;
  /** Per-case outcome of the last bulk close; the dialog shows it instead of the form. */
  results?: CloseResultRow[] | null;
  /** Cases being closed that name no host, user or address, so nothing similar can be suppressed. */
  noEntity?: number;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-case-close-form";
/** Listed P1/P2 cases before the rest fold into "and N more". */
const MAX_LISTED = 8;
const schema = makeCaseCloseSchema(t);

const noEntityEverywhere = () =>
  (props.noEntity ?? 0) > 0 && (props.noEntity ?? 0) >= (props.count ?? 1);
const defaults = (): CaseCloseValues => ({
  verdict: props.suppressPreset ? "benign" : undefined,
  reason: "",
  suppressMinutes:
    props.suppressPreset && !noEntityEverywhere() ? BENIGN_SUPPRESS_DEFAULT_MINUTES : 0,
  includeHigh: false,
});
const form = useOForm<CaseCloseValues>({
  defaultValues: defaults(),
  schema,
  onSubmit: async (value) => {
    if (await props.close(schema.parse(value))) emit("update:open", false);
  },
});
watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) form.reset(defaults());
  },
);

const verdict = form.useStore((s: any) => s.values.verdict as string | undefined);
const suppressMinutes = form.useStore((s: any) => Number(s.values.suppressMinutes ?? 0));
const includeHigh = form.useStore((s: any) => !!s.values.includeHigh);

const verdictOptions = computed(() =>
  CASE_VERDICTS.map((v) => ({ label: t(`siem.cases.verdict.${v}`), value: v })),
);
const suppressOptions = computed(() =>
  CLOSE_SUPPRESS_MINUTES.map((m) => ({
    label: m ? t(`siem.cases.close.suppressFor_${m}`) : t("siem.cases.close.noSuppress"),
    value: m,
  })),
);

const highCount = computed(() => props.high?.length ?? 0);
const listedHigh = computed(() => (props.high ?? []).slice(0, MAX_LISTED));
const closing = computed(() =>
  Math.max(0, (props.count ?? 1) - (includeHigh.value ? 0 : highCount.value)),
);
const bulk = computed(() => (props.count ?? 1) > 1 || highCount.value > 0);
const selected = computed(() => props.count ?? 1);
const noEntityCount = computed(() => Math.min(props.noEntity ?? 0, selected.value));
/** Every case lacks an entity, so a suppression could match nothing. */
const cannotSuppress = computed(noEntityEverywhere);
const suppressing = computed(
  () => !cannotSuppress.value && verdict.value === "benign" && suppressMinutes.value > 0,
);

// The title names the selection; the button names what this submit will actually close.
const title = computed(() => {
  if (props.results) return t("siem.cases.close.resultsTitle");
  if (!bulk.value) return t("siem.cases.close.title");
  return t("siem.cases.close.bulkTitle", { n: selected.value }, selected.value);
});
const primaryLabel = computed(() => {
  if (props.results) return t("siem.cases.close.done");
  if (suppressing.value) return t("siem.cases.close.submitSuppress");
  if (!bulk.value) return t("siem.cases.transition.resolved");
  const n = closing.value || selected.value;
  return t("siem.cases.close.bulkTitle", { n }, n);
});

const OUTCOME_ICON: Record<BulkOutcome, string> = {
  updated: "check-circle",
  failed: "error-outline",
  skipped: "do-not-disturb-on",
};
const OUTCOME_CLASS: Record<BulkOutcome, string> = {
  updated: "text-status-success-text",
  failed: "text-status-error-text",
  skipped: "text-text-secondary",
};
const resultCounts = computed(() => {
  const n = { updated: 0, failed: 0, skipped: 0 };
  for (const r of props.results ?? []) n[r.outcome] += 1;
  return n;
});
function outcomeText(row: CloseResultRow) {
  if (row.outcome === "skipped") return t("siem.cases.close.outcomeSkipped");
  if (row.outcome === "failed") return raw(row.error) || t("siem.cases.close.outcomeFailed");
  return row.error
    ? t("siem.cases.close.outcomeClosedNoSuppress", { error: raw(row.error) })
    : t("siem.cases.close.outcomeClosed");
}
function onPrimary() {
  if (props.results) emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    :size="bulk ? 'md' : 'sm'"
    :title="title"
    :form-id="results ? undefined : FORM_ID"
    :primary-button-label="primaryLabel"
    :primary-button-disabled="!results && bulk && closing === 0"
    :secondary-button-label="results ? undefined : t('siem.cases.close.cancel')"
    data-test="security-case-close-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="onPrimary"
    @click:secondary="emit('update:open', false)"
  >
    <div v-if="results" class="flex flex-col gap-3" data-test="security-case-close-results">
      <span class="text-text-secondary text-sm" data-test="security-case-close-results-summary">{{
        t("siem.cases.close.resultsSummary", resultCounts)
      }}</span>
      <ul
        class="border-border-default rounded-surface flex max-h-96 flex-col overflow-y-auto border"
      >
        <li
          v-for="row in results"
          :key="row.id"
          class="border-border-subtle flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
          :data-test="`security-case-close-result-${row.id}`"
          :data-outcome="row.outcome"
        >
          <OIcon :name="OUTCOME_ICON[row.outcome]" size="sm" :class="OUTCOME_CLASS[row.outcome]" />
          <OTag type="severity" :value="row.priority.toLowerCase()" size="xs" class="shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col">
            <OTruncatedText class="text-text-heading text-sm">{{ row.title }}</OTruncatedText>
            <OTruncatedText class="text-text-secondary text-2xs font-mono">{{
              row.entity || row.id
            }}</OTruncatedText>
          </div>
          <span
            class="text-text-secondary max-w-64 shrink-0 text-xs break-words whitespace-normal"
            data-test="security-case-close-result-message"
            >{{ outcomeText(row) }}</span
          >
        </li>
      </ul>
    </div>
    <OForm
      v-else-if="open"
      :id="FORM_ID"
      :form="form"
      class="flex flex-col gap-5"
      data-test="security-case-close-form"
    >
      <OBanner
        v-if="highCount"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-case-close-high"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <span>{{ t("siem.cases.close.highWarning", { n: highCount }, highCount) }}</span>
          <ul class="flex flex-col gap-1">
            <li
              v-for="c in listedHigh"
              :key="c.id"
              class="flex min-w-0 items-center gap-2"
              :data-test="`security-case-close-high-${c.id}`"
            >
              <OTag type="severity" :value="c.priority.toLowerCase()" size="xs" class="shrink-0" />
              <OTruncatedText class="text-text-heading min-w-0 flex-1 text-xs">{{
                c.title
              }}</OTruncatedText>
              <OTruncatedText class="text-text-secondary max-w-48 shrink-0 font-mono text-xs">{{
                c.entity || "—"
              }}</OTruncatedText>
            </li>
            <li v-if="highCount > listedHigh.length" class="text-text-secondary text-xs">
              {{ t("siem.cases.close.andMore", { n: highCount - listedHigh.length }) }}
            </li>
          </ul>
          <OFormCheckbox
            name="includeHigh"
            :label="t('siem.cases.close.includeHigh', { n: highCount }, highCount)"
            data-test="security-case-close-include-high"
          />
        </div>
      </OBanner>
      <OFormSelect
        name="verdict"
        :label="t('siem.cases.close.verdict')"
        :options="verdictOptions"
        required
        data-test="security-case-close-verdict"
      />
      <OFormTextarea
        name="reason"
        :label="t('siem.cases.close.reason')"
        :placeholder="t('siem.cases.close.reasonPlaceholder')"
        :rows="4"
        required
        data-test="security-case-close-reason"
      />
      <OBanner
        v-if="verdict === 'benign' && cannotSuppress"
        variant="info"
        icon="info-outline"
        dense
        data-test="security-case-close-no-entity"
        >{{ t("siem.cases.close.noEntity", { n: selected }, selected) }}</OBanner
      >
      <OFormSelect
        v-else-if="verdict === 'benign'"
        name="suppressMinutes"
        :label="t('siem.cases.close.suppress')"
        :help-text="
          noEntityCount
            ? t('siem.cases.close.suppressSomeNoEntity', { n: noEntityCount }, noEntityCount)
            : t('siem.cases.close.suppressHint')
        "
        :options="suppressOptions"
        data-test="security-case-close-suppress"
      />
    </OForm>
  </ODialog>
</template>
