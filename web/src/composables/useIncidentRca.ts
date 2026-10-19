// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/vue-query";
import incidentsService, {
  type IncidentWithAlerts,
  type RcaLiveError,
  type RcaLiveEvent,
  type RcaRunError,
  type RcaRunItem,
  type RcaRunState,
  type RcaRunSummary,
  type RcaSteering,
  type RcaSummary,
  type RcaThread,
} from "@/services/incidents";
import { incidentKeys } from "@/services/incidents.querykeys";
import { useRcaTrigger } from "@/composables/useRcaTrigger";
import { toast } from "@/lib/feedback/Toast/useToast";
import { isLiveRca } from "@/utils/incidents/rcaCell";
import { raw, useI18nTyped } from "@/types/i18n";

/** How a part of the shown run reads: its data, or why there is none (02 TH32, 05 LU17). */
export type RcaReadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "expired"
  | "incomplete"
  | "unavailable"
  | "unsupported"
  | "missing";

/** LU16: the waits before each reconnect of a dropped live stream; the last repeats. */
export const RCA_LIVE_RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

const isLiveState = (state: RcaRunState) => state === "running" || state === "waiting_input";

/** The server message of a rejected request, if it sent one. */
const serverMessage = (error: unknown): string | null => {
  const body: unknown = isAxiosError(error) ? error.response?.data : null;
  return body &&
    typeof body === "object" &&
    "message" in body &&
    typeof body.message === "string" &&
    body.message
    ? body.message
    : null;
};

