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

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AlertBacktest from "@/components/alerts/AlertBacktest.vue";
import { starterContentSpec } from "@/components/alerts/template-content/contentSpec";
import destinationService from "@/services/alert_destination";
import { useAlertTestRun } from "@/composables/alerts/useAlertTestRun";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";
import { generateWhereClause } from "@/utils/alerts/alertQueryBuilder";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatNumber, joinList, joinListMore } from "@/utils/alerts/alertCopy";
import { crossesOnlyWhenEverySampleDoes } from "@/utils/alerts/checkCadence";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import {
  conditionsRoot,
  requestFailureReason,
  testRunReport,
  valueSplitFilter,
  valueSplitText,
  type PreviewPeak,
  type TestRunTone,
} from "@/utils/alerts/alertTestRun";

const props = defineProps<{
  /** The unsaved alert, or null when the form can't build one yet. */
  body: EvaluateAlertBody | null;
  folder?: string;
  destinations: string[];
  /** The alert's own message template; otherwise a sample message is sent. */
  template?: string | null;
  /** Why the form can't be tested again yet, said where the stale note goes. */
  blockedReason?: I18nText | null;
  /** The past window a comparison reads, when it holds no data. */
  baselineEmpty?: I18nText | null;
  /** The most extreme value the preview drew, which may sit between two checks. */
  previewPeak?: PreviewPeak | null;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const testRun = useAlertTestRun();
const org = () => store.state.selectedOrganization?.identifier ?? "";

const TONE_CLASS: Record<TestRunTone, string> = {
  body: "text-text-body text-sm",
  secondary: "text-text-secondary text-xs",
  warning: "text-status-warning-text text-xs",
  error: "text-status-error-text text-xs",
};

const run = () => {
  if (props.body) void testRun.run(org(), props.body, t, props.folder);
};

// Opening the panel is the click on Test it, so it always tests; a run still going is kept.
onMounted(() => {
  if (testRun.state.value !== "running") run();
});

const DAY_MS = 24 * 3_600_000;
const split = useAlertStreamQuery();
const splitAsked = ref(false);
// Without an answer to show, a cancelled test leaves nothing to read.
const cancelRun = () => {
  testRun.cancel();
  split.cancel();
  splitAsked.value = false;
  if (!testRun.result.value) emit("close");
};

const running = computed(() => testRun.state.value === "running");
// A busy day can take minutes to replay, so past this the wait says how long it has been.
const SLOW_RUN_SECONDS = 10;
const elapsedSeconds = ref(0);
let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  running,
  (now) => {
    clearInterval(ticker);
    elapsedSeconds.value = 0;
    if (!now) return;
    const startedAt = Date.now();
    ticker = setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000);
    }, 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(ticker));
const sameAlert = computed(() => testRun.testedKey.value === testRun.currentKey.value);
// A real-time filter on several values notifies on any of them, so the day is also told per value.
const splitFilter = computed(() =>
  props.body?.is_real_time ? valueSplitFilter(props.body.query_condition?.conditions) : null,
);
watch(
  () =>
    [
      testRun.testedKey.value,
      testRun.result.value?.end,
      splitFilter.value?.column,
      testRun.eventDay.value?.startMs,
    ] as const,
  ([, end, column]) => {
    split.cancel();
    splitAsked.value = false;
    const body = props.body;
    if (!body || !end || !column || testRun.testedKey.value !== testRun.currentKey.value) return;
    const where = generateWhereClause(conditionsRoot(body.query_condition.conditions), {});
    if (!where.trim()) return;
    splitAsked.value = true;
    const dayStart = testRun.eventDay.value?.startMs ?? end / 1000 - DAY_MS;
    split.run({
      sql: `SELECT "${column}" AS v, COUNT(*) AS n FROM "${body.stream_name}" ${where} GROUP BY v`,
      streamType: body.stream_type,
      // The summary counts the 24-hour row's day when it has one, so the breakdown reads that day too.
      startTime: dayStart * 1000,
      endTime: (dayStart + DAY_MS) * 1000,
      size: (splitFilter.value?.values.length ?? 0) + 1,
    });
  },
  { immediate: true },
);
// The answer waits for its per-value line, so the line never pushes the day strip down.
const splitPending = computed(() => splitAsked.value && split.state.value === "loading");
const splitText = computed(() =>
  splitFilter.value && splitAsked.value && split.state.value === "ready"
    ? valueSplitText(splitFilter.value.values, split.hits.value, t)
    : null,
);
// The breakdown's query is the alert's own filter, so its sum is the day's events, counted once.
const splitTotal = computed(() =>
  splitText.value ? split.hits.value.reduce((sum, row) => sum + (Number(row.n) || 0), 0) : null,
);
// A re-run of the same alert keeps its last answer, dimmed; another alert's answer is not shown.
const report = computed(() => {
  const result = testRun.result.value;
  if (!result || (running.value && !sameAlert.value)) return null;
  const tc = props.body?.trigger_condition;
  const promql = props.body?.query_condition?.promql ?? "";
  return testRunReport(result, {
    t,
    timeZone: store.state.timezone,
    nowMs: Date.now(),
    silenceMinutes: Number(tc?.silence) || 0,
    ratio: /\)\s*\/|\s\/\s/.test(promql),
    alternatives: /\bor\b/.test(promql),
    eventDay:
      splitTotal.value === null || !testRun.eventDay.value
        ? testRun.eventDay.value
        : { ...testRun.eventDay.value, events: splitTotal.value },
    checkEveryMinutes: tc?.frequency_type === "cron" ? 0 : Number(tc?.frequency) || 0,
    previewPeak: props.previewPeak,
  });
});

