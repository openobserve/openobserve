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

<template>
  <section
    data-test="assistant-rca-thread"
    :data-sheet="sheet ?? undefined"
    :data-snap="sheet ? snap : undefined"
    class="bg-surface-base flex min-h-0 flex-col"
    :class="
      sheet
        ? ['rounded-t-surface shadow-lg', snap === 'full' ? 'h-[92dvh]' : 'h-[50dvh]']
        : 'h-full'
    "
    :aria-label="t('assistant.rca.tag')"
  >
    <OButton
      v-if="sheet"
      data-test="assistant-rca-thread-snap"
      variant="ghost"
      size="sm"
      class="mx-auto mt-1 min-h-11 w-16 flex-none"
      :aria-label="
        snap === 'full' ? t('assistant.shell.sheetPeek') : t('assistant.shell.sheetExpand')
      "
      @click="snap = snap === 'full' ? 'half' : 'full'"
    >
      <span class="bg-border-strong rounded-default block h-1 w-9" aria-hidden="true" />
    </OButton>

    <header class="border-border-default flex flex-none items-center gap-2 border-b px-4 py-2.5">
      <OIcon :name="assistantGlyph.investigator" size="sm" class="text-accent shrink-0" />
      <OTruncatedText
        as="h2"
        data-test="assistant-rca-thread-title"
        class="text-text-heading m-0 min-w-0 flex-1 text-sm font-semibold"
      >
        {{ title }}
      </OTruncatedText>
      <AssistantIconButton
        :label="t('common.close')"
        :icon="assistantGlyph.close"
        data-test="assistant-rca-thread-close"
        @click="emit('close')"
      />
    </header>

    <p
      v-if="loadState === 'loading'"
      data-test="assistant-rca-thread-loading"
      class="text-text-secondary m-0 flex items-center gap-2 px-4 py-3 text-sm"
    >
      <OSpinner size="xs" />
      {{ t("alerts.incidents.rcaThread.loading") }}
    </p>
    <div
      v-else-if="loadState === 'error'"
      data-test="assistant-rca-thread-error"
      class="text-text-secondary flex flex-col items-start gap-2 px-4 py-3 text-sm"
    >
      {{ t("alerts.incidents.rcaThread.loadFailed") }}
      <OButton variant="outline" size="sm" icon-left="refresh" @click="refetch()">
        {{ t("common.retry") }}
      </OButton>
    </div>

    <IncidentRCAAnalysis
      v-else-if="incident"
      ref="analysis"
      layout="assistant"
      :org-id="org"
      :incident-id="incident.id"
      :rca="rca.summary.value"
      :report-run="rca.reportRun.value"
      :viewed-run="rca.viewedRun.value"
      :history="rca.history.value"
      :stale="rca.stale.value"
      :error="rca.currentError.value"
      :report-text="rca.reportText.value"
      :report-verdict="rca.reportVerdict.value"
      :report-loading="rca.reportLoading.value"
      :thread-run-id="rca.threadRunId.value"
      :thread-live="rca.threadLive.value"
      :thread-run-is-v1="rca.threadRunIsV1.value"
      :thread="rca.thread.value"
      :thread-status="rca.threadStatus.value"
      :run-summary="rca.runSummary.value"
      :run-summary-status="rca.runSummaryStatus.value"
      :steering="rca.steering.value"
      :steering-status="rca.steeringStatus.value"
      :triggering="rca.triggering.value"
      :cancelling="rca.cancelling.value"
      :resume-run-id="rca.resumeRunId.value"
      :resuming="rca.resuming.value"
      :incident-title="incident.title ?? ''"
      :refusal="rca.refusal.value"
      @trigger-rca="reanalyze"
      @cancel-rca="rca.cancel"
      @view-run="rca.viewRun"
      @retry-live="rca.retryLive"
      @resume-rca="rca.resume"
      @ask-ai="branch"
    >
      <template #after-record>
        <!-- A finished report's row: the same actions as an answer, plus its Markdown. -->
        <div
          v-if="finishedReport"
          data-test="assistant-rca-thread-actions"
          class="flex flex-wrap items-center gap-0.5"
        >
          <AssistantIconButton
            :label="t('assistant.message.copyAnswer')"
            :icon="assistantGlyph.copy"
            data-test="assistant-rca-thread-copy"
            @click="analysis?.copyReport()"
          />
          <AssistantIconButton
            v-if="readAloud.supported"
            :label="
              readAloud.state.value === 'playing'
                ? t('assistant.message.pauseReading')
                : t('assistant.message.readAloud')
            "
            :icon="
              readAloud.state.value === 'playing' ? assistantGlyph.pause : assistantGlyph.readAloud
            "
            :on="readAloud.state.value === 'playing'"
            data-test="assistant-rca-thread-read-aloud"
            @click="readAloud.toggle()"
          />
          <AssistantIconButton
            :label="t('assistant.message.shareAnswer')"
            :icon="assistantGlyph.shareLink"
            :done="linkCopied ? t('assistant.message.linkCopied') : undefined"
            confirms
            data-test="assistant-rca-thread-share"
            @click="shareLink"
          />
          <AssistantIconButton
            v-if="analysis?.canAsk"
            :label="t('assistant.message.branch')"
            :icon="assistantGlyph.branch"
            data-test="assistant-rca-thread-branch"
            @click="analysis?.ask()"
          />
          <OButton
            data-test="assistant-rca-thread-export"
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.download"
            @click="analysis?.downloadReport()"
          >
            {{ t("alerts.incidents.rcaDownload") }}
          </OButton>
        </div>
      </template>
    </IncidentRCAAnalysis>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import IncidentRCAAnalysis from "@/components/alerts/IncidentRCAAnalysis.vue";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useReadAloud } from "@/components/ai-assistant/transcript/useReadAloud";
