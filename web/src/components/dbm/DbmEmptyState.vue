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

<!--
  DbmEmptyState — an empty state that DIAGNOSES ITSELF.

  "No data" is the least useful thing an empty state can say, because the five
  reasons this screen is empty have five different fixes and the user cannot
  tell them apart by looking. Every signal needed to distinguish them is already
  in the caller's hands — the config flag, the trace count, the permission
  result, the schema, the response — so rather than naming one guess, this shows
  THE WHOLE CHECKLIST with each item marked pass or fail.

  Why the whole list rather than only the failure: the checks that PASS are the
  reassurance. A user who sees "traces are arriving ✓, you have access ✓, none
  of your traces mention a database ✗" knows exactly which team to talk to and
  what to ask for. Showing only the failure leaves them wondering whether the
  other three are also broken, and the competitive research found no product in
  the category that does this.

  A filter the user set is NOT a diagnosis — it is a thing they did — so the
  filtered case short-circuits to a plain "clear filters" state.
-->
<template>
  <!-- Self-inflicted emptiness: no checklist, just the way back. -->
  <OEmptyState
    v-if="filtered"
    :size="size"
    variant="no-results"
    illustration="no-results"
    :title="t('dbm.empty.filtered.title')"
    :description="t('dbm.empty.filtered.description')"
    :action-label="t('dbm.empty.filtered.action')"
    action-icon="filter-list"
    data-test="dbm-empty-state-filtered"
    @action="emit('action', 'filtered')"
  />

  <!-- The diagnostic case, built ON OEmptyState rather than beside it: DBM then
       inherits the app's illustration, heading scale, dot-grid backdrop and
       spacing, and the checklist — the only genuinely DBM-specific part — rides
       in #extra. Before this it was a hand-rolled stack with an h3 and a small
       icon badge, which read as a different product from Traces and Metrics. -->
  <OEmptyState
    v-else
    :size="size"
    illustration="data-scene"
    :title="t('dbm.empty.title')"
    :description="diagnosticDescription"
    data-test="dbm-empty-state-diagnostic"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        data-test="dbm-empty-state-instrument"
        @click="emit('action', primaryCause)"
      >
        {{ primaryActionLabel }}
      </OButton>
      <OButton
        v-if="traceCount"
        variant="outline"
        size="sm"
        data-test="dbm-empty-state-check-trace"
        @click="emit('action', 'check-trace')"
      >
        {{ t("dbm.empty.checkTrace") }}
      </OButton>
    </template>

    <!-- The checklist. Each row is one thing that has to be true, its verdict,
         and — where it failed — the specific fix rather than a generic link. -->
    <template #extra>
      <div
        class="border-border-default rounded-surface w-full max-w-2xl overflow-hidden text-left"
        data-test="dbm-empty-state-checks"
      >
        <p
          class="border-border-subtle bg-surface-panel text-text-label text-2xs border-b px-3 py-1.5 font-semibold tracking-wide uppercase"
        >
          {{ t("dbm.empty.checklistTitle") }}
        </p>
        <div
          v-for="check in checks"
          :key="check.id"
          class="border-border-subtle flex items-start gap-2 border-b px-3 py-1.5 not-last:border-b"
          :data-test="`dbm-empty-check-${check.id}`"
        >
          <span
            class="text-3xs mt-px grid size-3.5 shrink-0 place-items-center rounded-full font-bold text-white"
            :class="STATUS_TONES[check.status]"
          >
            {{ STATUS_GLYPHS[check.status] }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="text-text-heading block text-xs font-semibold">{{ check.title }}</span>
            <span class="text-text-secondary text-2xs mt-px block leading-relaxed">
              {{ check.detail }}
            </span>
          </span>
        </div>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount } from "@/utils/dbm/format";

/** What the caller is asked to do about it. */
export type DbmEmptyCauseId =
  | "no-permission"
  | "disabled"
  | "not-instrumented"
  | "not-counted"
  | "window-empty"
  | "filtered"
  | "check-trace"
  | "empty";

type CheckStatus = "ok" | "fail" | "note";

interface DbmCheck {
  id: string;
  status: CheckStatus;
  title: I18nText;
  detail: I18nText;
}