// A lowest value above (or highest below) over the look back is already sustained by its window.
const sustainedFn = computed(() => {
  const qc = props.body?.query_condition;
  const agg = qc?.aggregation;
  return qc?.type === "custom" &&
    agg &&
    crossesOnlyWhenEverySampleDoes(agg.function, agg.having?.operator)
    ? agg.function
    : null;
});
const shownResult = computed(() =>
  report.value && !splitPending.value ? testRun.result.value : null,
);
// The run is one request with no progress of its own, so the wait names how much it replays.
const runningText = computed(() => {
  const tc = props.body?.trigger_condition;
  const every = Number(tc?.frequency) || 0;
  if (props.body?.is_real_time || tc?.frequency_type === "cron" || every <= 0)
    return t("alerts.testRun.running");
  const checks = Math.floor((24 * 60) / every);
  return t("alerts.testRun.runningChecks", { count: formatNumber(checks) }, checks);
});
const stale = computed(
  () => testRun.state.value === "ready" && !!testRun.result.value && !sameAlert.value,
);
// A re-run's last answer and an answer for an older alert both read as not current.
const dimmed = computed(() => (running.value && !!report.value) || stale.value);

const confirmOpen = ref(false);
const sending = ref(false);
const sendLines = ref<{ text: I18nText; tone: TestRunTone }[]>([]);
const sendResultRefs = ref<HTMLElement[]>([]);
const targets = computed(() => joinListMore(props.destinations, t));

const send = async () => {
  const names = [...props.destinations];
  if (!names.length) return;
  sending.value = true;
  sendLines.value = [];
  const data = props.template
    ? { template_name: props.template, kind: "alert" }
    : { definition: starterContentSpec(), kind: "alert" };
  const outcomes = await Promise.allSettled(
    names.map((destination_name) =>
      destinationService.testSend(
        { org_identifier: org(), destination_name, data },
        { silentForbidden: true },
      ),
    ),
  );
  const sent: string[] = [];
  const failedBy = new Map<string, string[]>();
  outcomes.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      sent.push(names[i]);
      return;
    }
    const reason = String(requestFailureReason(outcome.reason, t));
    failedBy.set(reason, [...(failedBy.get(reason) ?? []), names[i]]);
  });
  // One line per distinct reason, so ten blocked destinations read as one sentence.
  sendLines.value = [
    ...(sent.length
      ? [
          {
            text: t("alerts.testRun.sent", { targets: joinList(sent) }),
            tone: "secondary" as const,
          },
        ]
      : []),
    ...[...failedBy].map(([reason, failed]) => ({
      text: t("alerts.testRun.sendFailed", {
        targets: joinListMore(failed, t),
        reason: raw(reason),
      }),
      tone: "error" as const,
    })),
  ];
  sending.value = false;
  // The answer can fill the panel, so the outcome of the send is brought into view under it.
  await nextTick();
  sendResultRefs.value.at(-1)?.scrollIntoView?.({ block: "nearest" });
};
</script>

