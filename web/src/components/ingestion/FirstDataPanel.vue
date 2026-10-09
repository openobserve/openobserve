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
import { computed, defineComponent, h, inject, onUnmounted, ref, watch, type Component } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import config from "@/aws-exports";
import analytics from "@/services/product_analytics";
import { streamNameListQuery } from "@/services/stream.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getEndPoint, getImageURL } from "@/utils/zincutils";
import { b64EncodeStandard } from "@/utils/formatters";
import { copyToClipboard } from "@/utils/clipboard";
import { isPrimaryCloudWebUrl } from "@/utils/otelCollectorConfig";
import { USER_DATA_STREAM_TYPES, userDataStreams } from "@/utils/internalStreams";
import { OPEN_TOKEN_PICKER, useCredentialSnippet } from "@/composables/useCredentialSnippet";
import { useOrgCredential } from "@/composables/useOrgCredential";
import type { FirstEventResult, StreamSignal } from "@/composables/firstEvent/useFirstEventWatch";
import { firstSourceOption, readFirstSource } from "@/components/login/firstSourceOptions";
import { getDataSourceCard, hasDataSourceCard } from "./setupCard/registry";
import type { RichCardCode, RichCardContent } from "./setupCard/types";
import FirstEventStatus from "./FirstEventStatus.vue";

// how long the card outlives the store flip while the watcher confirms the stream that caused it
const CONFIRM_GRACE_MS = 10_000;

type FirstDataLayout = "panel" | "card" | "status" | "pending" | "forbidden" | "none";

const props = withDefaults(
  defineProps<{
    signal: StreamSignal | "any";
    variant: "full" | "compact";
    /** Set after the page re-queried on the first stream: renders the arrival strip only. */
    arrived?: FirstEventResult;
    /** The page's empty state draws the no-pick status line itself, from the slot's `statusLine`. */
    statusInSlot?: boolean;
    /** Which page the compact sentence speaks for; unset reads as Dashboards. */
    context?: "overview" | "usage" | "dashboards";
  }>(),
  { arrived: undefined, statusInSlot: false, context: undefined },
);

const emit = defineEmits<{
  detected: [result: FirstEventResult];
  dismiss: [];
  open: [];
}>();

defineSlots<{
  /** The page's own empty state; hidden only when the stream list is forbidden. */
  default?(props: { layout: FirstDataLayout; statusLine: Component }): unknown;
}>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const openTokenPicker = inject(OPEN_TOKEN_PICKER, null);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
// Cloud identifiers are random strings; a selection set from the URL carries no label, so the org list names it
const orgName = computed<string>(
  () =>
    store.state.selectedOrganization?.label ||
    (store.state.organizations ?? []).find(
      (o: { identifier?: string; name?: string }) => o?.identifier === org.value,
    )?.name ||
    org.value,
);
const flagOn = computed(() => store.state.zoConfig?.restricted_routes_on_empty_data === true);
const signals = computed<StreamSignal[]>(() =>
  props.signal === "any" ? [...USER_DATA_STREAM_TYPES] : [props.signal],
);

// disabled observers: they read the lists the page and MainLayout already fetched, never a new request
const listQueries = USER_DATA_STREAM_TYPES.map((type) =>
  useQuery(
    computed(() =>
      Object.assign(streamNameListQuery(org.value, type), { enabled: false as const }),
    ),
  ),
);
const queriesFor = () =>
  USER_DATA_STREAM_TYPES.map((type, i) => ({ type, query: listQueries[i] })).filter((q) =>
    signals.value.includes(q.type),
  );