const props = withDefaults(
  defineProps<{
    /**
     * The caller could not read what it needed (a 403 from the endpoint, or a
     * failed stream-permission check).
     */
    permissionOk?: boolean;
    /** `zoConfig.database_monitoring_enabled`. */
    enabled?: boolean;
    /**
     * How many traces arrived in this range. `null` when the caller has not
     * counted, and the check is then omitted rather than rendered as a failure.
     */
    traceCount?: number | null;
    /**
     * The selected trace stream carries database spans — i.e. they have been
     * ingested at least once. `undefined` when the caller has not checked.
     */
    hasDbSpans?: boolean;
    /**
     * We have never finished counting this range: the spans are there but the
     * first numbers are not ready. Distinct from "nothing ran".
     */
    neverAggregated?: boolean;
    /** A search or filter is active, so the emptiness may be self-inflicted. */
    filtered?: boolean;
    /** The org identifier, for the access check's detail line. */
    org?: string;
    size?: "hero" | "block" | "inline";
  }>(),
  {
    permissionOk: true,
    enabled: true,
    traceCount: null,
    neverAggregated: false,
    filtered: false,
    size: "hero",
  },
);

const emit = defineEmits<{
  (e: "action", cause: DbmEmptyCauseId): void;
}>();

const { t } = useI18nTyped();

const STATUS_TONES: Record<CheckStatus, string> = {
  ok: "bg-status-success-text",
  fail: "bg-status-error-text",
  note: "bg-status-warning-text",
};

const STATUS_GLYPHS: Record<CheckStatus, I18nText> = {
  ok: raw("✓"),
  fail: raw("✕"),
  note: raw("!"),
};

/**
 * The checks, in the order they have to hold. Each reads its own signal, so a
 * check that cannot be evaluated (the caller did not supply the signal) states
 * what it does know rather than claiming a pass it has not verified.
 */
const checks = computed<DbmCheck[]>(() => {
  const list: DbmCheck[] = [];
  const c = (id: string, ok: boolean, path: string, params?: Record<string, unknown>) => ({
    id,
    status: (ok ? "ok" : "fail") as CheckStatus,
    title: t(`dbm.empty.checks.${path}.${ok ? "ok" : "no"}`),
    detail: t(`dbm.empty.checks.${path}.${ok ? "okDetail" : "noDetail"}`, params ?? {}),
  });

  list.push(c("enabled", props.enabled, "enabled"));
  // Absent, not failed, when nobody counted. A red ✕ here is a claim we
  // observed zero traces, and stating that on an org that is actively ingesting
  // sends the reader to instrument what is already instrumented.
  if (props.traceCount !== null && props.traceCount !== undefined) {
    list.push(
      c("traces", props.traceCount > 0, "traces", {
        count: formatCount(props.traceCount),
      }),
    );
  }
  list.push(c("permission", props.permissionOk, "permission", { org: props.org ?? "" }));

  // Only meaningful once traces are arriving: "no database spans" on an org
  // with no traces at all is a restatement of the previous line.
  if (props.hasDbSpans !== undefined) {
    list.push(c("dbSpans", props.hasDbSpans, "dbSpans"));
  }
  if (props.neverAggregated) {
    list.push(c("counted", false, "counted"));
  }

  // The closing note: what happens after the fix, so the user knows whether to
  // wait or to keep debugging.
  list.push({
    id: "also",
    status: "note",
    title: t("dbm.empty.checks.alsoWorthKnowing.title"),
    detail: t("dbm.empty.checks.alsoWorthKnowing.detail"),
  });

  return list;
});

const passCount = computed(() => checks.value.filter((c) => c.status === "ok").length);
const failCount = computed(() => checks.value.filter((c) => c.status === "fail").length);

/**
 * OEmptyState takes ONE description string, so the two copy lines are joined
 * here rather than rendered as two <p> tags. The pass/fail tally stays attached
 * to the subtitle — it is what tells the user the list below is a verdict and
 * not a set of instructions.
 */
const diagnosticDescription = computed(() =>
  raw(
    `${t("dbm.empty.subtitle")} ${t(
      "dbm.empty.subtitleCounts",
      { pass: passCount.value, fail: failCount.value },
      failCount.value,
    )}`,
  ),
);

/**
 * The first failing check decides what the primary button offers to fix. An
 * uncounted trace total is not a failing check, so it does not get a say —
 * instrumentation is the fallback offer either way.
 */
const primaryCause = computed<DbmEmptyCauseId>(() => {
  if (!props.permissionOk) return "no-permission";
  if (!props.enabled) return "disabled";
  if (props.neverAggregated) return "not-counted";
  return "not-instrumented";
});

const primaryActionLabel = computed<I18nText>(() =>
  primaryCause.value === "not-counted" ? t("dbm.empty.action") : t("dbm.empty.showMeHow"),
);
</script>