<template>
  <section
    class="bg-surface-base flex min-h-0 flex-1 flex-col"
    :aria-label="t('alerts.testRun.region')"
    :aria-busy="running"
    data-test="alert-test-run"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-2 pb-3">
      <div class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1" aria-live="polite">
          <p
            v-if="(running && !report) || splitPending"
            class="text-text-secondary m-0 text-sm"
            data-test="alert-test-run-running"
          >
            {{ runningText }}
            <OButton variant="link" data-test="alert-test-run-cancel" @click="cancelRun">
              {{ t("common.cancel") }}
            </OButton>
          </p>
          <p
            v-if="running && !report && elapsedSeconds >= SLOW_RUN_SECONDS"
            class="text-text-secondary m-0 text-xs"
            data-test="alert-test-run-elapsed"
          >
            {{ t("alerts.testRun.elapsed", { seconds: formatNumber(elapsedSeconds) }) }}
          </p>
          <p
            v-else-if="testRun.state.value === 'failed'"
            class="text-status-error-text m-0 text-sm"
            role="alert"
            data-test="alert-test-run-failed"
          >
            {{ t("alerts.testRun.failed", { reason: testRun.failure.value ?? "" }) }}
          </p>
          <template v-else-if="report && !splitPending">
            <p v-if="stale" class="text-text-body m-0 text-sm" data-test="alert-test-run-stale">
              {{ blockedReason || t("alerts.testRun.staleRunAgain") }}
            </p>
            <p
              v-for="line in report.lines"
              :key="line.id"
              class="m-0"
              :class="[TONE_CLASS[line.tone], dimmed && 'opacity-60']"
              :data-test="`alert-test-run-${line.id}`"
            >
              {{ line.text }}
            </p>
            <p
              v-if="splitText"
              class="m-0"
              :class="[TONE_CLASS.secondary, dimmed && 'opacity-60']"
              data-test="alert-test-run-by-value"
            >
              {{ splitText }}
            </p>
          </template>
        </div>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :aria-label="t('common.close')"
          data-test="alert-test-run-close"
          @click="emit('close')"
        />
      </div>
      <AlertBacktest
        v-if="body && shownResult"
        :class="dimmed ? 'opacity-60' : ''"
        :tested="shownResult"
        query=""
        :stream-type="body.stream_type"
        :period="Number(body.trigger_condition.period)"
        :operator="body.trigger_condition.operator"
        :threshold="Number(body.trigger_condition.threshold)"
        :trigger-condition="body.trigger_condition"
        :keep-firing-for="Number(body.keep_firing_for) || 0"
        :real-time="body.is_real_time"
        :compares="!!body.query_condition.multi_time_range?.length"
        :baseline-empty="baselineEmpty"
        :sustained-fn="sustainedFn"
      />
      <p
        v-if="shownResult && report?.groupsHeading"
        class="text-text-secondary m-0 text-xs"
        :class="dimmed ? 'opacity-60' : ''"
      >
        {{ report.groupsHeading }}
      </p>
      <ul
        v-if="shownResult && report && report.groups.length"
        class="m-0 flex list-none flex-col gap-0.5 p-0 text-xs"
        :class="dimmed ? 'opacity-60' : ''"
        data-test="alert-test-run-groups"
      >
        <li v-for="group in report.groups" :key="group.label" class="flex min-w-0 gap-2">
          <OTruncatedText class="text-text-body min-w-0 flex-1 font-medium">{{
            group.label
          }}</OTruncatedText>
          <span class="text-text-secondary shrink-0">{{ group.text }}</span>
        </li>
        <li v-if="report.groupsMore" class="text-text-secondary">
          {{
            t("alerts.copy.nMore", { count: formatNumber(report.groupsMore) }, report.groupsMore)
          }}
        </li>
      </ul>
      <p
        v-for="(line, i) in sendLines"
        :key="i"
        ref="sendResultRefs"
        class="m-0"
        :class="TONE_CLASS[line.tone]"
        :role="line.tone === 'error' ? 'alert' : undefined"
        data-test="alert-test-run-send-result"
      >
        {{ line.text }}
      </p>
    </div>
    <div
      class="border-border-default flex shrink-0 items-center gap-3 border-t px-4 py-2"
      data-test="alert-test-run-actions"
    >
      <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
        <OButton
          v-if="destinations.length"
          variant="outline"
          size="xs"
          :loading="sending"
          data-test="alert-test-run-send"
          @click="confirmOpen = true"
        >
          {{ t("alerts.testRun.sendTest") }}
        </OButton>
        <span v-else class="text-text-secondary text-xs" data-test="alert-test-run-no-destination">
          {{ t("alerts.testRun.noDestination") }}
        </span>
      </div>
      <OButton
        class="shrink-0"
        :variant="stale ? 'primary' : 'outline'"
        size="xs"
        :loading="running"
        :disabled="!body"
        data-test="alert-test-run-rerun"
        @click="run"
      >
        {{ t("alerts.testRun.runAgain") }}
      </OButton>
    </div>
    <ConfirmDialog
      v-model="confirmOpen"
      :title="t('alert_templates.testSendConfirmTitle')"
      :message="t('alerts.testRun.sendConfirm', { targets })"
      :ok-label="t('alerts.testRun.sendTest')"
      data-test="alert-test-run-send-confirm"
      @update:ok="send"
    />
  </section>
</template>