const isForbidden = (err: unknown) => {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 403 || e?.response?.status === 403;
};
const forbidden = computed(
  () => flagOn.value && queriesFor().some(({ query }) => isForbidden(query.error.value)),
);
// the compact card waits for MainLayout's list, so an org with data never sees it flash; a failed list reads as empty like a failed probe
const knownEmpty = computed(() =>
  queriesFor().every(({ query }) =>
    Array.isArray(query.data.value)
      ? userDataStreams(query.data.value).length === 0
      : !!query.error.value && !isForbidden(query.error.value),
  ),
);
// the watcher's own list refresh shows the new stream before it confirms it, which must not unmount the card mid-confirmation
const seenEmpty = ref(false);
watch(
  knownEmpty,
  (empty) => {
    if (empty) seenEmpty.value = true;
  },
  { immediate: true },
);
watch(org, () => {
  seenEmpty.value = knownEmpty.value;
});
const detectedHere = ref(false);
// useStreams flips isDataIngested as soon as a list shows a stream, a moment before the watcher confirms and reports it
const confirmGrace = ref(false);
let graceTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => store.state.organizationData?.isDataIngested,
  (ingested) => {
    clearTimeout(graceTimer);
    confirmGrace.value = ingested === true && seenEmpty.value && !detectedHere.value;
    if (confirmGrace.value) {
      graceTimer = setTimeout(() => (confirmGrace.value = false), CONFIRM_GRACE_MS);
    }
  },
);
onUnmounted(() => clearTimeout(graceTimer));
const listsLoaded = computed(() =>
  queriesFor().every(({ query }) => Array.isArray(query.data.value)),
);
const active = computed(() => {
  if (!flagOn.value || forbidden.value || props.arrived) return false;
  if (props.variant === "full") return true;
  if (!seenEmpty.value || detectedHere.value) return false;
  return store.state.organizationData?.isDataIngested === false || confirmGrace.value;
});

const pick = computed(() => firstSourceOption(readFirstSource(org.value)));
const pickMatches = computed(() =>
  props.signal === "any"
    ? !!pick.value?.signals.length
    : !!pick.value?.signals.includes(props.signal),
);
const sourceLabel = computed<I18nText>(() => (pick.value ? t(pick.value.labelKey) : raw("")));
const drawsCommand = computed(
  () => active.value && pickMatches.value && !!pick.value && hasDataSourceCard(pick.value.id),
);
const credential = useOrgCredential(drawsCommand);

// getIngestionURL() injects the store, which fails when Vue re-evaluates this computed outside render after the credential lands
const ingestionUrl = computed<string>(() => {
  const configured = store.state.zoConfig?.ingestion_url;
  return configured ? configured : store.state.API_ENDPOINT;
});
const subs = computed(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: getEndPoint(ingestionUrl.value)?.url ?? "",
    org: org.value,
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
    isPrimaryCloud: isPrimaryCloudWebUrl(store.state.zoConfig?.web_url),
  };
});
const card = computed<RichCardContent | undefined>(() =>
  pick.value && hasDataSourceCard(pick.value.id)
    ? getDataSourceCard(pick.value.id, subs.value, t)
    : undefined,
);
// the Logs over HTTP guide's own curl line (logs/Curl.vue), kept in step with it
const curlTemplate = computed(() => {
  if (!active.value || pick.value?.id !== "http") return "";
  const insecure = config.isCloud === "true" ? "" : " -k";
  return `curl -u [EMAIL]:[PASSCODE]${insecure} ${subs.value.url}/api/${org.value}/default/_json -d "[{\\"level\\":\\"info\\",\\"job\\":\\"test\\",\\"log\\":\\"test message for openobserve\\"}]"`;
});
const snippet = useCredentialSnippet(curlTemplate);

// a card's install step holds the {stream} and input placeholders the guide fills from its fields
const fillCard = (text: string, content: RichCardContent) => {
  let out = text.replaceAll(
    "{stream}",
    content.streamInput?.default ?? content.detect?.streamName ?? "default",
  );
  for (const input of content.steps.flatMap((s) => s.inputs ?? [])) {
    out = out.replaceAll(`{${input.id}}`, input.default);
  }
  return out;
};

