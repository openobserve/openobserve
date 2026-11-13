<template>
  <section
    class="rounded-surface overflow-hidden border"
    :class="borderClass"
    data-test="svcver-panel-card"
  >
    <header class="border-border-default flex flex-col gap-1.5 border-b px-4 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <VersionCompareTitle :service="service" :title="title" test-id="svcver-card-title" />
        <ServiceEnvChip v-if="identity" :identity="identity" :service="service" />
        <ServiceScopeChip facet="where" :where-key="where" :value="whereLabel" />
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <OTooltip :content="t('serviceVersions.actions.shareWaiting')" :disabled="!!result"
          ><OButton
            variant="outline"
            size="sm"
            icon-left="link"
            :disabled="!result"
            data-test="svcver-panel-share"
            @click="share"
            >{{ t("serviceVersions.actions.share") }}</OButton
          ></OTooltip
        >
        <OButton
          v-if="result?.stored_verdict && !restricted"
          variant="outline"
          size="sm"
          :disabled="pending"
          data-test="svcver-panel-incident"
          @click="incident"
          >{{ t("serviceVersions.actions.openIncident") }}</OButton
        >
      </div>
      <p
        v-if="message"
        class="text-text-secondary text-xs"
        data-test="svcver-panel-incident-message"
      >
        {{ message }}
      </p>
    </header>
    <div class="px-4 py-3">
      <NoVerdictNotice
        v-if="missing"
        :reason="missing"
        :context="missingContext"
        :data-test="
          missing === 'pre_existing' ? 'svcver-card-pre-existing' : 'svcver-card-no-verdict'
        "
      />
      <OSkeleton v-else-if="query.isPending.value" class="h-24" data-test="svcver-card-loading" />
      <p v-else-if="denied" class="text-text-secondary text-sm" data-test="svcver-card-denied">
        {{ t("serviceVersions.compare.denied") }}
      </p>
      <div
        v-else-if="query.isError.value"
        class="flex items-center gap-2 text-sm"
        data-test="svcver-card-error"
      >
        <span>{{ t("serviceVersions.compare.error") }}</span>
        <OButton
          variant="outline"
          size="sm"
          data-test="svcver-card-retry"
          @click="query.refetch()"
          >{{ t("serviceVersions.actions.retry") }}</OButton
        >
      </div>
      <div v-if="result && !denied && !missing" class="flex flex-col gap-2">
        <VersionVerdictBanner :result="result" :last-good="lastGood" />
        <VersionSummaryTiles
          v-if="!restricted && !notServing"
          v-model:signal="signal"
          :result="result"
        />
        <div
          v-if="sectionError && !query.isError.value"
          class="flex items-center gap-2 text-sm"
          data-test="svcver-card-error"
        >
          <span>{{ t("serviceVersions.compare.error") }}</span>
          <OButton
            variant="outline"
            size="sm"
            data-test="svcver-card-retry"
            @click="query.refetch()"
            >{{ t("serviceVersions.actions.retry") }}</OButton
          >
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <template v-if="!restricted && newError">
            <OTag
              :variant="newErrorEarly ? 'default-outline' : 'error-soft'"
              :label="t('serviceVersions.panel.newError')"
              data-test="svcver-card-new-error-tag"
            />
            <span
              class="text-text-body max-w-104 truncate font-mono"
              data-test="svcver-card-new-error"
              >{{ newError.error_message || newError.error_type || newError.fingerprint }}</span
            >
            <span class="text-text-secondary text-xs" data-test="svcver-card-new-error-counts">{{
              t("serviceVersions.panel.errorCounts", {
                b: formatCount(newErrorCounts.before),
                a: formatCount(newErrorCounts.after),
              })
            }}</span>
            <OButton
              v-if="sessionsLink"
              variant="ghost"
              size="sm"
              data-test="svcver-card-sessions"
              @click="router.push(sessionsLink)"
              >{{ t("serviceVersions.evidence.sessions") }}</OButton
            >
          </template>
          <span class="flex-1" />
          <OButton
            variant="outline"
            size="sm"
            data-test="svcver-panel-open-compare"
            @click="open"
            >{{ t("serviceVersions.panel.seeWhatChanged") }}</OButton
          >
        </div>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import type { Environment, Signal, Tracking, Version } from "@/services/service_versions";