import { useIncidentRca, type RcaTriggerRequest } from "@/composables/useIncidentRca";
import type { IncidentWithAlerts } from "@/services/incidents";
import { incidentQuery } from "@/services/incidents.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { RcaAskPayload } from "@/utils/incidents/rcaAskAttachment";

const props = withDefaults(
  defineProps<{
    org: string;
    incidentId: string;
    /** The run to show; the latest run when it is the incident's newest. */
    runId: string;
    /** On a phone the thread is a bottom sheet that snaps half or full. */
    sheet?: "half" | "full" | null;
  }>(),
  { sheet: null },
);

const emit = defineEmits<{
  close: [];
  /** A new run was started from this thread; the host follows `runId` from here on. */
  reanalyze: [payload: { runId: string }];
}>();

const { t } = useI18nTyped();
const router = useRouter();

const snap = ref<"half" | "full">(props.sheet ?? "half");
watch(
  () => props.sheet,
  (value) => {
    if (value) snap.value = value;
  },
);

const detail = useQuery(computed(() => incidentQuery(props.org, props.incidentId)));
const refetch = () => void detail.refetch();

// The live stream writes `rca` in place, so it gets its own copy, never the query cache's object.
const incident = ref<IncidentWithAlerts | null>(null);
watch(
  () => detail.data.value,
  (data) => {
    if (data) incident.value = { ...data };
  },
  { immediate: true },
);

const loadState = computed(() => {
  if (incident.value) return "ready";
  return detail.isError.value ? "error" : "loading";
});

const rca = useIncidentRca(toRef(props, "org"), incident, ref(true));

// The host keys this thread by run, so a newer run started here mounts a fresh thread pinned to it.
watch(
  [() => props.runId, () => rca.history.value.length] as const,
  ([runId]) => rca.viewRun(runId),
  {
    immediate: true,
  },
);

const analysis = ref<InstanceType<typeof IncidentRCAAnalysis> | null>(null);

const title = computed(() =>
  incident.value?.title
    ? raw(`${incident.value.title} · ${t("assistant.rca.tag")}`)
    : t("assistant.rca.tag"),
);

const finishedReport = computed(() => !rca.live.value && rca.reportText.value.length > 0);

const readAloud = useReadAloud(() => rca.reportText.value);

const reanalyze = async (options: RcaTriggerRequest) => {
  const before = rca.summary.value?.run_id ?? null;
  await rca.trigger(options);
  const runId = rca.summary.value?.run_id ?? null;
  if (!runId || runId === before) return;
  emit("reanalyze", { runId });
};

// Branch: a new chat with the report attached, through the one door every page uses.
const branch = (payload: RcaAskPayload) =>
  void import("@/composables/assistant").then((m) =>
    m.openAssistant(m.legacyRelayArgs(payload, false)),
  );

const linkCopied = ref(false);
let linkTimer: number | undefined;
const shareLink = async () => {
  const { href } = router.resolve({
    name: "incidentDetail",
    params: { id: props.incidentId },
    query: { org_identifier: props.org, tab: "incidentAnalysis" },
  });
  try {
    await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
    linkCopied.value = true;
    clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => (linkCopied.value = false), 2_000);
  } catch (error) {
    console.error("Failed to copy the analysis link:", error);
    toast({ variant: "error", message: t("alerts.incidents.rcaCopyFailed") });
  }
};

onUnmounted(() => {
  clearTimeout(linkTimer);
  readAloud.stop();
});
</script>
