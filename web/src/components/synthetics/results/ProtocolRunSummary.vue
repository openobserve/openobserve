<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Run detail for protocol checks (http/tcp/tls/ssh) — flat result fields, a
// timing waterfall, and assertion outcomes. No steps/screenshots/replay
// (those are browser-run concepts).
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ProtocolRunSummarySkeleton from "./ProtocolRunSummarySkeleton.vue";
import useSyntheticResults from "@/composables/useSyntheticResults";
import syntheticsService from "@/services/synthetics";
import type { HttpAssertion } from "@/types/synthetics";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(
  defineProps<{
    monitorId: string;
    runId: string;
    executionId: string;
    drawerMode?: boolean;
    locationNames?: Record<string, string>;
  }>(),
  { drawerMode: false, locationNames: () => ({}) },
);

const emit = defineEmits<{
  (
    e: "update-status",
    status: { variant: BadgeVariant; icon: string; label: string; url: string; timestamp: string },
  ): void;
}>();

const { t } = useI18n();
const store = useStore();
const route = useRoute();
// The check's folder (name), carried on the results-page route as ?folder=.
const folderName = computed(() => String(route.query.folder ?? ""));
const synthetics = useSyntheticResults();

const run = computed(() => synthetics.protocolRunDetail.value);
const loading = computed(() => synthetics.loading.value);

// Assertion definitions come from the monitor config; the result record only
// carries assertions_passed + the first failure detail in `error`.
const assertionDefs = ref<HttpAssertion[]>([]);

async function loadRun() {
  if (!props.runId || !props.executionId) return;
  const endTime = Date.now() * 1000; // µs
  const startTime = endTime - 30 * 24 * 3600 * 1000 * 1000; // 30 days
  await synthetics.fetchProtocolRun(
    props.monitorId,
    props.runId,
    props.executionId,
    startTime,
    endTime,
  );
}

async function loadAssertionDefs() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.get(org, props.monitorId, folderName.value);
    assertionDefs.value = ((res.data as any)?.config?.assertions ?? []) as HttpAssertion[];
  } catch {
    assertionDefs.value = [];
  }
}

onMounted(loadAssertionDefs);

function locationLabel(id: string): string {
  return props.locationNames?.[id] ?? id;
}

watch(
  () => [props.runId, props.executionId] as [string, string],
  ([rid, eid]) => {
    if (rid && eid) loadRun();
  },
  { immediate: true },
);

// ── Status display ───────────────────────────────────────────────────────────
// Canonical vocabulary shared with the browser probe and control plane
// (config::meta::synthetics::SyntheticStatus): passed|warning|failed|error.
const statusMeta = computed(() => {
  switch (run.value?.status) {
    case "passed":
      return {
        variant: "success" as const,
        icon: "check-circle",
        label: t("synthetics.protocolRun.passed"),
      };
    case "warning":
      return {
        variant: "warning" as const,
        icon: "error",
        label: t("synthetics.protocolRun.warning"),
      };
    case "error":
      return {
        variant: "error-soft" as const,
        icon: "error",
        label: t("synthetics.protocolRun.error"),
      };
    default:
      return {
        variant: "error" as const,
        icon: "cancel",
        label: t("synthetics.protocolRun.failed"),
      };
  }
});

watch(
  () => run.value?.status ?? null,
  (status) => {
    if (!props.drawerMode || !status || !run.value) return;
    emit("update-status", {
      variant: statusMeta.value.variant === "error" ? "error" : statusMeta.value.variant,
      icon: statusMeta.value.icon,
      label: statusMeta.value.label,
      url: run.value.target,
      timestamp: fmtTs(run.value.timestamp),
    });
  },
);

// ── Formatting ──────────────────────────────────────────────────────────────
function fmtTs(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : "—";
}
function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : ms + " ms";
}
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  return b >= 1024 ? (b / 1024).toFixed(1) + " KiB" : b + " B";
}