import {
  baselineSource,
  compareTitle,
  imageShort,
  trackingNotStarted,
  type BaselineMark,
} from "@/utils/serviceVersionsCopy";
import { copyToClipboard } from "@/utils/clipboard";
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import serviceVersions from "@/services/service_versions";
import { compareQuery, compareRequest } from "@/services/service_versions.queries";
import {
  useVersionCompareDrawer,
  withoutKeys,
  compareKeys,
  panelKeys,
} from "@/enterprise/composables/useVersionCompareDrawer";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import NoVerdictNotice from "./NoVerdictNotice.vue";
import VersionCompareTitle from "./VersionCompareTitle.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import VersionVerdictBanner from "./VersionVerdictBanner.vue";
import VersionSummaryTiles from "./VersionSummaryTiles.vue";
import { useLastGood } from "./useLastGood";
import {
  leadingVerdict,
  noVerdict,
  verdictCode,
  verdictSentence,
  type NoVerdictContext,
} from "./verdictText";
import { rumEvidence } from "./deepLinks";
import { errorCounts, rumEarly } from "./errorTypes";
import { formatCount, sectionFailed } from "./VersionSummaryTiles.format";
const props = defineProps<{
  org: string;
  user: string;
  service: string;
  where: string;
  whereLabel?: string;
  identity?: Environment & Pick<Version, "tracking_started" | "image" | "version_images">;
  version: string;
  deployKey?: string;
  preExisting?: boolean;
  tracking?: Tracking | null;
}>();
const emit = defineEmits<{ baseline: [baseline: BaselineMark | undefined] }>();
const { t } = useI18nTyped();
const drawer = useVersionCompareDrawer();
const router = useRouter();
const scopeStarted = computed(() => props.identity?.tracking_started);
const skipped = computed(
  () => props.preExisting || trackingNotStarted(props.tracking, scopeStarted.value),
);
const query = useQuery(
  computed(() => ({
    ...compareQuery(
      props.org,
      props.user,
      compareRequest({
        service: props.service,
        where: props.where,
        version: props.version,
        image: props.identity?.image || undefined,
        deployKey: props.deployKey,
      }),
    ),
    // A version running before tracking started, or before tracking exists at all, has no verdict to compare.
    enabled: Boolean(props.org && props.where && props.version && !skipped.value),
  })),
);
const result = computed(() => query.data.value);
const lastGood = useLastGood(() => ({
  org: props.org,
  user: props.user,
  service: props.service,
  where: props.where,
  current: result.value?.arms.a,
}));
// The panel marks this exact build, so a sibling build of the same version text never reads as the baseline.
const baselineMark = computed<BaselineMark | undefined>(() => {
  const current = result.value;
  const version = current?.arms.b.version;
  if (!current || !version) return undefined;
  const image = current.arms.b.image || null;
  return {
    version,
    image,
    source: baselineSource(current.baseline_rule, { version, image }, lastGood.value),
  };
});
watch(baselineMark, (value) => emit("baseline", value), { immediate: true });
const denied = computed(
  () => (query.error.value as { response?: { status?: number } })?.response?.status === 403,
);
const restricted = computed(
  () => result.value?.stored_verdict?.restricted || result.value?.live_verdict?.restricted,
);
const leading = computed(() => (result.value ? leadingVerdict(result.value) : undefined));
const code = computed(() => (leading.value ? verdictCode(leading.value) : undefined));
const notServing = computed(() => code.value === "not_serving");
const missingContext = computed<NoVerdictContext>(() => ({
  tracking: props.tracking,
  scopeStarted: scopeStarted.value,
  deployKind: props.preExisting ? "pre_existing" : undefined,
}));
const missing = computed(() =>
  props.preExisting && !trackingNotStarted(props.tracking, scopeStarted.value)
    ? "pre_existing"
    : noVerdict(result.value, missingContext.value),
);
const title = computed(() =>
  compareTitle(
    {
      compared: result.value?.arms.a.version || props.version,
      baseline: missing.value ? undefined : result.value?.arms.b.version,
      kind: leading.value?.deploy?.kind,
      notServing: notServing.value,
      comparedImage: imageShort(
        result.value?.arms.a.image ?? props.identity?.image,
        leading.value?.version_images ?? props.identity?.version_images,
      ),
      baselineImage: missing.value
        ? ""
        : imageShort(result.value?.arms.b.image, leading.value?.baseline?.version_images),
    },
    t,
  ),
);
const borderClass = computed(() =>
  code.value === "regressed" || code.value === "not_serving"
    ? "border-banner-error-soft-border"
    : code.value === "watch" || code.value === "rollback_still_worse"
      ? "border-banner-warning-border"
      : "border-border-default",
);
const newError = computed(() =>
  result.value?.rum?.error_detail?.status === "insufficient"
    ? undefined
    : result.value?.rum?.error_types?.introduced?.[0],
);
const newErrorCounts = computed(() =>
  newError.value ? errorCounts("introduced", newError.value) : { before: 0, after: 0 },
);
const newErrorEarly = computed(() => !result.value || rumEarly(result.value));
const sessionsLink = computed(() =>
  result.value && newError.value
    ? rumEvidence(props.org, props.service, result.value.arms.a, newError.value)
    : undefined,
);
const signal = ref<Signal>("traces");
// A section that timed out or failed measured nothing, so the card offers the same retry as a failed read.
const sectionError = computed(() => sectionFailed(result.value?.[signal.value]));
const pending = ref(false),
  message = ref("");