const command = computed<{ code: string; masked?: string; lang: string } | undefined>(() => {
  if (!pickMatches.value || store.state.organizationData?.organizationPasscodeForbidden) {
    return undefined;
  }
  // an empty password would still mask into a filled-looking command that answers 401
  if (!credential.ready.value || !store.state.organizationData?.organizationPasscode) {
    return undefined;
  }
  const content = card.value;
  if (content) {
    const step = content.steps.find((s) => s.code || s.variants?.length);
    const code: RichCardCode | undefined = step?.code ?? step?.variants?.[0]?.code;
    if (!code) return undefined;
    return {
      code: fillCard(code.raw, content),
      masked: code.masked ? fillCard(code.masked, content) : undefined,
      lang: code.lang,
    };
  }
  if (!curlTemplate.value) return undefined;
  return {
    code: snippet.code.value,
    masked: snippet.codeMasked.value !== snippet.code.value ? snippet.codeMasked.value : undefined,
    lang: "bash",
  };
});

const titleText = computed((): I18nText => {
  if (props.signal === "metrics") return t("ingestion.firstDataPanel.titleMetrics");
  if (props.signal === "traces") return t("ingestion.firstDataPanel.titleTraces");
  return t("ingestion.firstDataPanel.titleLogs");
});
const bodyKey = computed(() => {
  if (props.signal === "metrics") return "ingestion.firstDataPanel.bodyMetrics" as const;
  if (props.signal === "traces") return "ingestion.firstDataPanel.bodyTraces" as const;
  return "ingestion.firstDataPanel.bodyLogs" as const;
});
const compactText = computed((): I18nText => {
  const params = { source: sourceLabel.value };
  if (props.context === "overview") return t("ingestion.firstDataPanel.compactOverview", params);
  if (props.context === "usage") return t("ingestion.firstDataPanel.compactUsage", params);
  return t("ingestion.firstDataPanel.compactDashboards", params);
});
const onHome = computed(() => props.context === "overview" || props.context === "usage");
const waitingLabel = computed((): I18nText => {
  if (props.signal === "metrics") return t("ingestion.firstDataPanel.waitingMetrics");
  if (props.signal === "traces") return t("ingestion.firstDataPanel.waitingTraces");
  if (props.signal === "logs") return t("ingestion.firstDataPanel.waitingLogs");
  return t("ingestion.firstDataPanel.waitingAny");
});

const arrivedTitle = computed((): I18nText => {
  const type = props.arrived?.streamType;
  if (type === "metrics") return t("ingestion.firstDataPanel.arrivedMetrics");
  if (type === "traces") return t("ingestion.firstDataPanel.arrivedTraces");
  return t("ingestion.firstDataPanel.arrivedLogs");
});
const arrivedSummary = computed((): I18nText => {
  const count = props.arrived?.count ?? 0;
  const params = {
    records: t("ingestion.firstEvent.records", { count: raw(count.toLocaleString()) }, count),
    stream: raw(props.arrived?.streamName ?? ""),
  };
  // a compact page does not re-query below the strip, so it offers Open instead of "loading them below"
  return props.variant === "compact"
    ? t("ingestion.firstDataPanel.arrivedSummaryShort", params)
    : t("ingestion.firstDataPanel.arrivedSummary", params);
});
const arrivedOpenLabel = computed((): I18nText => {
  const type = props.arrived?.streamType;
  if (type === "metrics") return t("ingestion.firstEvent.openInMetrics");
  if (type === "traces") return t("ingestion.firstEvent.openInTraces");
  return t("ingestion.firstEvent.openInLogs");
});

const status = ref<InstanceType<typeof FirstEventStatus> | null>(null);

