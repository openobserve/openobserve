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
import { computed, inject, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import config from "@/aws-exports";
import analytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { FIRST_EVENT_BUDGET, cadenceAt } from "@/composables/firstEvent/firstEventBudget";
import { rangeRoute } from "@/composables/firstEvent/confirmQuery";
import {
  useFirstEventWatch,
  type FirstEventResult,
  type FirstEventState,
  type StreamSignal,
} from "@/composables/firstEvent/useFirstEventWatch";
import FirstEventStillStuck from "./FirstEventStillStuck.vue";
import { FIRST_EVENT_ASK_AI, REJECTION_REASON_KEYS, askAiQuery } from "./firstEventAskAi";

const props = withDefaults(
  defineProps<{
    org: string;
    signal?: StreamSignal;
    targetStream?: string;
    filter?: string;
    /** `keyword`: targetStream is a name fragment the source's streams share. */
    match?: "exact" | "keyword";
    kind?: "test" | "standard";
    /** Route name for Connect your real source on a test guide. */
    guideRoute?: string;
    guideName?: string;
    docUrl?: string;
    snippetKind?: "command" | "config";
    /** The guide's host or cluster input, when the user typed one. */
    sourceLabel?: string;
    /** `pill` renders the state pill and its one line only, for empty pages that link to the guide for diagnosis. */
    display?: "bar" | "pill";
    /** Replaces the generic waiting pill text in `pill` display. */
    waitingLabel?: I18nText;
  }>(),
  {
    signal: undefined,
    targetStream: undefined,
    filter: undefined,
    match: undefined,
    kind: "standard",
    guideRoute: undefined,
    guideName: "",
    docUrl: undefined,
    snippetKind: "command",
    sourceLabel: undefined,
    display: "bar",
    waitingLabel: undefined,
  },
);

const emit = defineEmits<{
  detected: [result: FirstEventResult];
  "copy-command": [];
  state: [state: FirstEventState];
}>();

const { t, locale } = useI18nTyped();
const store = useStore();
const router = useRouter();
const askAiFn = inject(FIRST_EVENT_ASK_AI, null);
// getIngestionURL's rule, kept reactive because /config can land after the bar mounts
const endpoint = computed<string>(
  () => store.state.zoConfig?.ingestion_url || store.state.API_ENDPOINT || "",
);

const watcher = useFirstEventWatch(toRef(props, "org"), toRef(props, "signal"), {
  targetStream: toRef(props, "targetStream"),
  filter: toRef(props, "filter"),
  match: toRef(props, "match"),
  autoDiagnosis: computed(() => props.display !== "pill"),
});
const { state, result, diagnosis, startedAtMs, scope, troubleshooting } = watcher;

const CLOCK_TICK_MS = 1000;
const FLUENT_BIT = raw("Fluent Bit");

// a reactive clock, so the elapsed time and the cadence shown move on their own
const nowMs = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  watcher.start("open");
  clock = setInterval(() => (nowMs.value = Date.now()), CLOCK_TICK_MS);
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
});

