<template>
  <ODrawer
    :open="drawer.isOpen.value"
    :width="drawerWidth"
    :modal="false"
    seamless
    bleed
    :show-close="false"
    :title="raw(accessibleTitle)"
    @update:open="(value) => !value && drawer.close()"
    data-test="svcver-drawer"
  >
    <template #header
      ><div
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="t('serviceVersions.actions.resize')"
        :aria-valuemin="30"
        :aria-valuemax="Math.round(maxRem)"
        :aria-valuenow="Math.round(width)"
        class="bg-border-strong focus-visible:ring-accent absolute start-0 top-1/2 z-10 h-10 w-1.5 -translate-y-1/2 cursor-col-resize rounded-full focus-visible:ring-2 focus-visible:outline-none"
        data-test="svcver-resize"
        @pointerdown="startResize"
        @keydown="resizeByKey"
      />
      <div class="flex min-w-0 flex-col gap-1.5">
        <OButton
          v-if="state.fromPanel"
          class="self-start"
          variant="ghost"
          size="sm"
          icon-left="arrow-back"
          data-test="svcver-back"
          @click="drawer.backToService()"
          >{{ t("serviceVersions.actions.backToService", { service: state.service }) }}</OButton
        >
        <div class="flex items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <VersionCompareTitle :service="state.service" :title="title" /><ServiceEnvChip
              v-if="identity"
              :identity="identity"
              :service="state.service"
            /><ServiceScopeChip
              v-if="showWhere"
              facet="where"
              :where-key="state.where"
              data-test="svcver-where-chip"
            /><OTooltip v-if="baselineFrom" :content="baselineFromTip"
              ><span class="inline-flex" data-test="svcver-baseline-from"
                ><ServiceScopeChip
                  facet="where"
                  :label="t('serviceVersions.compare.baselineFromChip')"
                  :value="baselineFrom" /></span></OTooltip
            ><span
              v-if="rollbackFrom"
              class="text-text-secondary text-2xs"
              data-test="svcver-rollback"
              >{{ t("serviceVersions.compare.rolledBackFrom", { version: rollbackFrom }) }}</span
            ><span v-if="identity?.as_name" class="text-text-secondary text-2xs">{{
              t("serviceVersions.compare.detectedAs", { name: identity.as_name })
            }}</span>
          </div>
          <OButton
            variant="ghost"
            size="icon"
            icon-left="close"
            data-test="svcver-close"
            :aria-label="t('serviceVersions.actions.close')"
            @click="drawer.close()"
          />
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <OButton
            variant="outline"
            size="sm"
            icon-left="share"
            data-test="svcver-share"
            @click="copy(true)"
            >{{ t("serviceVersions.actions.share") }}</OButton
          ><OButton
            variant="outline"
            size="sm"
            icon-left="link"
            data-test="svcver-copy-link"
            @click="copy(false)"
            >{{ t("serviceVersions.actions.copyLink") }}</OButton
          ><OTooltip :content="incidentBlocked ?? raw('')" :disabled="!incidentBlocked"
            ><span
              class="inline-flex"
              :tabindex="incidentBlocked ? 0 : undefined"
              data-test="svcver-open-incident-reason"
              ><OButton
                variant="outline"
                size="sm"
                data-test="svcver-open-incident"
                :disabled="Boolean(incidentBlocked)"
                :loading="incidentPending"
                @click="incident"
                >{{ t("serviceVersions.actions.openIncident") }}</OButton
              ></span
            ></OTooltip
          ><OButton
            v-if="!rumOnly"
            variant="ghost"
            size="sm"
            icon-left="account-tree"
            data-test="svcver-open-service"
            @click="drawer.openService()"
            >{{ t("serviceVersions.actions.openService") }}</OButton
          ><OButton
            variant="ghost"
            size="icon"
            :icon-left="state.pinned ? 'keep' : 'keep-outline'"
            data-test="svcver-pin"
            :aria-pressed="state.pinned"
            :aria-label="
              t(state.pinned ? 'serviceVersions.actions.unpin' : 'serviceVersions.actions.pin')
            "
            @click="drawer.update({ cmpPin: state.pinned ? undefined : '1' })"
          />
        </div>
        <p
          v-if="incidentMessage"
          role="status"
          class="text-text-secondary text-xs"
          data-test="svcver-incident-status"
        >
          {{ incidentMessage }}
        </p>
      </div></template
    >
    <div class="flex flex-col gap-3 px-4 pt-3 pb-4">
      <p
        v-if="identity?.where?.kind === 'k8s' && !identity.where.k8s_cluster"
        class="text-text-secondary text-xs"
        data-test="svcver-no-cluster"
      >
        {{ t("serviceVersions.env.noCluster") }}
      </p>
      <OSelect
        v-if="!state.where"
        :model-value="state.where"
        :label="t('serviceVersions.catalog.where')"
        data-test="svcver-where"
        @update:model-value="
          (value) => drawer.update({ cmpWhere: String(value), cmpEnv: undefined })
        "
        ><OSelectItem
          v-for="scope in (scopes.data.value?.services || []).filter(
            (scope) =>
              scope.service === state.service &&
              (!state.legacyEnv || inEnv(scope, state.legacyEnv)),
          )"
          :key="scope.scope_key"
          :value="scope.where_key"
          :label="raw(whereText(scope.where_key, scope.where, t))"
          :data-test="`svcver-where-option-${scope.where_key}`"
          ><OTruncatedText
            v-if="isOutsideK8s(scope.where_key, scope.where)"
            class="text-text-secondary block flex-1"
            >{{ whereText(scope.where_key, scope.where, t) }}</OTruncatedText
          ></OSelectItem
        ></OSelect
      >
      <section
        v-if="versions.isError.value || scopes.isError.value"
        class="flex items-center gap-2"
        data-test="svcver-identity-error"
      >
        <p class="text-text-body text-compact">{{ t("serviceVersions.compare.error") }}</p>
        <OButton
          variant="outline"
          size="sm"
          data-test="svcver-identity-retry"
          @click="
            versions.refetch();
            scopes.refetch();
          "
          >{{ t("serviceVersions.actions.retry") }}</OButton
        >
      </section>
      <p
        v-if="state.ambiguous"
        class="text-text-secondary text-compact"
        data-test="svcver-ambiguous"
      >
        {{ t("serviceVersions.compare.ambiguous") }}
      </p>
      <OSelect
        v-if="state.ambiguous"
        :model-value="state.a"
        :label="t('serviceVersions.compare.pickVersion')"
        searchable
        data-test="svcver-pick-version"
        @update:model-value="(value) => drawer.update({ cmp: String(value) })"
        ><OSelectItem
          v-for="row in versionedRows"
          :key="row.version_key"
          :value="row.version"
          :label="raw(row.version)"
          :data-test="`svcver-version-option-${row.version_key}`"
      /></OSelect>
      <OSkeleton
        v-if="comparison.isPending.value && enabled"
        class="h-32 w-full"
        data-test="svcver-loading"
      />
      <section
        v-if="comparison.isError.value && denied"
        class="flex flex-wrap items-center gap-2"
        data-test="svcver-denied"
      >
        <p class="text-text-body text-compact">{{ t("serviceVersions.compare.denied") }}</p>
        <OButton
          variant="outline"
          size="sm"
          data-test="svcver-retry"
          @click="comparison.refetch()"
          >{{ t("serviceVersions.actions.retry") }}</OButton
        >
      </section>
      <template v-else-if="comparison.isError.value"
        ><section
          v-if="stored && !result"
          class="flex flex-col gap-1"
          data-test="svcver-stored-verdict"
        >
          <div class="flex flex-wrap items-center gap-2">
            <VerdictChip :verdict="stored" :clickable="false" />
            <span
              class="text-text-heading text-sm font-semibold"
              data-test="svcver-stored-sentence"
              >{{ verdictSentence(stored, t) }}</span
            >
          </div>
          <p v-if="storedAt" class="text-text-body text-compact" data-test="svcver-stored-at">
            {{ t("serviceVersions.compare.storedFrom", { time: formatStamp(storedAt) }) }}
          </p>
          <p
            v-if="storedWindows.line"
            class="text-text-secondary text-xs"
            data-test="svcver-stored-windows"
          >
            {{ storedWindows.line }}
          </p>
        </section>
        <ErrorPanel data-test="svcver-error"
          >{{
            storedWindows.window
              ? t("serviceVersions.compare.detailsFailed", { window: storedWindows.window })
              : t("serviceVersions.compare.detailsFailedBare")
          }}
          <template #actions
            ><OButton
              variant="outline"
              size="xs"
              data-test="svcver-retry"
              @click="comparison.refetch()"
              >{{ t("serviceVersions.actions.retry") }}</OButton
            ><OButton
              variant="ghost-primary"
              size="xs"
              data-test="svcver-shorter-window"
              @click="maxSpan = 3600"
              >{{ t("serviceVersions.actions.shorterWindow") }}</OButton
            ></template
          ></ErrorPanel
        ></template
      >
      <p
        v-if="!enabled && !state.ambiguous"
        class="text-text-secondary text-compact"
        data-test="svcver-empty"
      >
        {{ t("serviceVersions.compare.empty") }}
      </p>
      <template v-if="result"
        ><NoVerdictNotice
          v-if="missing"
          :reason="missing"
          :context="missingContext"
        /><VersionVerdictBanner v-else :result="result" :last-good="lastGood" />
        <p v-if="restricted" class="text-text-secondary text-compact" data-test="svcver-restricted">
          {{ t("serviceVersions.compare.restricted") }}
        </p>
        <p
          v-for="(note, index) in notes"
          :key="note"
          :data-test="`svcver-note-${index}`"
          class="text-text-secondary text-xs"
        >
          {{ t(note) }}
        </p>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary text-xs whitespace-nowrap">{{
            t("serviceVersions.compare.baseline")
          }}</span>
          <OSelect
            class="flex-1"
            :model-value="baselineValue"
            searchable
            :search-placeholder="t('serviceVersions.compare.searchVersions')"
            :aria-label="t('serviceVersions.compare.baseline')"
            data-test="svcver-baseline"
            @update:model-value="baseline"
            @search="(term: string) => (baselineSearch = term)"
            ><OSelectItem
              v-for="rule in ['auto', 'canary', 'previous'] as const"
              :key="rule"
              :value="rule"
              :label="
                rule !== 'auto'
                  ? t(`serviceVersions.compare.${rule}`)
                  : picked
                    ? t('serviceVersions.compare.auto')
                    : raw(autoLabel)
              "
              :data-test="`svcver-baseline-option-${rule}`" /><OSelectItem
              v-for="row in shownBaselineRows.rows"
              :key="row.version_key"
              :value="row.version_key"
              :label="
                isPickedBaseline(row)
                  ? raw(autoLabel)
                  : raw(versionImageLabel(row.version, row.image, row.version_images, t))
              "
              :data-test="`svcver-baseline-option-${row.version_key}`"
              ><OTruncatedText v-if="!isPickedBaseline(row)" class="block flex-1"
                ><ServiceVersionLabel
                  :version="row.version"
                  :image="row.image"
                  :version-images="row.version_images" /></OTruncatedText></OSelectItem
            ><OSelectItem
              v-for="more in shownBaselineRows.more"
              :key="`more-${more.version}`"
              :value="`more-${more.version}`"
              disabled
              :label="
                t(
                  'serviceVersions.image.moreImages',
                  { count: more.count, version: more.version },
                  more.count,
                )
              "
              data-test="svcver-baseline-more"
          /></OSelect>
        </div>
        <InfoNotice v-if="canaryFallback" data-test="svcver-canary-fallback">{{
          canaryFallback
        }}</InfoNotice>
        <div
          v-if="notServing && !restricted && servingRequests"
          class="rounded-surface border-border-default bg-surface-panel flex flex-col gap-0.5 border px-2.5 py-2"
          data-test="svcver-not-serving-requests"
        >
          <span class="text-text-secondary text-2xs">{{
            t("serviceVersions.compare.notServingRequests", {
              window: formatWindow(
                result.arms.a.start_time,
                result.arms.a.end_time,
                t,
                legendSeconds,
              ),
            })
          }}</span>
          <span class="text-text-heading flex flex-wrap items-center gap-3 text-xs font-semibold"
            ><span
              ><span class="bg-ai-accent me-1 inline-block size-2 rounded-xs align-middle" />{{
                t("serviceVersions.compare.requestsOf", {
                  count: formatCount(servingRequests.a),
                  version: result.arms.a.version,
                })
              }}</span
            ><span class="text-text-muted">·</span
            ><span
              ><span class="bg-accent me-1 inline-block size-2 rounded-xs align-middle" />{{
                t("serviceVersions.compare.requestsOf", {
                  count: formatCount(servingRequests.b),
                  version: result.arms.b.version,
                })
              }}</span
            ></span
          >
          <span v-if="servingRequests.a === 0" class="text-text-secondary text-2xs">{{
            t("serviceVersions.compare.notServingNote", { version: result.arms.a.version })
          }}</span>
        </div>
        <VersionSummaryTiles
          v-else-if="!restricted && !noEvidence && !notServing"
          v-model:signal="selectedSignal"
          v-model:metric="chartMetric"
          :result="result"
          :rum-absent="rumAbsent"
          selectable
        />
        <RumVersionChart
          v-if="rumShown && selectedSignal === 'rum' && result.rum_series"
          :result="result"
          :metric="rumChartMetric"
          @retry="comparison.refetch()"
        />
        <RumDrillSections
          v-if="rumShown && hasDrill"
          :org="org"
          :result="result"
          :metric="chartMetric"
        />
        <div v-if="sectionError" class="flex items-center gap-2" data-test="svcver-section-error">
          <p class="text-text-body text-compact">{{ t("serviceVersions.compare.error") }}</p>
          <OButton
            variant="outline"
            size="sm"
            data-test="svcver-section-retry"
            @click="comparison.refetch()"
            >{{ t("serviceVersions.actions.retry") }}</OButton
          >
        </div>
        <section
          v-if="!restricted && selectedSignal === 'traces' && result.traces && !sectionError"
          class="rounded-surface border-border-default bg-surface-panel flex flex-col gap-1 border px-3 py-2.5"
          data-test="svcver-overlay"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span
              class="text-text-heading text-compact font-semibold"
              data-test="svcver-overlay-title"
              >{{
                notServing
                  ? t("serviceVersions.compare.requestsByVersion")
                  : t(`serviceVersions.compare.tile.${overlayMetric}`)
              }}</span
            ><span
              v-if="!notServing"
              class="text-text-secondary text-xs"
              data-test="svcver-overlay-hint"
              >{{
                t(
                  !hasBaseline(result)
                    ? "serviceVersions.compare.chartHintFirst"
                    : result.traces.insufficient
                      ? "serviceVersions.compare.chartHintEarly"
                      : "serviceVersions.compare.chartHint",
                )
              }}</span
            ><span
              class="text-text-secondary ms-auto flex flex-wrap gap-3 text-xs"
              data-test="svcver-overlay-legend"
              ><span v-if="hasBaseline(result)" data-test="svcver-overlay-legend-before"
                ><span
                  class="border-accent me-1 inline-block w-3.5 border-t-2 border-dashed align-middle"
                />{{ t("serviceVersions.compare.before", { version: armLabels.b }) }}
                {{
                  formatWindow(result.arms.b.start_time, result.arms.b.end_time, t, legendSeconds)
                }}</span
              ><span
                ><span class="border-ai-accent me-1 inline-block w-3.5 border-t-2 align-middle" />{{
                  t("serviceVersions.compare.after", { version: armLabels.a })
                }}
                {{
                  formatWindow(result.arms.a.start_time, result.arms.a.end_time, t, legendSeconds)
                }}</span
              ></span
            >
          </div>
          <OSkeleton
            v-if="overlay.isPending.value && overlay.isFetching.value"
            data-test="svcver-overlay-loading"
            class="h-40 w-full"
          />
          <div
            v-else-if="overlay.isError.value"
            class="flex items-center gap-2"
            data-test="svcver-overlay-error"
          >
            <p class="text-text-body text-compact">{{ t("serviceVersions.compare.error") }}</p>
            <OButton
              variant="outline"
              size="sm"
              data-test="svcver-overlay-retry"
              @click="overlay.refetch()"
              >{{ t("serviceVersions.actions.retry") }}</OButton
            >
          </div>
          <p
            v-else-if="
              overlay.data.value && !overlay.data.value.a.length && !overlay.data.value.b.length
            "
            class="text-text-secondary text-compact"
            data-test="svcver-overlay-empty"
          >
            {{ t("serviceVersions.compare.empty") }}
          </p>
          <VersionOverlayChart
            v-else-if="overlay.data.value"
            :series-a="overlaySeriesA"
            :series-b="hasBaseline(result) ? overlay.data.value.b : []"
            mode="sameWallClock"
            :version-a="armLabels.a"
            :version-b="armLabels.b"
            :service-metric="overlayMetric"
            :format-y="formatOverlayY"
            :marker="deployMarker"
            :range="overlayRange(result)"
            service-versions
          />
        </section>
        <VersionNotServingPods
          v-if="notServing && !restricted && pods.pods.length"
          :org="org"
          :result="result"
          :pods="pods.pods"
          :total="pods.total"
        />
        <div v-if="!notServing && !noEvidence && !sectionError">
          <OTabs v-model="tab" bordered dense data-test="svcver-tabs"
            ><OTab
              name="what-changed"
              :label="t('serviceVersions.compare.whatChanged')"
              data-test="svcver-tab-what-changed" /><OTab
              v-if="rumOnly"
              name="all-pages"
              :label="t('serviceVersions.compare.drill.pages.tab')"
              data-test="svcver-tab-all-pages" /><OTab
              v-else
              name="all-endpoints"
              :label="t('serviceVersions.compare.allEndpoints')"
              data-test="svcver-tab-all-endpoints"
          /></OTabs>
          <VersionWhatChanged
            class="pt-2"
            :org="org"
            :result="result"
            :all="tab === 'all-endpoints' || tab === 'all-pages'"
          />
          <RumDrillSections
            v-if="
              !restricted && !rumAbsent && result.pages && (rumOnly || selectedSignal === 'rum')
            "
            class="pt-2"
            :org="org"
            :result="result"
            pages
            :all="tab === 'all-pages'"
          />
        </div>
      </template></div
  ></ODrawer>
