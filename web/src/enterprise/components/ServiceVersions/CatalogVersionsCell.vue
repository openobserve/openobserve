<template>
  <span
    v-if="state === 'loading' && content === 'verdict'"
    class="flex flex-col items-start gap-0.5 py-1"
    data-test="svcver-cell-loading"
    ><OSkeleton class="h-5 w-24" /><OSkeleton class="h-3 w-16"
  /></span>
  <OSkeleton v-else-if="state === 'loading'" class="h-5 w-24" data-test="svcver-cell-loading" />
  <span
    v-else-if="state === 'locked'"
    class="text-text-secondary flex items-center gap-1 text-xs"
    data-test="svcver-cell-denied"
    ><OIcon name="lock" size="xs" />{{ t("serviceVersions.verdict.restricted") }}</span
  >
  <span
    v-else-if="state === 'error' || (unavailable && content !== 'versions')"
    class="text-text-muted text-xs"
    data-test="svcver-cell-error"
    >{{ raw("—") }}<OTooltip :content="t('serviceVersions.catalog.cellUnavailable')"
  /></span>
  <div
    v-else-if="scope"
    :data-test="`svcver-row-${scope.scope_key}-${scope.newest_version_key || 'no-version'}`"
    class="flex min-w-0 flex-col items-start"
  >
    <template v-if="!hasVersion(scope)">
      <span
        v-if="content !== 'deployed'"
        class="text-text-secondary flex items-center gap-1 text-xs"
        data-test="svcver-no-version-cell"
        >{{ t("serviceVersions.catalog.noVersionCell")
        }}<span v-if="content === 'versions'" class="text-text-muted inline-flex"
          ><OIcon name="info-outline" size="xs" /><OTooltip
            :content="t('serviceVersions.catalog.noVersionTip')" /></span
      ></span>
      <span v-else class="text-xs" data-test="svcver-deployed"
        ><NotComparedMark :reason="t('serviceVersions.catalog.noDeployRecorded')"
      /></span>
    </template>
    <template v-else-if="content === 'versions'">
      <span class="inline-flex max-w-full min-w-0"
        ><OButton
          variant="ghost"
          size="chip"
          class="max-w-full min-w-0 font-mono"
          :disabled="!shownKey || detail.compare_disabled"
          :data-test="`svcver-version-${scope.scope_key}-${shownKey || 'unavailable'}`"
          @click.stop="
            drawer.open({
              service: scope.service,
              where: scope.where_key,
              a: shown,
              aImage: detail.image || undefined,
            })
          "
          ><ServiceVersionLabel truncate :cut-tip="!hasSourceTip" :version="shown" /></OButton
        ><VersionSourceTip
          :label="shownLabel"
          :source="detail.source"
          :image-ref="detail.imageRef"
          :disabled-reason="compareDisabledText(detail, t)"
      /></span>
      <span
        v-if="shownImage || liveOthers.length > 0 || rollback"
        class="text-text-secondary text-2xs flex max-w-full min-w-0 items-center gap-1 ps-2"
        data-test="svcver-version-subline"
        ><span v-if="shownImage" class="min-w-0 truncate" data-test="svcver-version-image"
          ><OTooltip overflow-only />{{
            t("serviceVersions.image.short", { image: shownImage })
          }}</span
        ><span v-if="liveOthers.length > 0" class="inline-flex shrink-0"
          ><OTag
            variant="default"
            size="xs"
            shape="rounded"
            :label="t('serviceVersions.catalog.liveCount', { count: liveOthers.length })"
            data-test="svcver-live-count" /><OTooltip
            :content="alsoLive"
            data-test="svcver-live-count-tip" /></span
        ><span
          v-if="rollback"
          class="flex min-w-0 items-center gap-1"
          data-test="svcver-rollback-note"
          ><OIcon name="undo" size="xs" /><span class="truncate"
            ><OTooltip overflow-only />{{
              t("serviceVersions.catalog.rolledBackFrom", { version: rollback })
            }}</span
          ></span
        ></span
      >
    </template>
    <template v-else-if="content === 'verdict'">
      <VerdictChip
        v-if="scope.newest_verdict"
        :verdict="scope.newest_verdict"
        :subline="verdictSubline(scope, t)"
        :tooltip="preExistingTip"
        :version="verdictVersion"
        :version-tip="verdictVersion && verdictLine(scope)"
        :test-id="`svcver-verdict-${scope.scope_key}-${scope.newest_verdict.version_key}`"
        @open="
          drawer.open({
            service: scope.service,
            where: scope.where_key,
            a: scope.newest_verdict.version,
            aImage: scope.newest_verdict.image || undefined,
            deployKey: scope.newest_verdict.deploy_key,
          })
        "
      />
      <span
        v-else-if="preTracking(scope)"
        class="text-xs"
        :data-test="`svcver-verdict-${scope.scope_key}-pre-tracking`"
        ><NotComparedMark :reason="noVerdictText(tracking, t, undefined, false)"
      /></span>
      <OTag
        v-else-if="isFirstVersion(scope)"
        type="versionVerdict"
        value="first_version"
        :data-test="`svcver-verdict-${scope.scope_key}-first-version`"
      />
      <OTag
        v-else-if="deployUnjudged(scope)"
        type="versionVerdict"
        value="insufficient"
        :data-test="`svcver-verdict-${scope.scope_key}-unjudged`"
      />
      <span v-else class="text-text-secondary text-xs">—</span>
    </template>
    <span v-else-if="deployedAt" class="text-text-secondary text-xs" data-test="svcver-deployed">{{
      formatAgoUs(deployedAt, t)
    }}</span>
    <!-- The deploy row exists but its time arrives with the verdict, so no reason is claimed. -->
    <span
      v-else-if="deployUnjudged(scope)"
      class="text-text-muted text-xs"
      data-test="svcver-deployed"
      >{{ raw("—") }}</span
    >
    <span v-else class="text-xs" data-test="svcver-deployed"
      ><NotComparedMark :reason="t('serviceVersions.catalog.noDeployRecorded')"
    /></span>
  </div>
  <span v-else-if="content === 'deployed'" class="text-xs" data-test="svcver-deployed"
    ><NotComparedMark :reason="t('serviceVersions.catalog.noDeployRecorded')"
  /></span>
  <span v-else class="text-text-secondary text-xs" data-test="svcver-cell-empty">—</span>