const elapsedMs = computed(() => Math.max(0, nowMs.value - (startedAtMs.value ?? nowMs.value)));
const cadenceSeconds = computed(
  () => (cadenceAt(elapsedMs.value) ?? FIRST_EVENT_BUDGET.slowMs) / 1000,
);
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
// seconds, then whole minutes: m:ss read as a clock time (23:59)
const formatElapsed = (ms: number, round: (n: number) => number = Math.round) => {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60
    ? t("ingestion.firstEvent.elapsedSeconds", { count: seconds })
    : t("ingestion.firstEvent.elapsedMinutes", { count: round(seconds / 60) });
};
const clockTime = (us: number, withMs = false) => {
  const d = new Date(us / 1000);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return raw(withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base);
};
const shortTime = (us: number) => {
  const d = new Date(us / 1000);
  return raw(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
};
// the locale short date goes in front when the first-seen day is not today
const sinceTime = (us: number) => {
  const d = new Date(us / 1000);
  if (d.toDateString() === new Date(nowMs.value).toDateString()) return shortTime(us);
  const day = d.toLocaleDateString(locale.value, { month: "short", day: "numeric" });
  return raw(`${day} ${shortTime(us)}`);
};

const orgId = computed(() => raw(props.org));
const region = computed(() => {
  const name = store.state.zoConfig?.cluster_name;
  if (name) return raw(name);
  try {
    return raw(new URL(endpoint.value, window.location.origin).host);
  } catch {
    return raw(endpoint.value);
  }
});
const sourceText = computed(() => (props.sourceLabel ? raw(props.sourceLabel) : undefined));
const streamText = computed(() => raw(result.value?.streamName ?? props.targetStream ?? ""));

const showTroubleshoot = computed(() => state.value === "waiting" && !diagnosis.value);
const showDiagnosis = computed(
  () =>
    state.value === "rejected" ||
    state.value === "no-requests" ||
    (state.value === "waiting" && diagnosis.value?.form === "unavailable"),
);
const diagnosisForm = computed(() =>
  state.value === "rejected"
    ? "rejected"
    : state.value === "no-requests"
      ? "no-requests"
      : "unavailable",
);

const bannerVariant = computed(() => {
  switch (state.value) {
    case "received":
      return "success";
    case "rejected":
      return "error-soft";
    case "no-requests":
      return "info";
    default:
      return "default";
  }
});

const waitingText = computed((): I18nText => {
  // a keyword is a name fragment the source's streams share, never a stream the user could find
  const stream =
    props.targetStream && props.match !== "keyword" ? raw(props.targetStream) : undefined;
  if (scope.value === "since-watch-start") {
    if (sourceText.value) {
      return t("ingestion.firstEvent.waitingNewFrom", { source: sourceText.value });
    }
    return stream
      ? t("ingestion.firstEvent.waitingNewIn", { stream })
      : t("ingestion.firstEvent.waitingNewAny");
  }
  if (sourceText.value) return t("ingestion.firstEvent.waitingFrom", { source: sourceText.value });
  if (!stream) return t("ingestion.firstEvent.waitingAny");
  if (props.signal === "logs") return t("ingestion.firstEvent.waitingLogsIn", { stream });
  if (props.signal === "metrics") return t("ingestion.firstEvent.waitingMetricsIn", { stream });
  if (props.signal === "traces") return t("ingestion.firstEvent.waitingTracesIn", { stream });
  return t("ingestion.firstEvent.waitingIn", { stream });
});

const pill = computed(
  (): {
    label: I18nText;
    variant: "default" | "success" | "error" | "primary";
    icon?: string;
    dot?: boolean;
  } => {
    switch (state.value) {
      case "received":
        return {
          label:
            props.kind === "test"
              ? t("ingestion.firstEvent.testPill")
              : scope.value === "since-watch-start"
                ? t("ingestion.firstEvent.receivedNewPill")
                : t("ingestion.firstEvent.receivedPill"),
          variant: "success",
          icon: "check-circle",
        };
      case "rejected":
        return { label: t("ingestion.firstEvent.rejectedPill"), variant: "error", icon: "cancel" };
      case "no-requests":
        return {
          label: t("ingestion.firstEvent.noRequestsPill"),
          variant: "primary",
          icon: "info",
        };
      case "stopped":
        return { label: t("ingestion.firstEvent.stoppedPill"), variant: "default" };
      default:
        return {
          label:
            props.display === "pill" && props.waitingLabel ? props.waitingLabel : waitingText.value,
          variant: "default",
          dot: true,
        };
    }
  },
);

const metaText = computed(() => {
  const params = { seconds: cadenceSeconds.value, elapsed: formatElapsed(elapsedMs.value) };
  if (scope.value === "since-watch-start" && watcher.sinceUs.value) {
    return t("ingestion.firstEvent.metaSince", {
      ...params,
      time: clockTime(watcher.sinceUs.value),
    });
  }
  return t("ingestion.firstEvent.meta", params);
});

const recordsText = computed(() => {
  const n = result.value?.count ?? 0;
  return t("ingestion.firstEvent.records", { count: raw(n.toLocaleString()) }, n);
});
const summaryKey = computed(() => {
  if (props.kind === "test") return "ingestion.firstEvent.summaryTest";
  if (result.value?.sinceUs !== undefined) {
    return sourceText.value
      ? "ingestion.firstEvent.summarySinceFrom"
      : "ingestion.firstEvent.summarySince";
  }
  return sourceText.value ? "ingestion.firstEvent.summaryFrom" : "ingestion.firstEvent.summary";
});

const openLabel = computed(() => {
  const type = result.value?.streamType;
  if (type === "metrics") return t("ingestion.firstEvent.openInMetrics");
  if (type === "traces") return t("ingestion.firstEvent.openInTraces");
  return t("ingestion.firstEvent.openInLogs");
});

const firstRecordJson = computed(() => {
  const record = result.value?.firstRecord;
  if (!record) return raw("");
  const shown = Object.fromEntries(
    Object.entries(record).filter(([k]) => k !== "_timestamp" && !k.startsWith("_o2_")),
  );
  return raw(JSON.stringify(shown));
});

const currentTokenName = computed(() => {
  const passcode = store.state.organizationData?.organizationPasscode;
  const tokens: Array<{ name: string; token: string }> =
    store.state.organizationData?.orgTokens ?? [];
  const name = tokens.find((tk) => tk.token === passcode)?.name;
  return name ? raw(name) : undefined;
});

const newest = computed(() => diagnosis.value?.rejections[0]);
const reasonText = (reason: keyof typeof REJECTION_REASON_KEYS) =>
  t(REJECTION_REASON_KEYS[reason] ?? "ingestion.firstEvent.reasonMalformedBody");

const invalidCredentialsFix = (token: I18nText | undefined): I18nText => {
  if (props.snippetKind === "config") {
    return token
      ? t("ingestion.firstEvent.fixInvalidCredentialsConfig", { tool: FLUENT_BIT, token })
      : t("ingestion.firstEvent.fixInvalidCredentialsConfigUnnamed", { tool: FLUENT_BIT });
  }
  return token
    ? t("ingestion.firstEvent.fixInvalidCredentials", { token })
    : t("ingestion.firstEvent.fixInvalidCredentialsUnnamed");
};

const fixText = computed((): I18nText => {
  switch (newest.value?.reason) {
    case "malformed_body":
      return t("ingestion.firstEvent.fixMalformedBody");
    case "batch_too_large":
      return t("ingestion.firstEvent.fixBatchTooLarge");
    case "rate_or_quota":
      return t("ingestion.firstEvent.fixRateOrQuota");
    default:
      return invalidCredentialsFix(currentTokenName.value);
  }
});

const noRequestsWindow = computed(() =>
  elapsedMs.value < FIRST_EVENT_BUDGET.diagnosisAtMs
    ? t("ingestion.firstEvent.windowSince", {
        elapsed: formatElapsed(elapsedMs.value, Math.floor),
      })
    : t("ingestion.firstEvent.windowLast2"),
);

const copyLabel = computed(() =>
  props.snippetKind === "config"
    ? t("ingestion.firstEvent.copyConfig")
    : t("ingestion.firstEvent.copyCommand"),
);

const aiEnabled = computed(
  () => config.isEnterprise === "true" && !!store.state.zoConfig?.ai_enabled,
);
const stillStuckQuery = computed(() => {
  if (!askAiFn || !aiEnabled.value || !diagnosis.value) return undefined;
  return askAiQuery(
    {
      guideName: props.guideName,
      diagnosis: { ...diagnosis.value, form: diagnosisForm.value },
      org: props.org,
      endpoint: endpoint.value,
    },
    t,
  );
});

const hint = computed((): I18nText | undefined => {
  if (state.value === "received") {
    return props.kind === "standard" && scope.value !== "since-watch-start"
      ? t("ingestion.firstEvent.receivedHint", { action: openLabel.value })
      : undefined;
  }
  if (state.value === "stopped") return t("ingestion.firstEvent.stoppedHint");
  if (state.value === "rejected" || state.value === "no-requests") {
    return t("ingestion.firstEvent.hintStillChecking", { seconds: cadenceSeconds.value });
  }
  return elapsedMs.value < FIRST_EVENT_BUDGET.diagnosisAtMs && !diagnosis.value
    ? t("ingestion.firstEvent.hintWaiting")
    : t("ingestion.firstEvent.hintWaitingLate");
});

const secondsSinceSignup = (): number => {
  const identifier = store.state.selectedOrganization?.identifier;
  const created = Number(
    store.state.selectedOrganization?.created_at ??
      (store.state.organizations ?? []).find(
        (o: { identifier?: string }) => o?.identifier === identifier,
      )?.created_at ??
      0,
  );
  if (!created) return -1;
  const createdMs = created > 1e15 ? created / 1000 : created > 1e12 ? created : created * 1000;
  return Math.max(0, Math.round((Date.now() - createdMs) / 1000));
};

let diagnosisReported = false;
watch(state, (next, prev) => {
  emit("state", next);
  // Check again (or a copy) after the stop starts a new watch, which reports its own diagnosis
  if (prev === "stopped" && next === "waiting") diagnosisReported = false;
  if (next === "received" && prev !== "received" && result.value) {
    analytics.track("first_event_detected", {
      stream_type: result.value.streamType,
      seconds_since_signup: secondsSinceSignup(),
    });
    emit("detected", result.value);
  }
});

watch(
  () => diagnosis.value,
  (d) => {
    if (diagnosisReported || !d || d.form === "unavailable") return;
    diagnosisReported = true;
    analytics.track("first_event_diagnosis_shown", {
      reason: d.form === "rejected" ? (d.rejections[0]?.reason ?? "rejected") : "no_requests",
      trigger: d.trigger,
    });
  },
);

const openData = () => {
  const r = result.value;
  if (!r) return;
  router
    .push(
      rangeRoute(props.org, r.streamType, r.streamName, {
        startUs: r.rangeStart,
        endUs: r.rangeEnd,
      }),
    )
    .catch(() => {});
};
const goTo = (name: string) => {
  router.push({ name, query: { org_identifier: props.org } }).catch(() => {});
};

defineExpose({ start: watcher.start, probeNow: watcher.probeNow });
</script>

<template>
  <div
    v-if="display === 'pill'"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    data-test="first-event-status"
    :data-state="state"
    data-display="pill"
  >
    <OTag
      :label="pill.label"
      :variant="pill.variant"
      :icon="pill.icon ?? ''"
      :dot="pill.dot"
      size="sm"
    />
    <OText v-if="state === 'waiting'" variant="meta" data-test="first-event-status-meta">{{
      metaText
    }}</OText>
    <template v-else-if="state === 'stopped'">
      <OText variant="meta" data-test="first-event-status-meta">{{
        t("ingestion.firstEvent.stoppedMeta")
      }}</OText>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        data-test="first-event-status-restart-btn"
        @click="watcher.start('open')"
      >
        {{ t("ingestion.firstEvent.checkAgain") }}
      </OButton>
    </template>
    <OText v-else-if="state === 'received'" variant="meta" data-test="first-event-status-summary">{{
      t(summaryKey, {
        records: recordsText,
        stream: streamText,
        source: sourceText ?? raw(""),
        time: result?.sinceUs !== undefined ? shortTime(result.sinceUs) : raw(""),
      })
    }}</OText>
  </div>
  <div v-else class="flex flex-col gap-2 text-sm">
    <OBanner
      :variant="bannerVariant"
      :inline-actions="state !== 'rejected'"
      dense
      data-test="first-event-status"
      :data-state="state"
      :data-kind="kind === 'test' ? 'test' : undefined"
      :data-scope="scope === 'since-watch-start' ? 'since-watch-start' : undefined"
      :data-reason="state === 'rejected' ? newest?.reason : undefined"
    >
      <div
        :class="
          state === 'rejected'
            ? 'flex flex-col items-start gap-2'
            : 'flex flex-wrap items-center gap-x-4 gap-y-1'
        "
      >
        <OTag
          :label="pill.label"
          :variant="pill.variant"
          :icon="pill.icon ?? ''"
          :dot="pill.dot"
          size="sm"
        />
        <OText v-if="state === 'waiting'" variant="meta" data-test="first-event-status-meta">{{
          metaText
        }}</OText>
        <OText v-else-if="state === 'stopped'" variant="meta" data-test="first-event-status-meta">{{
          t("ingestion.firstEvent.stoppedMeta")
        }}</OText>
        <span v-else-if="state === 'received'" data-test="first-event-status-summary">
          <i18n-t :keypath="summaryKey" tag="span">
            <template #records
              ><strong>{{ recordsText }}</strong></template
            >
            <template #stream
              ><strong>{{ streamText }}</strong></template
            >
            <template #source>{{ sourceText }}</template>
            <template #time>{{
              result?.sinceUs !== undefined ? shortTime(result.sinceUs) : ""
            }}</template>
          </i18n-t>
        </span>
        <span v-else-if="state === 'rejected' && newest" data-test="first-event-status-summary">
          <i18n-t keypath="ingestion.firstEvent.rejectedSummary" tag="span">
            <template #org
              ><strong>{{ orgId }}</strong></template
            >
            <template #cause
              ><strong>{{
                t("ingestion.firstEvent.cause", {
                  status: newest.status,
                  reason: reasonText(newest.reason),
                })
              }}</strong></template
            >
            <template #time>{{ sinceTime(newest.firstSeen) }}</template>
            <template #path
              ><OText variant="mono">{{ raw(newest.path) }}</OText></template
            >
          </i18n-t>
          <template v-if="newest.tokenName"
            >{{ raw(" · ")
            }}{{
              t("ingestion.firstEvent.rejectedToken", { name: raw(newest.tokenName) })
            }}</template
          >
        </span>
        <span v-else-if="state === 'no-requests'" data-test="first-event-status-summary">
          <i18n-t keypath="ingestion.firstEvent.noRequestsSummary" tag="span">
            <template #org
              ><strong>{{ orgId }}</strong></template
            >
            <template #region
              ><strong>{{ region }}</strong></template
            >
            <template #window>{{ noRequestsWindow }}</template>
          </i18n-t>
        </span>
      </div>
      <template v-if="state === 'waiting' || state === 'stopped' || state === 'received'" #actions>
        <div class="flex items-center gap-2">
          <OButton
            v-if="showTroubleshoot"
            variant="ghost"
            size="sm-action"
            :loading="troubleshooting"
            data-test="first-event-status-troubleshoot-btn"
            @click="watcher.troubleshoot()"
          >
            {{ t("ingestion.firstEvent.troubleshoot") }}
          </OButton>
          <OButton
            v-if="state === 'stopped'"
            variant="outline"
            size="sm-action"
            data-test="first-event-status-restart-btn"
            @click="watcher.start('open')"
          >
            {{ t("ingestion.firstEvent.checkAgain") }}
          </OButton>
          <template v-if="state === 'received' && kind === 'test'">
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="open-in-new"
              data-test="first-event-status-open-btn"
              @click="openData"
            >
              {{ openLabel }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              data-test="first-event-status-connect-source-btn"
              @click="goTo(guideRoute ?? 'recommended')"
            >
              {{ t("ingestion.firstEvent.connectSource") }}
            </OButton>
          </template>
          <template v-else-if="state === 'received'">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="first-event-status-setup-another-btn"
              @click="goTo('recommended')"
            >
              {{ t("ingestion.firstEvent.setupAnother") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              icon-left="open-in-new"
              data-test="first-event-status-open-btn"
              @click="openData"
            >
              {{ openLabel }}
            </OButton>
          </template>
        </div>
      </template>
    </OBanner>

    <div
      v-if="state === 'received' && result?.firstRecord"
      class="border-border-default rounded-default flex min-w-0 items-center gap-4 border px-3 py-2 font-mono text-xs"
      data-test="first-event-status-first-record"
    >
      <span class="text-text-secondary shrink-0">{{
        result.firstRecordUs ? clockTime(result.firstRecordUs, true) : ""
      }}</span>
      <strong class="shrink-0">{{ streamText }}</strong>
      <span class="min-w-0 truncate">{{ firstRecordJson }}</span>
    </div>

    <div
      v-if="showDiagnosis && diagnosis"
      class="flex flex-col gap-2"
      data-test="first-event-diagnosis"
      :data-trigger="diagnosis.trigger"
      :data-reason="diagnosisForm === 'unavailable' ? 'unavailable' : undefined"
    >
      <div class="border-border-default rounded-default flex items-start gap-3 border px-3 py-2">
        <span
          class="border-border-default inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
          >{{ raw(1) }}</span
        >
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <span v-if="diagnosisForm === 'rejected'" data-test="first-event-diagnosis-fix">{{
            fixText
          }}</span>
          <template v-else>
            <span data-test="first-event-diagnosis-fix">{{
              diagnosisForm === "unavailable"
                ? t("ingestion.firstEvent.unavailable")
                : t("ingestion.firstEvent.compare")
            }}</span>
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span class="text-text-secondary">{{ t("ingestion.firstEvent.orgIdLabel") }}</span>
              <OText variant="mono" data-test="first-event-diagnosis-org-id">{{ orgId }}</OText>
              <span class="text-text-secondary">{{ t("ingestion.firstEvent.endpointLabel") }}</span>
              <OText variant="mono" data-test="first-event-diagnosis-endpoint">{{
                raw(endpoint)
              }}</OText>
            </div>
          </template>
        </div>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="content-copy"
          data-test="first-event-diagnosis-copy-btn"
          @click="emit('copy-command')"
        >
          {{ copyLabel }}
        </OButton>
      </div>

      <div
        v-if="diagnosisForm === 'rejected'"
        class="border-border-default rounded-default flex items-start gap-3 border px-3 py-2"
      >
        <span
          class="border-border-default inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
          >{{ raw(2) }}</span
        >
        <i18n-t keypath="ingestion.firstEvent.rightPlace" tag="span" class="text-text-secondary">
          <template #org
            ><strong>{{ orgId }}</strong></template
          >
          <template #region
            ><strong>{{ region }}</strong></template
          >
          <template #endpoint
            ><OText variant="mono">{{ raw(endpoint) }}</OText></template
          >
        </i18n-t>
      </div>
      <div
        v-else-if="sourceText"
        class="border-border-default rounded-default flex items-start gap-3 border px-3 py-2"
      >
        <span
          class="border-border-default inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
          >{{ raw(2) }}</span
        >
        <i18n-t keypath="ingestion.firstEvent.installCheck" tag="span" class="text-text-secondary">
          <template #source
            ><strong>{{ sourceText }}</strong></template
          >
        </i18n-t>
      </div>

      <div
        v-if="docUrl || (askAiFn && stillStuckQuery)"
        class="border-border-default rounded-default flex items-start gap-3 border px-3 py-2"
      >
        <span
          class="border-border-default inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
          >{{ raw(diagnosisForm === "rejected" || sourceText ? 3 : 2) }}</span
        >
        <FirstEventStillStuck
          :guide-name="guideName"
          :doc-url="docUrl"
          :ask-ai-query="stillStuckQuery"
        />
      </div>
    </div>

    <OText
      v-if="hint"
      variant="meta"
      :data-test="
        state === 'rejected' || state === 'no-requests' ? 'first-event-status-meta' : undefined
      "
      >{{ hint }}</OText
    >
  </div>
</template>