let generation = 0;
watch(
  () => [props.org, props.user, props.service, props.where, props.version, props.deployKey],
  () => {
    generation++;
    pending.value = false;
    message.value = "";
  },
);
function link() {
  return new URL(
    router.resolve({
      query: {
        ...withoutKeys(router.currentRoute.value.query, [...compareKeys, ...panelKeys]),
        cmp: props.version,
        cmpSvc: props.service,
        cmpWhere: props.where,
        ...(props.deployKey ? { cmpDeploy: props.deployKey } : {}),
      },
    }).href,
    window.location.href,
  ).href;
}
function open() {
  void drawer.open({
    service: props.service,
    where: props.where,
    a: props.version,
    aImage: props.identity?.image || undefined,
    deployKey: props.deployKey,
    fromPanel: true,
  });
}
function share() {
  const verdict = result.value && leadingVerdict(result.value);
  void copyToClipboard(`${verdict ? verdictSentence(verdict, t) : ""}\n${link()}`, t);
}
async function incident() {
  const verdict = result.value?.stored_verdict,
    current = result.value;
  if (!verdict || !current || restricted.value || pending.value) return;
  const request = ++generation;
  pending.value = true;
  try {
    const response = await serviceVersions.openIncident(props.org, {
      title: verdictSentence(verdict, t),
      severity: "P2",
      service: props.service,
      where_key: props.where,
      env: current.env,
      version: current.arms.a.version,
      baseline_version: current.arms.b.version,
      verdict_key: verdict.verdict_key,
      summary: verdictSentence(verdict, t),
      link: link(),
    });
    if (request === generation)
      message.value = t(
        response.data.created
          ? "serviceVersions.incident.created"
          : "serviceVersions.incident.attached",
      );
  } catch {
    if (request === generation) message.value = t("serviceVersions.incident.failed");
  } finally {
    if (request === generation) pending.value = false;
  }
}
</script>