/** RR-35: run state, report text and, over one live stream (05 LU15), the shown run's parts. */
export function useIncidentRca(
  orgRef: Ref<string>,
  incidentRef: Ref<IncidentWithAlerts | null>,
  analysisOpen: Ref<boolean>,
) {
  const { t } = useI18nTyped();
  const { requestRca, requestResume } = useRcaTrigger();
  const queryClient = useQueryClient();

  // RR-34: invalidate list summaries whenever a run changes.
  const invalidateList = (org: string) =>
    void queryClient.invalidateQueries({ queryKey: incidentKeys.all(org) });

  // Aborts a pending consent prompt once the owner unmounts.
  const lifecycle = new AbortController();

  const summary = computed<RcaSummary | null>(() => incidentRef.value?.rca ?? null);
  const state = computed<RcaRunState | null>(() => summary.value?.state ?? null);
  const live = computed(() => isLiveRca(summary.value));
  const stale = computed(() => live.value && summary.value?.stale === true);
  const currentRun = computed(() => summary.value?.current_run ?? null);
  const reportRun = computed<RcaRunItem | null>(() => summary.value?.report_run ?? null);
  const history = computed<RcaRunItem[]>(() => summary.value?.history ?? []);

  /** The failure of the latest run, or null when the latest run did not fail. */
  const currentError = computed<RcaRunError | null>(() => {
    if (state.value !== "failed") return null;
    const error = currentRun.value?.error;
    if (error) return error;
    return {
      code: "",
      reason: summary.value?.summary.detail ?? "",
      details: null,
      trigger_type: null,
    };
  });

  const resumeRunId = computed(() => summary.value?.resume_run_id ?? null);

  // Null follows the latest report; a history selection stays pinned.
  const viewedRunId = ref<string | null>(null);
  const viewedRun = computed<RcaRunItem | null>(() => {
    const id = viewedRunId.value;
    if (!id) return null;
    return history.value.find((run) => run.run_id === id) ?? null;
  });
  const displayedRunId = computed<string | null>(
    () => viewedRun.value?.run_id ?? reportRun.value?.run_id ?? null,
  );

  // The Thread follows the latest run (live or not) unless a run was picked (02 TH32).
  const threadRunId = computed<string | null>(
    () => viewedRun.value?.run_id ?? summary.value?.run_id ?? null,
  );
  const threadLive = computed(
    () => live.value && threadRunId.value !== null && threadRunId.value === summary.value?.run_id,
  );

  /** A v1 run is a pre-upgrade report: markdown only, with no thread, record, steering or feedback. */
  const threadRunIsV1 = computed(() => {
    const id = threadRunId.value;
    const run =
      history.value.find((item) => item.run_id === id) ??
      (id && id === summary.value?.run_id ? summary.value : null);
    return run?.report_format === "v1";
  });

  // LU15: the run the stream reads while the Analysis tab is open; the run-scoped parts
  // answer 404 for a v1 run, so it has none.
  const liveRunId = computed(() =>
    analysisOpen.value && !threadRunIsV1.value ? threadRunId.value : null,
  );

  const thread = shallowRef<RcaThread | null>(null);
  const threadStatus = ref<RcaReadStatus>("idle");
  const runSummary = shallowRef<RcaRunSummary | null>(null);
  const runSummaryStatus = ref<RcaReadStatus>("idle");
  const steering = shallowRef<RcaSteering | null>(null);
  const steeringStatus = ref<RcaReadStatus>("idle");

  // Report text per run id. A completed run's report never changes.
  const reports = ref<Record<string, string>>({});
  // The run whose report is being fetched; only the displayed one counts as loading.
  const loadingRunId = ref<string | null>(null);
  const reportLoading = computed(
    () => loadingRunId.value !== null && loadingRunId.value === displayedRunId.value,
  );
  const reportText = computed(() => {
    const id = displayedRunId.value;
    return id ? (reports.value[id] ?? "") : "";
  });

  const triggering = ref(false);
  const resuming = ref(false);
  const cancelling = ref(false);

  const isCurrentIncident = (org: string, incidentId: string) =>
    !lifecycle.signal.aborted && orgRef.value === org && incidentRef.value?.id === incidentId;

  const loadReport = async (runId: string) => {
    const incident = incidentRef.value;
    if (!incident || runId in reports.value) return;
    const org = orgRef.value;
    loadingRunId.value = runId;
    try {
      const response = await incidentsService.getRcaRun(org, incident.id, runId);
      if (!isCurrentIncident(org, incident.id)) return;
      reports.value = { ...reports.value, [runId]: response.data.report ?? "" };
    } catch (error) {
      console.error("Failed to load RCA report:", error);
      if (isCurrentIncident(org, incident.id)) {
        toast({ variant: "error", message: t("alerts.incidents.rcaRun.reportLoadFailed") });
      }
    } finally {
      if (loadingRunId.value === runId) loadingRunId.value = null;
    }
  };

  watch(
    displayedRunId,
    (runId) => {
      if (runId) void loadReport(runId);
    },
    { immediate: true },
  );

  // A different incident starts from a clean slate.
  watch(
    () => incidentRef.value?.id,
    (id, previousId) => {
      if (id === previousId) return;
      viewedRunId.value = null;
      reports.value = {};
      triggering.value = false;
      cancelling.value = false;
      resuming.value = false;
    },
  );

  // Ignore older detail reads that finish after a newer one.
  let reloadGeneration = 0;

  /** Re-read the incident detail and take its `rca`. */
  const reload = async () => {
    const incident = incidentRef.value;
    if (!incident) return;
    const org = orgRef.value;
    const generation = ++reloadGeneration;
    try {
      const response = await incidentsService.get(org, incident.id);
      if (generation !== reloadGeneration) return;
      if (!isCurrentIncident(org, incident.id) || !incidentRef.value) return;
      incidentRef.value.rca = response.data.rca ?? null;
    } catch (error) {
      // A failed read says nothing about the run; keep the last known state.
      console.error("Failed to refresh RCA state:", error);
    }
  };

  /** LU17: a transcript error reaches the thread and, unless it holds a finished run's record, the summary. */
  const applyTranscriptError = ({ status, error_code }: RcaLiveError) => {
    if (status === 410 || status === 404) {
      thread.value = null;
      threadStatus.value =
        status === 404
          ? "missing"
          : error_code === "transcript_incomplete"
            ? "incomplete"
            : "expired";
      if (!runSummary.value || isLiveState(runSummary.value.state)) {
        runSummary.value = null;
        runSummaryStatus.value = status === 404 ? "missing" : "expired";
      }
      return;
    }
    if (!thread.value) threadStatus.value = "unavailable";
    const summaryData = runSummary.value;
    // A live summary of a run that ended is out of date: drop it (02 TH32 clearOnTerminalError).
    if (summaryData && isLiveState(summaryData.state) && !threadLive.value) runSummary.value = null;
    if (!runSummary.value) runSummaryStatus.value = "unavailable";
  };

  const applyLiveEvent = (event: RcaLiveEvent) => {
    switch (event.event) {
      case "rca":
        // The stream is newer than any detail read still in flight.
        reloadGeneration += 1;
        if (incidentRef.value) incidentRef.value.rca = event.data;
        break;
      case "thread":
        thread.value = event.data;
        threadStatus.value = "ready";
        break;
      case "summary":
        runSummary.value = event.data;
        runSummaryStatus.value = "ready";
        break;
      case "steering":
        steering.value = event.data;
        steeringStatus.value = "ready";
        break;
      case "error":
        if (event.data.part === "transcript") applyTranscriptError(event.data);
        else if (event.data.part === "steering") steeringStatus.value = "unavailable";
        else console.error("RCA live stream could not read the analysis state:", event.data);
        break;
      case "end":
        break;
    }
  };

  /** LU15: hold a stream while the latest run is live or the Analysis tab is open. */
  const liveWanted = computed(() => live.value || analysisOpen.value);

  let connection: AbortController | null = null;
  let reconnectTimer: number | undefined;
  let reconnects = 0;

  const closeLive = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    connection?.abort();
    connection = null;
  };

  const setPartStatus = (status: RcaReadStatus) => {
    threadStatus.value = status;
    runSummaryStatus.value = status;
    steeringStatus.value = status;
  };

  const openLive = () => {
    closeLive();
    const incidentId = incidentRef.value?.id;
    if (!incidentId || !liveWanted.value) return;
    const controller = new AbortController();
    connection = controller;
    // LU16: reconnect after a drop, a network error or a 5xx; the wait grows until an event arrives.
    const reconnect = () => {
      if (connection !== controller) return;
      const wait = RCA_LIVE_RECONNECT_MS[Math.min(reconnects, RCA_LIVE_RECONNECT_MS.length - 1)];
      reconnects += 1;
      reconnectTimer = window.setTimeout(openLive, wait);
    };
    incidentsService
      .openRcaLiveStream(orgRef.value, incidentId, liveRunId.value, {
        signal: controller.signal,
        onEvent: (event) => {
          if (connection !== controller) return;
          reconnects = 0;
          applyLiveEvent(event);
        },
      })
      .then(({ ended }) => {
        if (ended) {
          if (connection === controller) connection = null;
        } else reconnect();
      })
      .catch((error: unknown) => {
        if (connection !== controller) return;
        const status =
          error instanceof Error && "status" in error && typeof error.status === "number"
            ? error.status
            : 0;
        if (status === 403 || status === 404) {
          connection = null;
          thread.value = null;
          runSummary.value = null;
          steering.value = null;
          setPartStatus(status === 403 ? "unsupported" : "missing");
          return;
        }
        console.error("RCA live stream failed:", error);
        reconnect();
      });
  };

  // A new incident, run or tab state starts the parts over on a new stream.
  watch(
    [orgRef, () => incidentRef.value?.id, liveRunId, liveWanted] as const,
    () => {
      thread.value = null;
      runSummary.value = null;
      steering.value = null;
      setPartStatus(liveRunId.value && liveWanted.value ? "loading" : "idle");
      reconnects = 0;
      openLive();
    },
    { immediate: true },
  );

  /** Reconnect at once (LU17). */
  const retryLive = () => {
    for (const status of [threadStatus, runSummaryStatus, steeringStatus]) {
      if (status.value === "unavailable") status.value = "loading";
    }
    reconnects = 0;
    openLive();
  };

  watch([live, () => incidentRef.value?.id] as const, ([isLive, id], previous) => {
    // The run of this incident just ended: its list row changed too.
    if (!isLive && previous?.[0] && previous[1] === id) invalidateList(orgRef.value);
  });

  /** Show a completed run's report and thread; null (or the latest run) follows the latest run. */
  const viewRun = (runId: string | null) => {
    if (!runId || runId === summary.value?.run_id) {
      viewedRunId.value = null;
      return;
    }
    const run = history.value.find((item) => item.run_id === runId);
    if (run?.state === "completed") viewedRunId.value = runId;
  };

  /** Reload committed failures before deciding whether a trigger error needs a toast. */
  const trigger = async (options: { buildOnPrevious?: boolean; guidance?: string } = {}) => {
    const incident = incidentRef.value;
    if (!incident || triggering.value || resuming.value) return;
    const org = orgRef.value;
    const incidentId = incident.id;
    const previousRunId = currentRun.value?.run_id ?? null;
    const guidance = options.guidance?.trim();

    triggering.value = true;
    viewedRunId.value = null;
    try {
      const result = await requestRca(
        org,
        incidentId,
        {
          build_on_previous: options.buildOnPrevious === true,
          ...(guidance ? { guidance } : {}),
        },
        {
          signal: lifecycle.signal,
          isStillActive: () => isCurrentIncident(org, incidentId),
        },
      );
      if (!isCurrentIncident(org, incidentId)) return;
      if (result.status === "unavailable") {
        toast({ variant: "error", message: result.message });
        return;
      }
      if (result.status === "started") {
        invalidateList(org);
        await reload();
      }
    } catch (error) {
      console.error("Failed to start RCA:", error);
      if (!isCurrentIncident(org, incidentId)) return;
      await reload();
      if (!isCurrentIncident(org, incidentId)) return;
      const latestRunId = currentRun.value?.run_id ?? null;
      if (latestRunId && latestRunId !== previousRunId) {
        // The server created the run; its state (the failure banner) says the rest.
        invalidateList(org);
        return;
      }
      const message = serverMessage(error);
      toast({
        variant: "error",
        message: message ? raw(message) : t("alerts.incidents.rcaFailedGeneric"),
      });
    } finally {
      if (incidentRef.value?.id === incidentId) triggering.value = false;
    }
  };

  /** Cancel the live (or stale) run, then re-read the detail. */
  const cancel = async () => {
    const incident = incidentRef.value;
    if (!incident || cancelling.value) return;
    const org = orgRef.value;
    const incidentId = incident.id;

    cancelling.value = true;
    try {
      await incidentsService.cancelRca(org, incidentId);
      invalidateList(org);
      if (isCurrentIncident(org, incidentId)) {
        toast({ variant: "info", message: t("alerts.incidents.rcaCancelled") });
      }
    } catch (error) {
      console.error("Failed to cancel RCA:", error);
      if (isCurrentIncident(org, incidentId)) {
        const message = serverMessage(error);
        toast({
          variant: "error",
          message: message ? raw(message) : t("alerts.incidents.rcaCancelFailed"),
        });
      }
    } finally {
      // Either way the run may have moved on; re-read it.
      await reload();
      if (incidentRef.value?.id === incidentId) cancelling.value = false;
    }
  };

  /** Resume the latest failed or cancelled run (J9): a new run that reuses its finished steps. */
  const resume = async (runId: string) => {
    const incident = incidentRef.value;
    if (!incident || resuming.value || triggering.value) return;
    const org = orgRef.value;
    const incidentId = incident.id;
    const previousRunId = currentRun.value?.run_id ?? null;

    resuming.value = true;
    viewedRunId.value = null;
    try {
      const result = await requestResume(org, incidentId, runId, {
        signal: lifecycle.signal,
        isStillActive: () => isCurrentIncident(org, incidentId),
      });
      if (!isCurrentIncident(org, incidentId)) return;
      if (result.status === "unavailable") {
        toast({ variant: "error", message: result.message });
        return;
      }
      if (result.status === "started") {
        const { reused_steps: steps, from_step: fromStep } = result.data;
        toast({
          variant: "success",
          message: t(
            "alerts.incidents.rcaResume.started",
            { step: fromStep.title, count: steps },
            steps,
          ),
        });
        invalidateList(org);
        await reload();
      }
    } catch (error) {
      console.error("Failed to resume RCA:", error);
      if (!isCurrentIncident(org, incidentId)) return;
      await reload();
      if (!isCurrentIncident(org, incidentId)) return;
      const latestRunId = currentRun.value?.run_id ?? null;
      if (latestRunId && latestRunId !== previousRunId) {
        // The server created the resumed run; its state (the failure banner) says the rest.
        invalidateList(org);
        return;
      }
      const message = serverMessage(error);
      toast({
        variant: "error",
        message: message ? raw(message) : t("alerts.incidents.rcaResume.failed"),
      });
    } finally {
      if (incidentRef.value?.id === incidentId) resuming.value = false;
    }
  };

  onScopeDispose(() => {
    closeLive();
    lifecycle.abort();
  });

  return {
    summary,
    state,
    live,
    stale,
    currentRun,
    currentError,
    reportRun,
    history,
    viewedRun,
    displayedRunId,
    threadRunId,
    threadLive,
    threadRunIsV1,
    thread,
    threadStatus,
    runSummary,
    runSummaryStatus,
    steering,
    steeringStatus,
    retryLive,
    reportText,
    reportLoading,
    triggering,
    cancelling,
    resuming,
    resumeRunId,
    reload,
    viewRun,
    trigger,
    cancel,
    resume,
  };
}

export default useIncidentRca;