</template>
<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useStore } from "vuex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { isAxiosError } from "axios";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import InfoNotice from "@/components/shared/InfoNotice.vue";
import ErrorPanel from "@/components/shared/ErrorPanel.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import ServiceVersionLabel from "@/components/shared/ServiceVersionLabel.vue";
import VerdictChip from "./VerdictChip.vue";
import VersionVerdictBanner from "./VersionVerdictBanner.vue";
import NoVerdictNotice from "./NoVerdictNotice.vue";
import VersionCompareTitle from "./VersionCompareTitle.vue";
import VersionWhatChanged from "./VersionWhatChanged.vue";
import RumDrillSections from "./RumDrillSections.vue";
import RumVersionChart from "./RumVersionChart.vue";
import VersionNotServingPods from "./VersionNotServingPods.vue";
import { notServingPods } from "./podLinks";
import VersionSummaryTiles from "./VersionSummaryTiles.vue";
import VersionOverlayChart from "../AIObservability/VersionOverlayChart.vue";
import {
  compareArmLabels,
  leadingVerdict,
  noVerdict,
  noVerdictBaselineRule,
  noVerdictSentence,
  noteKeys,
  verdictCode,
  verdictSentence,
  type NoVerdictContext,
} from "./verdictText";
import {
  FLOORS,
  formatCount,
  formatMetric,
  formatSpan,
  formatStamp,
  formatWindow,
  hasBaseline,
  sectionFailed,
  shortWindow,
  type TileMetric,
} from "./VersionSummaryTiles.format";
import { useLastGood } from "./useLastGood";
import {
  buildLabel,
  compareTitle,
  compareTitleText,
  imageShort,
  isOutsideK8s,
  versionImageLabel,
  whereText,
} from "@/utils/serviceVersionsCopy";
import { BASELINE_IMAGES_SHOWN, capImageRows } from "./versionImages";
import { copyToClipboard } from "@/utils/clipboard";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import {
  versionsQuery,
  verdictsQuery,
  deployVerdictQuery,
  servicesQuery,
  compareQuery,
  compareRequest,
} from "@/services/service_versions.queries";
import { readCompareOverlay, overlayRange, overlayStep } from "@/services/service_versions.overlay";
import { serviceVersionKeys } from "@/services/service_versions.querykeys";
import { inEnv, scopesInEnv } from "@/services/service_versions.envs";
import serviceVersions, {
  type Signal,
  type Version,
  type CompareRequest,
  type RumSeriesMetric,
} from "@/services/service_versions";
type OverlayMetric = "requests" | "error_rate" | "p95" | "p99";
const { t } = useI18nTyped();
const store = useStore();
const client = useQueryClient();
const org = computed(() => store.state.selectedOrganization?.identifier || "");
const user = computed(() => store.state.userInfo?.email || "");
// The arms parse against the version list, whose query in turn reads the arms' service.
const knownVersions = ref<string[]>([]);
const drawer = useVersionCompareDrawer(() => knownVersions.value);
const state = drawer.state;
const versions = useQuery(
  computed(() => ({
    ...versionsQuery(org.value, user.value, {
      service: state.value.service,
      where: state.value.where || undefined,
      include_inactive: true,
      limit: 10000,
    }),
    enabled: Boolean(org.value && user.value && state.value.service),
  })),
);
watch(
  () => versions.data.value?.versions,
  (rows) => {
    knownVersions.value = rows?.map((row) => row.version) || [];
  },
  { immediate: true },
);
const scopes = useQuery(
  computed(() => ({
    ...servicesQuery(org.value, user.value, { q: state.value.service }),
    enabled: Boolean(org.value && user.value && state.value.service && !state.value.where),
  })),
);
watch(
  () => scopes.data.value,
  (data) => {
    if (!state.value.legacyEnv || state.value.where || !data) return;
    const matches = scopesInEnv(
      data.services.filter((row) => row.service === state.value.service),
      state.value.legacyEnv,
    );
    if (matches.length === 1)
      void drawer.update({ cmpWhere: matches[0].where_key, cmpEnv: undefined });
  },
);
const maxSpan = ref(86400);
const enabled = computed(() =>
  Boolean(org.value && user.value && state.value.service && state.value.where && state.value.a),
);
const body = computed<CompareRequest>(() =>
  compareRequest({
    service: state.value.service,
    where: state.value.where,
    version: state.value.a,
    image: state.value.aImage || undefined,
    deployKey: state.value.deployKey,
    baselineVersion: state.value.b,
    baselineImage: state.value.bImage || undefined,
    baseline:
      state.value.baseline === "canary" || state.value.baseline === "previous"
        ? state.value.baseline
        : "auto",
    maxSpanSecs: maxSpan.value,
  }),
);
const comparison = useQuery(
  computed(() => ({ ...compareQuery(org.value, user.value, body.value), enabled: enabled.value })),
);
const denied = computed(
  () =>
    isAxiosError(comparison.error.value) &&
    [403, 404].includes(comparison.error.value.response?.status ?? 0),
);
const identity = computed(() =>
  versions.data.value?.versions.find(
    (row) =>
      row.version === state.value.a && (!state.value.aImage || row.image === state.value.aImage),
  ),
);
// How many images a version text has here, from the versions list, else from the verdict that names it.
function imagesOf(version: string, fallback?: number) {
  const counts = (versions.data.value?.versions || [])
    .filter((row) => row.version === version)
    .map((row) => row.version_images ?? 0);
  return counts.length ? Math.max(...counts) : fallback;
}
// A RUM-only service has no trace panel to open and no endpoints, so the drawer speaks in pages.
const rumOnly = computed(() => {
  const value = comparison.data.value;
  if (!value?.rum) return false;
  if (!value.traces) return true;
  // The drawer always asks for traces, so a RUM app still gets an empty traces section back.
  if (identity.value) return !identity.value.signals?.traces;
  return value.traces.requests?.a === 0 && value.traces.requests?.b === 0;
});
// Children decide traces vs RUM from the section's presence, so a RUM app's empty traces section is dropped.
const result = computed(() => {
  const value = comparison.data.value;
  return value && rumOnly.value ? { ...value, traces: undefined } : value;
});
const leading = computed(() => (result.value ? leadingVerdict(result.value) : undefined));
const armLabels = computed(() =>
  result.value ? compareArmLabels(result.value, t) : { a: "", b: "" },
);
// The deploy the drawer was opened on, else the newest one into this version.
const openedDeploy = computed(() => {
  const deploys = identity.value?.deploys || [];
  return state.value.deployKey
    ? deploys.find((row) => row.deploy_key === state.value.deployKey)
    : deploys[0];
});
const missingContext = computed<NoVerdictContext>(() => ({
  tracking: versions.data.value?.tracking,
  scopeStarted: identity.value?.tracking_started,
  deployKind: openedDeploy.value?.kind,
}));
const missing = computed(() => noVerdict(result.value, missingContext.value));
// Before tracking reaches a window its zeros are not counts, so no tile, table or chart reads them.
const noEvidence = computed(() => missing.value === "not_tracking" || missing.value === "no_data");
// A service that never sent browser data gets one notice on its RUM tab instead of per-tile states.
const rumAbsent = computed(() => {
  const rows = versions.data.value?.versions;
  return Boolean(rows?.length) && !rows!.some((row) => row.signals?.rum);
});
const rumShown = computed(
  () => !restricted.value && !notServing.value && !noEvidence.value && !rumAbsent.value,
);
const leadingCode = computed(() => leading.value && verdictCode(leading.value));
const notes = computed(() => noteKeys(result.value?.notes));
const notServing = computed(() => leadingCode.value === "not_serving");
const pods = computed(() => notServingPods(result.value));
// The producer sends the INP and breakdown sections for every service; they only mean something for RUM.
const hasDrill = computed(
  () =>
    selectedSignal.value === "rum" &&
    Boolean(result.value?.inp_targets || result.value?.rum_breakdown),
);
const restricted = computed(
  () => result.value?.live_verdict?.restricted || result.value?.stored_verdict?.restricted,
);
const deployKind = computed(() => (leading.value ?? stored.value)?.deploy?.kind);
const accessibleTitle = computed(() => {
  const text = title.value ? compareTitleText(title.value, t) : undefined;
  return [
    state.value.service,
    text?.baseline ? `${text.baseline} →` : "",
    text?.compared,
    title.value?.suffix,
  ]
    .filter(Boolean)
    .join(" ");
});
const title = computed(() => {
  const compared = result.value?.arms.a.version || state.value.a;
  if (!compared) return undefined;
  const verdict = leading.value ?? stored.value;
  const baseline = result.value
    ? result.value.arms.b.version
    : state.value.b || stored.value?.baseline?.version;
  const comparedImage = result.value ? result.value.arms.a.image : state.value.aImage;
  const baselineImage = result.value
    ? result.value.arms.b.image
    : state.value.bImage || stored.value?.baseline?.image;
  return compareTitle(
    {
      compared,
      baseline,
      kind: deployKind.value,
      notServing: notServing.value,
      comparedImage: imageShort(comparedImage, imagesOf(compared, verdict?.version_images)),
      baselineImage: baseline
        ? imageShort(baselineImage, imagesOf(baseline, verdict?.baseline?.version_images))
        : "",
    },
    t,
  );
});
// The where chip repeats nothing the env chip already says.
const showWhere = computed(
  () => Boolean(state.value.where) && whereText(state.value.where, null, t) !== identity.value?.env,
);
const baselineFrom = computed(() =>
  result.value?.baseline_rule === "env_fallback" &&
  result.value.arms.b.where_key &&
  result.value.arms.b.where_key !== result.value.where_key
    ? whereText(result.value.arms.b.where_key, null, t)
    : "",
);
// Only one side of an env fallback can be the scope outside Kubernetes, so each gets its own wording.
const baselineFromTip = computed(() => {
  const params = {
    where: whereText(state.value.where, null, t),
    env: result.value?.env || "",
    baselineWhere: baselineFrom.value,
  };
  if (isOutsideK8s(state.value.where))
    return t("serviceVersions.compare.baselineFromTipOutside", params);
  return isOutsideK8s(result.value?.arms.b.where_key)
    ? t("serviceVersions.compare.baselineFromTipBaselineOutside", params)
    : t("serviceVersions.compare.baselineFromTip", params);
});
const rollbackFrom = computed(() =>
  deployKind.value === "rollback"
    ? (leading.value ?? stored.value)?.deploy?.from_version || ""
    : "",
);
// A picked baseline is the one version row that carries the baseline label; otherwise the auto rule does.
const picked = computed(() => result.value?.baseline_rule === "manual");
// The picked build's row carries the baseline label instead of its version.
function isPickedBaseline(row: Version) {
  const arm = result.value?.arms.b;
  return (
    picked.value && row.version === arm?.version && (row.image ?? null) === (arm?.image ?? null)
  );
}
// Spans without a version are not a version anyone can pick.
const versionedRows = computed(() =>
  (versions.data.value?.versions || []).filter((row) => row.version),
);
// One row per build: a version's images are separate rows, newest first, never the compared build itself.
const baselineRows = computed(() => {
  const arm = result.value?.arms.a;
  const rows = new Map<string, Version>();
  for (const row of [...versionedRows.value].sort((a, b) => b.first_seen - a.first_seen)) {
    const isCompared = row.version === arm?.version && (row.image ?? null) === (arm?.image ?? null);
    const key = `${row.version}\u0000${row.image ?? ""}`;
    if (!isCompared && !rows.has(key)) rows.set(key, row);
  }
  return [...rows.values()];
});
const baselineSearch = ref("");
// Five builds per version keep the list scannable; a search lists every build.
const shownBaselineRows = computed(() =>
  baselineSearch.value.trim()
    ? { rows: baselineRows.value, more: [] }
    : capImageRows(baselineRows.value, BASELINE_IMAGES_SHOWN),
);
const baselineValue = computed(
  () =>
    baselineRows.value.find(
      (row) =>
        row.version === state.value.b && (!state.value.bImage || row.image === state.value.bImage),
    )?.version_key ||
    state.value.baseline ||
    "auto",
);
const autoLabel = computed(() => {
  const current = result.value;
  if (!current) return t("serviceVersions.compare.auto");
  // A picked baseline is named as picked, never by the stored verdict's own rule.
  const rule =
    current.baseline_rule === "manual"
      ? "manual"
      : deployKind.value === "rollback"
        ? "rollback"
        : current.baseline_rule;
  const outsideRule = rule === "env_fallback" && isOutsideK8s(current.where_key);
  const ruleText = t(
    `serviceVersions.compare.baselineRule.${outsideRule ? "env_fallback_outside" : rule}` as I18nKey,
    { where: whereText(current.where_key, null, t) },
  );
  // A compare with no verdict to show names its no-verdict state, never "first version".
  if (!current.arms.b.version && missing.value)
    return t("serviceVersions.compare.baselineAutoNone", {
      rule: noVerdictBaselineRule(missing.value, missingContext.value, t),
    });
  // Only a First version may say it has no earlier version; any other baselineless compare names none.
  if (!current.arms.b.version)
    return rule !== "none" || leadingCode.value === "first_version"
      ? t("serviceVersions.compare.baselineAutoNone", { rule: ruleText })
      : t("serviceVersions.compare.auto");
  const params = {
    version: (title.value && compareTitleText(title.value, t).baseline) || current.arms.b.version,
    where: baselineFrom.value,
    rule: ruleText,
    share: formatCount(Math.round((current.arms.b.traffic_share ?? 0) * 100)),
  };
  if (baselineFrom.value)
    return isOutsideK8s(current.arms.b.where_key)
      ? t("serviceVersions.compare.baselineAutoFromOutside", params)
      : t("serviceVersions.compare.baselineAutoFrom", params);
  if (rule === "canary" && current.arms.b.traffic_share)
    return t("serviceVersions.compare.baselineAutoShare", params);
  return t("serviceVersions.compare.baselineAuto", params);
});
const canaryFallback = computed(() => {
  const current = result.value;
  if (!current || restricted.value || missing.value || current.baseline_rule !== "canary")
    return "";
  if (leadingCode.value !== "insufficient") return "";
  const metric = leading.value?.needs?.metric ?? "error_rate";
  const params = {
    baseline: current.arms.b.version,
    need: formatCount(leading.value?.needs?.need ?? FLOORS[metric as TileMetric] ?? 100),
  };
  // The fallback is [eval_start − L, eval_start) with L = A's length; A starts at eval_start.
  const { start_time: start, end_time: end } = current.arms.a;
  const span = end - start;
  const baselineRow = versions.data.value?.versions.find(
    (row) => row.version === current.arms.b.version,
  );
  if (span <= 0 || !baselineRow || baselineRow.first_seen > start - span)
    return t("serviceVersions.compare.canaryFallbackRule", params);
  return t("serviceVersions.compare.canaryFallback", {
    ...params,
    window: formatWindow(start - span, start, t),
    span: formatSpan(span),
  });
});
const selectedSignal = ref<Signal>("traces");
const chartMetric = ref<TileMetric>("error_rate");
const section = computed(() => result.value?.[selectedSignal.value]);
// A section that timed out or failed measured nothing, so it shows only its unavailable state.
const sectionError = computed(() => sectionFailed(section.value));
const servingRequests = computed(() =>
  sectionFailed(result.value?.traces) ? undefined : result.value?.traces?.requests,
);
const rumChartMetric = computed<RumSeriesMetric>(() =>
  chartMetric.value === "lcp_p75" || chartMetric.value === "cls_p75"
    ? chartMetric.value
    : "inp_p75",
);
const overlayMetric = computed<OverlayMetric>(() =>
  notServing.value
    ? "requests"
    : ((["requests", "error_rate", "p95", "p99"] as const).find(
        (metric) => metric === chartMetric.value,
      ) ?? "error_rate"),
);
// Request counts are per overlay bucket; the axis reads per minute like the tiles.
function formatOverlayY(value: number) {
  if (overlayMetric.value !== "requests") return formatMetric(overlayMetric.value, value, t);
  const step = result.value ? overlayStep(result.value) : 60;
  return formatCount((value * 60) / step);
}
// A version serving nothing has no buckets, so its zero line is drawn across its own window.
const overlaySeriesA = computed(() => {
  const points = overlay.data.value?.a || [];
  const current = result.value;
  if (points.length || !notServing.value || !current) return points;
  const { start_time: start, end_time: end } = current.arms.a;
  return [
    { x: start / 1000, y: 0 },
    { x: end / 1000, y: 0 },
  ];
});
const deployMarker = computed(() => {
  const at = leading.value?.deploy?.at;
  const arms = result.value?.arms;
  return at && arms ? { x: at / 1000, label: buildLabel(arms.a, arms.b, t) } : undefined;
});
const legendSeconds = computed(() =>
  result.value
    ? shortWindow(result.value.arms.a, hasBaseline(result.value) ? result.value.arms.b : null)
    : false,
);
const tab = ref<string | number>("what-changed");
watch(rumOnly, () => (tab.value = "what-changed"));
const viewport = ref(window.innerWidth);
const rootSize = ref(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
const width = ref(48);
const maxRem = computed(() => Math.max(30, (viewport.value / rootSize.value) * 0.7));
const drawerWidth = computed(() =>
  viewport.value < 30 * rootSize.value
    ? 100
    : Math.min(
        70,
        ((Math.max(30, Math.min(width.value, maxRem.value)) * rootSize.value) / viewport.value) *
          100,
      ),
);
function resized() {
  viewport.value = window.innerWidth;
  rootSize.value = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
function clampWidth(value: number) {
  width.value = Math.max(30, Math.min(maxRem.value, value));
}
function dragTo(event: PointerEvent) {
  clampWidth((viewport.value - event.clientX) / rootSize.value);
}
function stopResize() {
  window.removeEventListener("pointermove", dragTo);
  window.removeEventListener("pointerup", stopResize);
}
function startResize(event: PointerEvent) {
  event.preventDefault();
  window.addEventListener("pointermove", dragTo);
  window.addEventListener("pointerup", stopResize);
}
function resizeByKey(event: KeyboardEvent) {
  const steps: Record<string, () => number> = {
    ArrowLeft: () => width.value + 2,
    ArrowRight: () => width.value - 2,
    Home: () => 30,
    End: () => maxRem.value,
  };
  const next = steps[event.key];
  if (!next) return;
  event.preventDefault();
  clampWidth(next());
}
window.addEventListener("resize", resized);
onUnmounted(() => {
  window.removeEventListener("resize", resized);
  stopResize();
});
function baseline(value: unknown) {
  const chosen = String(value);
  const row = versions.data.value?.versions.find((row) => row.version_key === chosen);
  void drawer.update(
    row
      ? {
          cmp: `${state.value.a}..${row.version}`,
          cmpBase: undefined,
          cmpImgB: row.image || undefined,
        }
      : {
          cmp: state.value.a,
          cmpBase: chosen === "auto" ? undefined : chosen,
          cmpImgB: undefined,
        },
  );
}
const overlay = useQuery(
  computed(() => {
    const current = result.value;
    const currentOrg = org.value;
    const metric = overlayMetric.value;
    return {
      queryKey: [
        ...serviceVersionKeys.reader(currentOrg, user.value),
        "series",
        metric,
        body.value,
        current?.arms,
      ],
      enabled: Boolean(current && !restricted.value && selectedSignal.value === "traces"),
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readCompareOverlay(currentOrg, current!, signal, metric),
    };
  }),
);
const lastGood = useLastGood(() => ({
  org: org.value,
  user: user.value,
  service: state.value.service,
  where: state.value.where,
  current: result.value?.arms.a,
}));
// A failed compare still answers with the stored verdict of the exact transition the link pins.
const storedVerdicts = useQuery(
  computed(() => ({
    ...(state.value.deployKey
      ? deployVerdictQuery(org.value, user.value, state.value.deployKey)
      : verdictsQuery(org.value, user.value, identity.value ? [identity.value.version_key] : [])),
    enabled:
      comparison.isError.value && Boolean(state.value.deployKey || identity.value?.version_key),
  })),
);
const stored = computed(() => {
  if (result.value) return undefined;
  const rows = (storedVerdicts.data.value?.verdicts || []).filter((row) => row.deploy_key);
  const chosen = state.value.deployKey
    ? rows.find((row) => row.deploy_key === state.value.deployKey)
    : rows.toSorted((left, right) => (right.deploy?.at ?? 0) - (left.deploy?.at ?? 0))[0];
  return chosen ?? undefined;
});
const incidentVerdict = computed(() => result.value?.stored_verdict ?? stored.value);
const storedAt = computed(() =>
  Math.max(0, ...(stored.value?.metrics || []).map((row) => row.updated_at ?? 0)),
);
// Only windows the verdict itself judged are shown; none stored means none named.
const storedWindows = computed(() => {
  const value = stored.value;
  const windows = value?.windows;
  if (!value || !windows?.a) return { window: "", line: "" };
  const { a, b } = windows;
  const seconds = shortWindow(a, b);
  const after = value.version || state.value.a;
  const start = Math.min(a.start_time, b?.start_time ?? a.start_time);
  const end = Math.max(a.end_time, b?.end_time ?? a.end_time);
  return {
    window: formatWindow(start, end, t, seconds),
    line:
      b && value.baseline?.version
        ? t("serviceVersions.compare.storedWindows", {
            before: value.baseline.version,
            beforeWindow: formatWindow(b.start_time, b.end_time, t, seconds),
            after,
            afterWindow: formatWindow(a.start_time, a.end_time, t, seconds),
          })
        : t("serviceVersions.compare.windowLineFirstBare", {
            version: after,
            window: formatWindow(a.start_time, a.end_time, t, seconds),
          }),
  };
});
// Only a stored deploy verdict opens an incident, so a manual compare says why the button is off.
const incidentBlocked = computed(() => {
  if (restricted.value) return t("serviceVersions.actions.incidentRestricted");
  return incidentVerdict.value ? undefined : t("serviceVersions.actions.incidentNoVerdict");
});
const incidentPending = ref(false);
const incidentMessage = ref("");
let incidentGeneration = 0;
async function incident() {
  const verdict = incidentVerdict.value;
  if (incidentPending.value || !verdict || restricted.value) return;
  const request = ++incidentGeneration;
  const isCurrent = () => request === incidentGeneration;
  incidentPending.value = true;
  try {
    const response = await serviceVersions.openIncident(org.value, {
      title: verdictSentence(verdict, t),
      severity: "P2",
      service: state.value.service,
      where_key: state.value.where,
      env: result.value?.env ?? verdict.env ?? "",
      version: result.value?.arms.a.version ?? verdict.version,
      baseline_version: result.value?.arms.b.version ?? verdict.baseline?.version ?? "",
      verdict_key: verdict.verdict_key,
      summary: verdictSentence(verdict, t),
      link: window.location.href,
    });
    if (!isCurrent()) return;
    incidentMessage.value = t(
      response.data.created
        ? "serviceVersions.incident.created"
        : "serviceVersions.incident.attached",
    );
  } catch {
    if (isCurrent()) incidentMessage.value = t("serviceVersions.incident.failed");
  } finally {
    if (isCurrent()) incidentPending.value = false;
  }
}
function copy(sentence: boolean) {
  const verdict = result.value && leadingVerdict(result.value);
  const text = missing.value
    ? noVerdictSentence(missing.value, missingContext.value, t)
    : verdict && verdictSentence(verdict, t);
  void copyToClipboard(
    sentence && text ? `${text}\n${window.location.href}` : window.location.href,
    t,
  );
}
// The body object is rebuilt on every route or versions refresh, so only a changed request resets the incident line.
watch([org, user, () => JSON.stringify(body.value)], () => {
  incidentGeneration++;
  incidentPending.value = false;
  incidentMessage.value = "";
});
watch([org, user], ([newOrg], [oldOrg, oldUser]) => {
  if (oldOrg)
    client.removeQueries({
      queryKey:
        newOrg === oldOrg
          ? serviceVersionKeys.reader(oldOrg, oldUser)
          : serviceVersionKeys.all(oldOrg),
    });
});
</script>