const trackCopy = (partial: boolean) => {
  analytics.track("snippet_copied", { route: route?.name, partial });
  status.value?.start("copy");
};
const copyCommand = () => {
  const code = command.value?.code;
  if (!code) return;
  copyToClipboard(code, t, {
    successMessage: t("ingestion.firstDataPanel.copied"),
    errorMessage: t("common.copyContentError"),
  }).then((copied) => {
    if (copied) trackCopy(false);
  });
};
const openGuide = () => {
  const name = pick.value?.route;
  if (!name) return;
  router.push({ name, query: { org_identifier: org.value } }).catch(() => {});
};
const chooseSource = () => {
  router.push({ name: "recommended", query: { org_identifier: org.value } }).catch(() => {});
};
const onTokenClick = () => (openTokenPicker ? openTokenPicker() : openGuide());

// the watcher refreshed the detected type's stream list before it reported the arrival
const onDetected = (result: FirstEventResult) => {
  detectedHere.value = true;
  store.dispatch("setIsDataIngested", true);
  emit("detected", result);
};

const listFailed = computed(() => queriesFor().some(({ query }) => !!query.error.value));
// panel/card: the pick's full or compact card is drawn above the slot; status: only the no-pick status line is
const layout = computed<FirstDataLayout>(() => {
  if (props.variant === "compact" && flagOn.value && !props.arrived) {
    if (forbidden.value && store.state.organizationData?.isDataIngested !== true) {
      return "forbidden";
    }
    // a page that waits here never mounts its own data view, so it fires no request for an empty org
    if (
      store.state.organizationData?.isDataIngested === false &&
      !seenEmpty.value &&
      !listsLoaded.value &&
      !listFailed.value
    ) {
      return "pending";
    }
  }
  if (!active.value) return "none";
  if (!pickMatches.value) return "status";
  return props.variant === "full" ? "panel" : "card";
});
const StatusLine = defineComponent({
  name: "FirstDataStatusLine",
  setup: () => () =>
    h(
      "div",
      {
        class:
          props.variant === "full" || props.statusInSlot
            ? "flex justify-center"
            : "mb-3 flex w-full items-center px-0.5",
        "data-test": "first-data-panel",
        "data-signal": props.signal,
        "data-variant": props.variant,
        "data-pick": "none",
      },
      [
        h(FirstEventStatus, {
          org: org.value,
          signal: props.signal === "any" ? undefined : props.signal,
          display: "pill",
          waitingLabel: waitingLabel.value,
          onDetected,
        }),
      ],
    ),
});
</script>

