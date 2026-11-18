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
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import destinationService from "@/services/alert_destination";
import { starterContentSpec } from "@/components/alerts/template-content/contentSpec";
import { useAlertTestRun } from "@/composables/alerts/useAlertTestRun";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatNumber, joinList, joinListMore } from "@/utils/alerts/alertCopy";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import { requestFailureReason, testRunReport, type TestRunTone } from "@/utils/alerts/alertTestRun";

const props = defineProps<{
  /** The unsaved alert, or null when the form can't build one yet. */
  body: EvaluateAlertBody | null;
  folder?: string;
  /** Unit of the compared value, as the preview draws it. */
  unit?: string | null;
  destinations: string[];
  /** The alert's own message template; otherwise a sample message is sent. */
  template?: string | null;
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

// Without an answer to show, a cancelled test leaves nothing to read.
const cancelRun = () => {
  testRun.cancel();
  if (!testRun.result.value) emit("close");
};

const running = computed(() => testRun.state.value === "running");
const sameAlert = computed(() => testRun.testedKey.value === testRun.currentKey.value);
// A re-run of the same alert keeps its last answer, dimmed; another alert's answer is not shown.
const report = computed(() => {
  const result = testRun.result.value;
  if (!result || (running.value && !sameAlert.value)) return null;
  return testRunReport(result, {
    t,
    unit: props.unit,
    timeZone: store.state.timezone,
    nowMs: Date.now(),
  });
});
const stale = computed(
  () => testRun.state.value === "ready" && !!testRun.result.value && !sameAlert.value,
);

const confirmOpen = ref(false);
const sending = ref(false);
const sendLines = ref<{ text: I18nText; tone: TestRunTone }[]>([]);
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
      destinationService.testSend({ org_identifier: org(), destination_name, data }),
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
};

defineExpose({ run });
</script>

<template>
  <section
    class="bg-surface-base absolute inset-0 flex flex-col gap-2 overflow-y-auto px-4 py-2"
    :aria-label="t('alerts.testRun.region')"
    :aria-busy="running"
    data-test="alert-test-run"
  >
    <div class="flex items-start gap-2">
      <div
        class="flex min-w-0 flex-1 flex-col gap-1"
        :class="running && report ? 'opacity-60' : ''"
        aria-live="polite"
      >
        <p
          v-if="running && !report"
          class="text-text-secondary m-0 text-sm"
          data-test="alert-test-run-running"
        >
          {{ t("alerts.testRun.running") }}
          <OButton variant="link" data-test="alert-test-run-cancel" @click="cancelRun">
            {{ t("common.cancel") }}
          </OButton>
        </p>
        <p
          v-else-if="testRun.state.value === 'failed'"
          class="text-status-error-text m-0 text-sm"
          role="alert"
          data-test="alert-test-run-failed"
        >
          {{ t("alerts.testRun.failed", { reason: testRun.failure.value ?? "" }) }}
        </p>
        <template v-else-if="report">
          <p
            v-for="line in report.lines"
            :key="line.id"
            class="m-0"
            :class="TONE_CLASS[line.tone]"
            :data-test="`alert-test-run-${line.id}`"
          >
            {{ line.text }}
          </p>
          <p v-if="stale" class="text-text-secondary m-0 text-xs" data-test="alert-test-run-stale">
            {{ t("alerts.testRun.stale") }}
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
    <ul
      v-if="report && report.groups.length"
      class="m-0 flex list-none flex-col gap-0.5 p-0 text-xs"
      :class="running ? 'opacity-60' : ''"
      data-test="alert-test-run-groups"
    >
      <li v-for="group in report.groups" :key="group.label" class="flex min-w-0 gap-2">
        <OTruncatedText class="text-text-body min-w-0 font-medium">{{
          group.label
        }}</OTruncatedText>
        <span class="text-text-secondary shrink-0">{{ group.text }}</span>
      </li>
      <li v-if="report.groupsMore" class="text-text-secondary">
        {{ t("alerts.copy.nMore", { count: formatNumber(report.groupsMore) }, report.groupsMore) }}
      </li>
    </ul>
    <div
      class="border-border-default mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2"
    >
      <OButton
        variant="outline"
        size="xs"
        :loading="sending"
        :disabled="!destinations.length"
        data-test="alert-test-run-send"
        @click="confirmOpen = true"
      >
        {{ t("alerts.testRun.sendTest") }}
      </OButton>
      <span
        v-if="!destinations.length"
        class="text-text-secondary text-xs"
        data-test="alert-test-run-no-destination"
      >
        {{ t("alerts.testRun.noDestination") }}
      </span>
      <span
        v-for="(line, i) in sendLines"
        :key="i"
        :class="TONE_CLASS[line.tone]"
        :role="line.tone === 'error' ? 'alert' : undefined"
        data-test="alert-test-run-send-result"
      >
        {{ line.text }}
      </span>
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