const certDaysRemaining = computed(() => {
  const exp = run.value?.tlsCertExpiry;
  if (!exp) return null;
  return Math.floor((exp / 1000 - Date.now()) / (24 * 3600 * 1000));
});
const certExpiryDate = computed(() => {
  const exp = run.value?.tlsCertExpiry;
  return exp ? new Date(exp / 1000).toLocaleDateString() : null;
});

// Timing waterfall — bar widths relative to the total.
const timingBars = computed(() => {
  if (!run.value) return [];
  const total = Math.max(run.value.totalMs, 1);
  return run.value.timings.map((tm) => ({
    phase: tm.phase,
    ms: tm.ms,
    pct: Math.max(1, Math.round((tm.ms / total) * 100)),
  }));
});

// `assertions_passed` is omitted by the probe when the request never produced a
// response (connection refused, EOF, timeout) — there was nothing to assert
// against, so the checker returns before evaluating. That absent case maps to
// null here and is NOT a pass: rendering it as one told the operator their
// `status_code eq 200` held on a run that never got a status code.
const assertionsEvaluated = computed(() => run.value?.assertionsPassed != null);

// The probe's failure detail leads with its own word for the field, which is not
// always the field name the check config uses. Only needed on the legacy path
// below — probes that echo per-assertion results carry the field name verbatim.
const PROBE_FIELD_WORD: Record<string, string> = {
  status_code: "status",
  response_time_ms: "response_time",
};

// Per-assertion verdicts.
//
// Preferred source is the probe's own `assertions` array: one row per assertion
// with its real verdict, so a run where several assertions fail shows all of
// them. Records written before the probe echoed that array carry only a single
// roll-up bool plus the FIRST failure's message, and the best that can be done
// there is to mark whichever row that message names — which is why a legacy
// multi-failure run still shows only one red row.
const assertionRows = computed(() => {
  if (!run.value) return [];

  const reported = run.value.assertions;
  if (reported.length) {
    return reported.map((a) => ({
      field: a.field,
      operator: a.operator,
      value: a.value,
      failed: !a.passed,
      detail: a.detail,
    }));
  }

  const passedAll = run.value.assertionsPassed;
  return assertionDefs.value.map((a) => {
    let failed = false;
    if (passedAll === false && run.value) {
      const err = run.value.error;
      const fieldWord = PROBE_FIELD_WORD[a.field] ?? a.field;
      failed = run.value.errorClass === "assertion" && err.startsWith(fieldWord);
    }
    return { ...a, failed, detail: "" };
  });
});

const showAssertions = computed(() => run.value?.type === "http" && assertionRows.value.length > 0);
</script>