<template>
  <OBanner
    v-if="arrived && flagOn"
    variant="success"
    dense
    inline-actions
    data-test="first-data-panel-arrived"
    :data-signal="arrived.streamType"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <OTag :label="arrivedTitle" variant="success" icon="check-circle" size="sm" />
      <span data-test="first-data-panel-arrived-summary">{{ arrivedSummary }}</span>
    </div>
    <template #actions>
      <OButton
        variant="ghost"
        size="sm-action"
        data-test="first-data-panel-arrived-dismiss-btn"
        @click="emit('dismiss')"
      >
        {{ t("common.close") }}
      </OButton>
      <OButton
        v-if="variant === 'compact'"
        variant="primary"
        size="sm-action"
        icon-left="open-in-new"
        data-test="first-data-panel-arrived-open-btn"
        @click="emit('open')"
      >
        {{ arrivedOpenLabel }}
      </OButton>
    </template>
  </OBanner>

  <template v-else-if="!arrived">
    <OEmptyState
      v-if="forbidden && variant === 'full'"
      size="hero"
      preset="no-access"
      data-test="first-data-panel-no-access"
    />
    <template v-else>
      <template v-if="active">
        <OCard
          v-if="variant === 'full' && pickMatches"
          variant="outlined"
          class="mx-auto mt-4 w-full max-w-180 gap-3 p-4"
          data-test="first-data-panel"
          :data-signal="signal"
          data-variant="full"
          :data-pick="pick?.id"
        >
          <div class="flex items-start gap-3">
            <img
              v-if="pick?.logo"
              :src="getImageURL(pick.logo)"
              alt=""
              class="mt-0.5 size-6 shrink-0"
              :class="{ 'dark:invert': pick.logoInvertDark }"
            />
            <OIcon v-else-if="pick?.icon" :name="pick.icon" size="md" class="mt-0.5 shrink-0" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong class="text-text-heading">{{ titleText }}</strong>
              <i18n-t :keypath="bodyKey" tag="span" class="text-text-secondary text-sm">
                <template #org
                  ><strong class="text-text-body">{{ raw(orgName) }}</strong></template
                >
                <template #source>{{ sourceLabel }}</template>
              </i18n-t>
            </div>
            <OButton
              v-if="pick?.route"
              variant="outline"
              size="sm-action"
              data-test="first-data-panel-open-guide-btn"
              @click="openGuide"
            >
              {{ t("ingestion.firstDataPanel.openFullGuide") }}
            </OButton>
          </div>
          <OCodeBlock
            v-if="command"
            :code="command.code"
            :code-masked="command.masked"
            :token-name="command.masked ? snippet.tokenName.value : undefined"
            :lang="command.lang"
            chrome="terminal"
            wrap
            inset
            copy-on-click
            data-test="first-data-panel-code-block"
            @copy="({ partial }) => trackCopy(partial)"
            @token-click="onTokenClick"
          />
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FirstEventStatus
              ref="status"
              :org="org"
              :signal="signal === 'any' ? undefined : signal"
              :guide-name="sourceLabel"
              display="pill"
              :waiting-label="waitingLabel"
              @detected="onDetected"
            />
            <OText v-if="command" variant="meta">{{
              t("ingestion.firstDataPanel.clickToCopy")
            }}</OText>
            <span class="flex-1" />
            <OButton
              variant="ghost-primary"
              size="sm-action"
              data-test="first-data-panel-change-source-link"
              @click="chooseSource"
            >
              {{ t("ingestion.firstDataPanel.changeSource") }}
            </OButton>
          </div>
        </OCard>

        <OCard
          v-else-if="variant === 'compact' && pickMatches"
          variant="outlined"
          class="mb-3 w-full flex-row! flex-wrap items-center gap-3 px-4 py-3"
          :class="{ 'mt-2.5': onHome }"
          data-test="first-data-panel"
          :data-signal="signal"
          data-variant="compact"
          :data-pick="pick?.id"
        >
          <img
            v-if="pick?.logo"
            :src="getImageURL(pick.logo)"
            alt=""
            class="size-6 shrink-0"
            :class="{ 'dark:invert': pick.logoInvertDark }"
          />
          <OIcon v-else-if="pick?.icon" :name="pick.icon" size="md" class="shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong class="text-text-heading">{{
              t("ingestion.firstDataPanel.compactTitle", { org: raw(orgName) })
            }}</strong>
            <span class="text-text-secondary text-sm" data-test="first-data-panel-compact-text">
              <span :class="{ 'me-1': command }">{{ compactText }}</span>
              <span v-if="command">{{ t("ingestion.firstDataPanel.compactCommand") }}</span>
            </span>
          </div>
          <FirstEventStatus
            ref="status"
            :org="org"
            :guide-name="sourceLabel"
            display="pill"
            :waiting-label="waitingLabel"
            @detected="onDetected"
          />
          <OButton
            v-if="command"
            variant="outline"
            size="sm-action"
            icon-left="content-copy"
            data-test="first-data-panel-copy-btn"
            @click="copyCommand"
          >
            {{ t("ingestion.firstDataPanel.copyCommand") }}
          </OButton>
          <OButton
            v-if="pick?.route"
            variant="outline"
            size="sm-action"
            data-test="first-data-panel-open-guide-btn"
            @click="openGuide"
          >
            {{ t("ingestion.firstDataPanel.openGuide") }}
          </OButton>
        </OCard>

        <StatusLine v-else-if="!statusInSlot" :class="{ 'mt-4': variant === 'full' }" />
      </template>
      <slot :layout="layout" :status-line="StatusLine" />
    </template>
  </template>
</template>