</template>
<script setup lang="ts">
import { computed, unref } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { Scope, Tracking } from "@/services/service_versions";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import VerdictChip from "./VerdictChip.vue";
import { verdictCode, verdictNames } from "./verdictText";
import NotComparedMark from "./NotComparedMark.vue";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import {
  formatAgoUs,
  deployUnjudged,
  hasVersion,
  isFirstVersion,
  preTracking,
  rolledBackFrom,
  shownVersion,
  shownVersionDetail,
  verdictSubline,
} from "@/plugins/traces/servicesCatalogVersions";
import { imageShort, noVerdictText, versionImageLabel } from "@/utils/serviceVersionsCopy";
import { envListText } from "@/services/service_versions.envs";
import ServiceVersionLabel from "@/components/shared/ServiceVersionLabel.vue";
import VersionSourceTip from "./VersionSourceTip.vue";
import { compareDisabledText, isImageSource } from "./versionImages";
const props = withDefaults(
  defineProps<{
    scope?: Scope;
    state?: "loading" | "locked" | "error" | "ready";
    unavailable?: boolean;
    content?: "versions" | "verdict" | "deployed";
    tracking?: Tracking;
    /** The banner above the table already gives the no-verdict sentence, so the chip does not repeat it. */
    explained?: boolean;
  }>(),
  { state: "ready", unavailable: false, content: "versions" },
);
const drawer = useVersionCompareDrawer();
const { t, locale } = useI18nTyped();
const shown = computed(() => shownVersion(props.scope));
const detail = computed(() => shownVersionDetail(props.scope));
// The source hover already names the whole label, so a cut version text needs no second hover.
const hasSourceTip = computed(
  () => isImageSource(detail.value.source) || Boolean(compareDisabledText(detail.value, t)),
);
const shownImage = computed(() => imageShort(detail.value.image, detail.value.versionImages));
const shownLabel = computed(() =>
  versionImageLabel(shown.value, detail.value.image, detail.value.versionImages, t),
);
// Two images of one version share their text, so the serving rows, not the text map, name the shown build.
const shownRow = computed(() =>
  props.scope?.active_version_rows?.find(
    (row) => row.version === shown.value && (row.image ?? null) === detail.value.image,
  ),
);
const shownKey = computed(
  () =>
    shownRow.value?.version_key ||
    props.scope?.active_version_keys?.[shown.value] ||
    (shown.value === props.scope?.newest_version ? props.scope?.newest_version_key : undefined) ||
    "",
);
const alsoLive = computed(() =>
  t("serviceVersions.image.alsoLive", {
    versions: envListText(liveOthers.value, String(unref(locale) || "en"), (count) =>
      t("serviceVersions.env.moreEnvs", { count }),
    ),
  }),
);
const liveOthers = computed(() => {
  const rows = props.scope?.active_version_rows;
  if (rows?.length)
    return rows
      .filter((row) => row.version && row.version_key !== shownKey.value)
      .map((row) => versionImageLabel(row.version, row.image, row.version_images, t));
  return (props.scope?.active_versions || []).filter((v) => v && v !== shown.value);
});
const rollback = computed(() => (props.scope ? rolledBackFrom(props.scope) : ""));
const deployedAt = computed(() => {
  const verdict = props.scope?.newest_verdict;
  return verdict?.state === "pre_existing" ? 0 : verdict?.deploy?.at || 0;
});
// A verdict of another build than the one the row shows names its version, as the compare header does.
const verdictVersion = computed(() => {
  const verdict = props.scope?.newest_verdict;
  const sameBuild =
    verdict?.version === shown.value && (verdict?.image ?? null) === detail.value.image;
  return verdict?.version && !sameBuild
    ? versionImageLabel(verdict.version, verdict.image, verdict.version_images, t)
    : "";
});
function verdictLine(scope: Scope) {
  const verdict = scope.newest_verdict!;
  const label = t(`serviceVersions.verdict.${verdictNames[verdictCode(verdict)]}` as I18nKey);
  return [`${verdictVersion.value} · ${label}`, verdictSubline(scope, t)].filter(Boolean).join(" ");
}
const preExistingTip = computed(() =>
  props.scope?.newest_verdict?.state === "pre_existing" && !props.explained
    ? noVerdictText(props.tracking, t)
    : "",
);
</script>