<template>
  <OPageLayout data-test="synthetics-protocol-run-detail" bleed>
    <template #header v-if="!drawerMode">
      <OPageHeader
        class=""
        :subtitle="run ? fmtTs(run.timestamp) : ''"
        :back="{
          label: t('synthetics.results.monitors'),
          to: { name: 'synthetic-monitor-results', params: { id: monitorId } },
          dataTest: 'synthetics-protocol-run-back-btn',
        }"
      >
        <template #title>
          <span data-test="synthetics-protocol-run-title">{{ run?.monitorName || "" }}</span>
        </template>
        <template #title-trail>
          <OBadge v-if="run" :variant="statusMeta.variant" size="sm" :icon="statusMeta.icon">
            {{ statusMeta.label }}
          </OBadge>
          <OBadge v-if="run" variant="default" size="sm">{{ run.type.toUpperCase() }}</OBadge>
          <OBadge
            v-if="run?.target"
            variant="default"
            size="sm"
            icon="link"
            class="max-w-60 truncate"
          >
            {{ run.target }}
          </OBadge>
        </template>
      </OPageHeader>
    </template>

    <div class="px-page-edge min-h-0 flex-1 overflow-y-auto py-4">
      <ProtocolRunSummarySkeleton v-if="loading" />

      <OEmptyState
        v-else-if="!run"
        preset="no-data"
        :title="t('synthetics.protocolRun.notFound')"
      />

      <div v-else class="flex max-w-[53.75rem] flex-col gap-4">
        <!-- ── Result ── -->
        <div class="rounded-default border-border-default border">
          <div class="border-border-default flex items-center border-b px-3 py-2">
            <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
            <h3 class="text-text-heading text-base font-semibold">
              {{ t("synthetics.protocolRun.result") }}
            </h3>
          </div>
          <div class="grid grid-cols-2 gap-3 px-3 py-3">
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{ t("synthetics.protocolRun.status") }}</span>
              <span class="flex items-center gap-2">
                <OBadge :variant="statusMeta.variant" size="sm" :icon="statusMeta.icon">{{
                  statusMeta.label
                }}</OBadge>
                <OBadge v-if="run.errorClass" variant="default" size="sm">{{
                  run.errorClass
                }}</OBadge>
              </span>
            </div>
            <div
              v-if="run.statusCode != null"
              class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3"
            >
              <span class="text-text-muted text-xs">{{
                t("synthetics.protocolRun.statusCode")
              }}</span>
              <span class="text-sm font-medium">{{ run.statusCode }}</span>
            </div>
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{
                t("synthetics.protocolRun.responseTime")
              }}</span>
              <span class="text-sm font-medium">{{ fmtMs(run.responseTimeMs) }}</span>
            </div>
            <div
              v-if="run.responseBytes != null"
              class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3"
            >
              <span class="text-text-muted text-xs">{{
                t("synthetics.protocolRun.responseSize")
              }}</span>
              <span class="text-sm font-medium">{{ fmtBytes(run.responseBytes) }}</span>
            </div>
            <div
              v-if="run.error"
              class="rounded-default bg-surface-subtle col-span-2 flex flex-col gap-1.5 p-3"
            >
              <span class="text-text-muted text-xs">{{ t("synthetics.protocolRun.error") }}</span>
              <span class="text-status-error-text text-sm font-medium break-all">{{
                run.error
              }}</span>
            </div>
          </div>
        </div>

        <!-- ── Timing breakdown ── -->
        <div v-if="timingBars.length" class="rounded-default border-border-default border">
          <div class="border-border-default flex items-center border-b px-3 py-2">
            <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
            <h3 class="text-text-heading text-base font-semibold">
              {{ t("synthetics.protocolRun.timings") }}
            </h3>
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div v-for="bar in timingBars" :key="bar.phase" class="flex items-center gap-2">
              <span class="text-text-secondary w-20 shrink-0 text-xs">{{
                t(`synthetics.protocolRun.phase.${bar.phase}`)
              }}</span>
              <div class="rounded-default bg-surface-subtle h-3 flex-1 overflow-hidden">
                <div class="rounded-default bg-accent h-full" :style="{ width: bar.pct + '%' }" />
              </div>
              <span class="text-text-secondary w-[4.5rem] shrink-0 text-right text-xs">{{
                fmtMs(bar.ms)
              }}</span>
            </div>
            <div class="border-border-default flex items-center gap-2 border-t pt-1">
              <span class="text-text-body w-20 shrink-0 text-xs font-semibold">{{
                t("synthetics.protocolRun.phase.total")
              }}</span>
              <div class="flex-1" />
              <span class="text-text-body w-[4.5rem] shrink-0 text-right text-xs font-semibold">{{
                fmtMs(run.totalMs)
              }}</span>
            </div>
          </div>
        </div>

        <!-- ── Assertions (http) ── -->
        <div v-if="showAssertions" class="rounded-default border-border-default border">
          <div class="border-border-default flex items-center border-b px-3 py-2">
            <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
            <h3 class="text-text-heading text-base font-semibold">
              {{ t("synthetics.protocolRun.assertions") }}
            </h3>
            <OBadge
              class="ml-2"
              :variant="
                !assertionsEvaluated
                  ? 'default'
                  : run.assertionsPassed === false
                    ? 'error'
                    : 'success'
              "
              size="sm"
              data-test="synthetics-protocol-run-assertions-badge"
            >
              {{
                !assertionsEvaluated
                  ? t("synthetics.protocolRun.assertionsNotEvaluated")
                  : run.assertionsPassed === false
                    ? t("synthetics.protocolRun.assertionsFailed")
                    : t("synthetics.protocolRun.assertionsPassed")
              }}
            </OBadge>
          </div>
          <ul class="flex flex-col gap-1 px-3 py-2">
            <li
              v-for="(a, i) in assertionRows"
              :key="i"
              class="flex items-center gap-2 py-1 text-sm"
              :data-test="`synthetics-protocol-run-assertion-${i}`"
            >
              <OBadge
                :variant="!assertionsEvaluated ? 'default' : a.failed ? 'error' : 'success'"
                size="sm"
                :icon="!assertionsEvaluated ? 'remove' : a.failed ? 'cancel' : 'check-circle'"
              />
              <span class="font-mono text-xs" :class="assertionsEvaluated ? '' : 'text-text-muted'"
                >{{ a.field }} {{ a.operator }} {{ a.value }}</span
              >
              <!-- The probe's own comparison for this row, e.g. "status 503 eq
                   200" — failures only, and only from probes that report
                   per-assertion results. -->
              <span
                v-if="a.detail"
                class="text-status-error-text font-mono text-xs"
                :data-test="`synthetics-protocol-run-assertion-detail-${i}`"
                >— {{ a.detail }}</span
              >
            </li>
          </ul>
          <p
            v-if="!assertionsEvaluated"
            class="text-text-muted px-3 pb-2 text-xs"
            data-test="synthetics-protocol-run-assertions-not-evaluated-hint"
          >
            {{ t("synthetics.protocolRun.assertionsNotEvaluatedHint") }}
          </p>
        </div>

        <!-- ── TLS certificate ── -->
        <div v-if="certExpiryDate" class="rounded-default border-border-default border">
          <div class="border-border-default flex items-center border-b px-3 py-2">
            <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
            <h3 class="text-text-heading text-base font-semibold">
              {{ t("synthetics.protocolRun.tlsCert") }}
            </h3>
          </div>
          <div class="flex items-center gap-2 px-3 py-3 text-sm">
            <span>{{ t("synthetics.protocolRun.certExpires", { date: certExpiryDate }) }}</span>
            <OBadge
              v-if="certDaysRemaining != null"
              :variant="certDaysRemaining < 30 ? 'warning' : 'default'"
              size="sm"
            >
              {{ t("synthetics.protocolRun.daysRemaining", { days: certDaysRemaining }) }}
            </OBadge>
          </div>
        </div>

        <!-- ── Probe ── -->
        <div class="rounded-default border-border-default border">
          <div class="border-border-default flex items-center border-b px-3 py-2">
            <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
            <h3 class="text-text-heading text-base font-semibold">
              {{ t("synthetics.protocolRun.probe") }}
            </h3>
          </div>
          <div class="grid grid-cols-2 gap-3 px-3 py-3 text-sm">
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{
                t("synthetics.protocolRun.location")
              }}</span>
              <span class="font-medium">{{ locationLabel(run.location) || "—" }}</span>
            </div>
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{ t("synthetics.protocolRun.runtime") }}</span>
              <span class="font-medium"
                >{{ run.runtime || "—" }}
                <span v-if="run.initMs" class="text-text-muted"
                  >(+{{ fmtMs(run.initMs) }} {{ t("synthetics.protocolRun.init") }})</span
                ></span
              >
            </div>
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{ t("synthetics.protocolRun.probeId") }}</span>
              <span class="font-mono text-xs break-all">{{ run.probeId || "—" }}</span>
            </div>
            <div class="rounded-default bg-surface-subtle flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{ t("synthetics.protocolRun.trigger") }}</span>
              <span class="font-medium">{{ run.triggerType }}</span>
            </div>
            <div class="rounded-default bg-surface-subtle col-span-2 flex flex-col gap-1.5 p-3">
              <span class="text-text-muted text-xs">{{
                t("synthetics.protocolRun.timeline")
              }}</span>
              <span class="text-xs">
                {{ t("synthetics.protocolRun.scheduled") }} {{ fmtTs(run.scheduledTs) }} →
                {{ t("synthetics.protocolRun.started") }} {{ fmtTs(run.startedTs) }} →
                {{ t("synthetics.protocolRun.completed") }} {{ fmtTs(run.completedTs) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </OPageLayout>
</template>
