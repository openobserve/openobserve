<template>
  <OContent as="section" y class="flex flex-col gap-3" data-test="svcver-versions-tab">
    <p
      v-if="!enabled || denied"
      data-test="svcver-panel-denied"
      class="text-text-secondary text-sm"
    >
      {{ t("serviceVersions.compare.denied") }}
    </p>
    <template v-else>
      <div
        v-if="discovery.isError.value"
        class="flex items-center gap-2 text-sm"
        data-test="svcver-panel-discovery-error"
      >
        <span>{{ t("serviceVersions.compare.error") }}</span>
        <OButton
          variant="outline"
          size="sm"
          data-test="svcver-discovery-retry"
          @click="discovery.refetch()"
          >{{ t("serviceVersions.actions.retry") }}</OButton
        >
      </div>
      <div v-if="places.length > 1" class="flex items-center gap-2">
        <OSelect
          :model-value="where"
          :label="t('serviceVersions.catalog.where')"
          label-position="inside"
          size="sm"
          data-test="svcver-where"
          @update:model-value="(value) => panel.update(String(value), 'versions')"
          ><OSelectItem
            v-for="place in places"
            :key="place.key"
            :value="place.key"
            :label="raw(place.label)"
            :data-test="`svcver-where-option-${place.key}`"
            ><OTruncatedText v-if="place.outside" class="text-text-secondary block flex-1">{{
              place.label
            }}</OTruncatedText></OSelectItem
          ></OSelect
        >
      </div>
      <p v-if="noCluster" class="text-text-secondary text-xs" data-test="svcver-no-cluster">
        {{ t("serviceVersions.env.noCluster") }}
      </p>
      <ServicePanelVerdictCard
        v-if="latest && where && !query.isError.value"
        :org="org"
        :user="user"
        :service="service"
        :where="where"
        :where-label="currentWhereLabel"
        :identity="latest"
        :version="latest.version"
        :deploy-key="latest.deploys?.[0]?.deploy_key"
        :pre-existing="preExisting(latest)"
        :tracking="query.data.value?.tracking"
        @baseline="(value) => (baseline = value)"
      />
      <OSkeleton
        v-if="query.isPending.value"
        class="h-24 w-full"
        data-test="svcver-panel-loading"
      />
      <div
        v-else-if="query.isError.value"
        class="flex items-center gap-2 text-sm"
        data-test="svcver-panel-error"
      >
        <span>{{ t("serviceVersions.compare.error") }}</span>
        <OButton variant="outline" size="sm" data-test="svcver-retry" @click="query.refetch()">{{
          t("serviceVersions.actions.retry")
        }}</OButton>
      </div>
      <div
        v-if="transitions.isError.value || verdicts.isError.value"
        class="flex items-center gap-2 text-sm"
        data-test="svcver-panel-partial-error"
      >
        <span class="text-text-secondary flex items-center gap-1"
          ><OIcon name="warning-amber" size="xs" />{{
            t("serviceVersions.catalog.cellUnavailable")
          }}</span
        >
        <OButton
          variant="outline"
          size="sm"
          data-test="svcver-panel-verdict-retry"
          @click="
            transitions.refetch();
            verdicts.refetch();
          "
          >{{ t("serviceVersions.actions.retry") }}</OButton
        >
      </div>
      <p
        v-if="!query.isPending.value && !query.isError.value && !rows.length && !unversioned"
        class="text-text-secondary text-sm"
        data-test="svcver-panel-empty"
      >
        {{ t("serviceVersions.compare.empty") }}
      </p>
      <OTable
        v-if="rows.length"
        :data="rows"
        :columns="columns"
        row-key="version_key"
        :pagination="rows.length > pageSize ? 'client' : 'none'"
        :page-size="pageSize"
        sorting="none"
        :show-global-filter="false"
        :fill-height="false"
        :sticky-header="false"
        frame
        expansion="multiple"
        :expanded-ids="expansionIds"
        :get-row-expansion-enabled="() => false"
        :row-class="(row: PanelRow) => (isBaseline(row) ? 'bg-table-row-selected-bg' : '')"
        data-test="svcver-versions-table"
        @update:expanded-ids="
          (ids: string[]) =>
            (expanded = ids.filter((id) => expanded.includes(id) || !moreAfter.has(id)))
        "
        @row-click="(row: PanelRow) => open(row.version, undefined, row.image)"
      >
        <template #cell-select="{ row }">
          <span @click.stop
            ><OCheckbox
              :model-value="selected.includes(row.version_key)"
              :data-test="`svcver-select-${row.version_key}`"
              :aria-label="raw(labelOf(row))"
              :disabled="
                row.restricted ||
                row.compare_disabled ||
                (selected.length >= 2 && !selected.includes(row.version_key))
              "
              @update:model-value="(value) => select(row.version_key, Boolean(value))"
          /></span>
        </template>
        <template #cell-version="{ row }">
          <span class="flex min-w-0 items-center gap-1"
            ><span
              class="text-text-heading flex min-w-0 font-mono font-semibold"
              :data-test="`svcver-version-${row.version_key}`"
              ><ServiceVersionLabel
                truncate
                :version="row.version"
                :image="row.image"
                :version-images="row.version_images" /><VersionSourceTip
                v-if="isImageSource(row.version_source)"
                :label="labelOf(row)"
                :source="row.version_source"
                :image-ref="row.image_ref" /><OTooltip
                v-else
                :content="raw(`${row.raw_version || row.version} · ${row.version_source}`)" /></span
            ><span v-if="row.as_name" class="text-text-secondary shrink-0 text-xs">{{
              t("serviceVersions.panel.asName", { name: row.as_name })
            }}</span></span
          >
        </template>
        <template #cell-first_seen="{ row }">{{ dateTime(row.first_seen) }}</template>
        <template #cell-last_seen="{ row }">
          <OTag
            v-if="row.active"
            variant="success-soft"
            shape="pill"
            dot
            :label="t('serviceVersions.panel.live')"
            data-test="svcver-version-status"
          />
          <span v-else class="flex flex-col leading-tight" data-test="svcver-version-status"
            ><span>{{ dateTime(row.last_seen) }}</span
            ><span class="text-text-secondary text-xs">{{
              t("serviceVersions.panel.stopped", { ago: ago(row.last_seen, lang) })
            }}</span></span
          >
        </template>
        <template #cell-signals="{ row }">
          <span class="flex flex-wrap items-center gap-1">
            <OTag
              v-if="row.signals.traces"
              variant="teal-soft"
              shape="pill"
              icon="account-tree"
              :label="t('serviceVersions.compare.traces')" /><OTag
              v-if="row.signals.rum"
              variant="cyan-soft"
              shape="pill"
              icon="devices"
              :label="t('serviceVersions.compare.rum')"
          /></span>
        </template>
        <template #cell-verdict="{ row }">
          <VerdictChip
            v-if="row.verdict"
            :verdict="row.verdict"
            :test-id="`svcver-verdict-${row.version_key}`"
            @open="
              open(row.version, row.verdict.deploy_key || row.deploys?.[0]?.deploy_key, row.image)
            "
          /><OTag
            v-else-if="row.preExisting"
            type="versionVerdict"
            value="pre_existing"
            :data-test="`svcver-verdict-${row.version_key}`"
          /><OTag
            v-else-if="row.unjudged"
            type="versionVerdict"
            value="insufficient"
            :data-test="`svcver-verdict-${row.version_key}`"
          />
        </template>
        <template #cell-action="{ row }">
          <span
            v-if="row.version_key === latest?.version_key"
            class="text-text-secondary text-xs"
            >{{ t("serviceVersions.panel.current") }}</span
          >
          <span
            v-else-if="baseline && isBaseline(row)"
            class="text-text-secondary text-xs"
            :data-test="`svcver-baseline-${row.version_key}`"
            >{{ baselineSourceLabel(baseline.source, t) }}</span
          >
          <span
            v-else-if="latest && row.version && !row.restricted"
            class="inline-flex"
            :data-test="`svcver-compare-wrap-${row.version_key}`"
            ><OButton
              variant="ghost-primary"
              size="chip"
              icon-left="compare-arrows"
              :disabled="row.compare_disabled || latest.compare_disabled"
              :data-test="`svcver-compare-${row.version_key}`"
              :aria-label="compareLabel(row)"
              @click.stop="compareWith(row)"
              >{{ t("serviceVersions.actions.compare") }}</OButton
            ><OTooltip
              v-if="row.compare_disabled || latest.compare_disabled"
              :content="raw(compareDisabledText({ compare_disabled: true }, t))"
              :data-test="`svcver-compare-disabled-${row.version_key}`" /><OTooltip
              v-else
              :content="raw(compareLabel(row))"
          /></span>
          <OButton
            v-if="row.history.length"
            variant="ghost"
            size="icon-chip"
            :aria-label="t('serviceVersions.panel.deployCount', { count: row.history.length })"
            :data-test="`svcver-expand-${row.version_key}`"
            :aria-expanded="expanded.includes(row.version_key)"
            @click.stop="toggle(row.version_key)"
            ><OIcon
              :name="expanded.includes(row.version_key) ? 'expand-less' : 'expand-more'"
              size="sm"
          /></OButton>
        </template>
        <template #expansion="{ row }">
          <div
            v-if="expanded.includes(row.version_key)"
            class="bg-surface-panel flex flex-col gap-1 py-2 ps-10 pe-3"
            data-test="svcver-transitions"
          >
            <span class="text-text-secondary text-xs">{{ transitionsTitle }}</span>
            <OButton
              v-for="deploy in row.history"
              :key="deploy.deploy_key"
              variant="ghost"
              size="sm"
              class="justify-start! gap-3!"
              :data-test="`svcver-deploy-${deploy.deploy_key}`"
              @click.stop="open(deploy.version, deploy.deploy_key)"
            >
              <span class="text-text-secondary w-20 text-start text-xs tabular-nums">{{
                clockTime(deploy.at)
              }}</span>
              <span class="text-text-heading w-16 text-start font-mono font-semibold">{{
                deploy.version
              }}</span>
              <span class="text-text-secondary flex w-44 items-center gap-1 text-start text-xs"
                ><OIcon v-if="deploy.kind === 'rollback'" name="undo" size="xs" />{{
                  deploy.kind === "rollback"
                    ? t("serviceVersions.panel.transition.rollbackFrom", {
                        version: deploy.from_version || "",
                      })
                    : deploy.kind === "redeploy"
                      ? t("serviceVersions.panel.transition.redeploy")
                      : t("serviceVersions.panel.transition.deploy")
                }}</span
              >
              <VerdictChip v-if="deploy.verdict" :verdict="deploy.verdict" :clickable="false" />
              <span class="text-text-secondary text-xs">{{ transitionNote(deploy) }}</span>
            </OButton>
          </div>
          <OButton
            v-if="moreLine(row.version_key)"
            variant="ghost"
            size="sm"
            class="ms-1 justify-start! gap-1!"
            data-test="svcver-versions-image-more"
            @click.stop="showImages(moreLine(row.version_key)?.version || '')"
            ><OIcon name="expand-more" size="sm" /><span class="text-text-heading">{{
              moreLine(row.version_key)?.label
            }}</span
            ><span class="text-text-secondary">{{ moreLine(row.version_key)?.range }}</span
            ><span class="text-text-link">{{ moreLine(row.version_key)?.action }}</span></OButton
          >
        </template>
      </OTable>
      <NoVersionState
        v-if="unversioned"
        :service="service"
        :env="scoped.find((row) => row.env)?.env"
        :identity="latest ? undefined : scoped.find((row) => row.env)"
        :where="latest ? undefined : where"
        :where-label="latest ? undefined : currentWhereLabel"
      />
      <div v-if="versioned.length || !unversioned" class="flex flex-wrap items-center gap-2">
        <OSwitch
          v-model="inactive"
          size="sm"
          data-test="svcver-include-inactive"
          :label="t('serviceVersions.panel.showStopped')"
        />
        <span class="text-text-secondary text-xs">{{
          t("serviceVersions.panel.showStoppedHint")
        }}</span>
        <span class="flex-1" />
        <OSearchInput
          v-model="search"
          size="sm"
          class="w-48!"
          :placeholder="t('serviceVersions.compare.searchVersions')"
          data-test="svcver-version-search"
          data-no-autofocus
        />
        <span
          v-if="selected.length !== 2"
          class="text-text-secondary text-xs"
          data-test="svcver-compare-hint"
          >{{
            versioned.length === 1
              ? t("serviceVersions.panel.onlyOneVersion")
              : t("serviceVersions.panel.selectTwo")
          }}</span
        >
        <OButton
          variant="outline"
          size="sm"
          icon-left="compare-arrows"
          :disabled="selected.length !== 2"
          data-test="svcver-compare"
          @click="compare"
          >{{ t("serviceVersions.actions.compare") }}</OButton
        >
      </div>
      <p
        v-if="(query.data.value?.purged_versions || 0) > 0"
        class="text-text-secondary text-xs"
        data-test="svcver-purged"
      >
        {{ t("serviceVersions.panel.purged", { count: query.data.value?.purged_versions }) }}
      </p>
    </template>
  </OContent>
</template>
<script setup lang="ts">
import config from "@/aws-exports";
import { computed, ref, unref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import type { DeployMarker, Version, VerdictSummary } from "@/services/service_versions";
import { versionsQuery, deploysQuery, verdictsQuery } from "@/services/service_versions.queries";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { useServicePanelRoute } from "@/plugins/traces/composables/useServicePanelRoute";
import OContent from "@/lib/core/Content/OContent.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import VerdictChip from "./VerdictChip.vue";
import { CATALOG_COLUMN_SIZES } from "@/plugins/traces/servicesCatalogVersions";
import NoVersionState from "./NoVersionState.vue";
import ServicePanelVerdictCard from "./ServicePanelVerdictCard.vue";
import { ago, clockTime, dateTime } from "./ServiceVersionsTab.format";
import ServiceVersionLabel from "@/components/shared/ServiceVersionLabel.vue";
import VersionSourceTip from "./VersionSourceTip.vue";
import {
  capImageRows,
  compareDisabledText,
  dayRange,
  isImageSource,
  PANEL_IMAGES_SHOWN,
} from "./versionImages";
import {
  baselineSourceLabel,
  isOutsideK8s,
  sameBuild,
  versionImageLabel,
  whereSentence,
  whereText,
  type BaselineMark,
} from "@/utils/serviceVersionsCopy";
type Transition = DeployMarker & { verdict?: VerdictSummary | null };
type PanelRow = Version & {
  verdict?: VerdictSummary;
  preExisting: boolean;
  unjudged: boolean;
  history: Transition[];
};
const props = defineProps<{ service: string }>();
const enabled = config.isEnterprise === "true" || config.isCloud === "true";
const historyEnd = Date.now() * 1000;
const pageSize = 20;
const { t, locale } = useI18nTyped();
const store = useStore();
const org = computed(() => store.state.selectedOrganization?.identifier || ""),
  user = computed(() => store.state.userInfo?.email || ""),
  lang = computed(() => String(unref(locale) || "en"));
const service = computed(() => props.service);
const panel = useServicePanelRoute();
const where = computed(() => panel.state.value.where);
const inactive = ref(true),
  search = ref(""),
  expanded = ref<string[]>([]),
  baseline = ref<BaselineMark | undefined>();
const selected = ref<string[]>([]);
const imagesShown = ref<ReadonlySet<string>>(new Set());
const drawer = useVersionCompareDrawer();
const columns = computed<OTableColumnDef<PanelRow>[]>(() => [
  { id: "select", header: raw(""), size: 36 },
  { id: "version", header: t("serviceVersions.panel.version"), size: 168 },
  { id: "first_seen", header: t("serviceVersions.panel.columns.firstSeen"), size: 102 },
  { id: "last_seen", header: t("serviceVersions.panel.columns.lastSeen"), size: 114 },
  { id: "signals", header: t("serviceVersions.panel.columns.signals"), size: 105 },
  {
    id: "verdict",
    header: t("serviceVersions.catalog.deployVerdict"),
    size: CATALOG_COLUMN_SIZES.version_verdict,
  },
  { id: "action", header: raw(""), size: 156, isAction: true },
]);
const discovery = useQuery(
  computed(() => ({
    ...versionsQuery(org.value, user.value, {
      service: props.service,
      include_inactive: true,
      limit: 10000,
    }),
    enabled: enabled && Boolean(props.service && org.value),
  })),
);
const query = useQuery(
  computed(() => ({
    ...versionsQuery(org.value, user.value, {
      service: props.service,
      where: where.value || undefined,
      include_inactive: true,
      limit: 10000,
    }),
    enabled: enabled && Boolean(org.value && props.service),
  })),
);
const transitions = useQuery(
  computed(() => ({
    ...deploysQuery(org.value, user.value, {
      service: props.service,
      where: where.value,
      start_time: 0,
      end_time: historyEnd,
    }),
    enabled: enabled && Boolean(org.value && props.service && where.value),
  })),
);
const verdicts = useQuery(
  computed(() => ({
    ...verdictsQuery(
      org.value,
      user.value,
      (query.data.value?.versions || [])
        .filter((row) => row.where_key === where.value)
        .map((row) => row.version_key),
    ),
    enabled: enabled && Boolean(org.value && where.value && query.data.value?.versions.length),
  })),
);
const denied = computed(
  () => (query.error.value as { response?: { status?: number } })?.response?.status === 403,
);
const scoped = computed(() =>
  (query.data.value?.versions || []).filter((row) => row.where_key === where.value),
);
// Spans with no version are the setup guide's subject, never a version row to pick or compare.
const versioned = computed(() => scoped.value.filter((row) => row.version));
const unversioned = computed(() => scoped.value.some((row) => !row.version));
const noCluster = computed(() =>
  scoped.value.some((row) => row.where?.kind === "k8s" && !row.where.k8s_cluster),
);
const places = computed(() => {
  const seen = new Map<string, { label: string; outside: boolean }>();
  for (const row of discovery.data.value?.versions || [])
    if (!seen.has(row.where_key))
      seen.set(row.where_key, {
        label: whereText(row.where_key, row.where, t),
        outside: isOutsideK8s(row.where_key, row.where),
      });
  return [...seen]
    .map(([key, place]) => ({ key, ...place }))
    .sort((a, b) => a.key.localeCompare(b.key));
});
const currentWhereLabel = computed(
  () =>
    places.value.find((place) => place.key === where.value)?.label ||
    whereText(where.value, null, t),
);
const transitionsTitle = computed(() =>
  whereSentence(
    {
      in: "serviceVersions.panel.transitionsIn",
      outside: "serviceVersions.panel.transitionsOutside",
    },
    where.value,
    scoped.value[0]?.where,
    {},
    t,
  ),
);
watch(
  places,
  (values) => {
    if (!where.value && values.length > 0) void panel.update(values[0].key, "versions");
  },
  { immediate: true },
);
const deployVerdicts = computed(
  () =>
    new Map(
      (transitions.isError.value ? [] : transitions.data.value?.deploys || []).map((deploy) => [
        deploy.deploy_key,
        deploy,
      ]),
    ),
);
function preExisting(row: Version) {
  return (
    Boolean(row.deploys?.length) && row.deploys!.every((deploy) => deploy.kind === "pre_existing")
  );
}
// The newest deploy, recorded before its first verdict, reads Not enough data, as in the catalog.
function unjudged(row: Version, verdict?: VerdictSummary) {
  return (
    !verdict &&
    row.version === latest.value?.version &&
    !verdicts.isError.value &&
    Boolean(verdicts.data.value) &&
    (row.deploys || []).some((deploy) => deploy.kind !== "pre_existing")
  );
}
function historyOf(row: Version): Transition[] {
  const all = transitions.isError.value ? [] : transitions.data.value?.deploys || [];
  const linked = all.filter(
    (deploy) =>
      deploy.kind !== "pre_existing" &&
      (deploy.version === row.version || deploy.from_version === row.version),
  );
  const own = (row.deploys || [])
    .filter((deploy) => deploy.kind !== "pre_existing")
    .map((deploy) => deployVerdicts.value.get(deploy.deploy_key || "") || deploy);
  const merged = new Map<string, Transition>();
  for (const deploy of [...linked, ...own]) merged.set(deploy.deploy_key || `${deploy.at}`, deploy);
  return [...merged.values()].sort((a, b) => b.at - a.at);
}
const allRows = computed<PanelRow[]>(() =>
  versioned.value
    .map((row) => {
      const verdict = verdicts.isError.value
        ? undefined
        : verdicts.data.value?.verdicts.find((value) => value.version_key === row.version_key);
      return {
        ...row,
        verdict,
        preExisting: preExisting(row),
        unjudged: unjudged(row, verdict),
        history: historyOf(row),
      };
    })
    .filter(
      (row) =>
        (inactive.value || row.active) &&
        row.version.toLowerCase().includes(search.value.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.first_seen - a.first_seen ||
        a.version_key.localeCompare(b.version_key),
    ),
);
// Builds of one version stay together, newest first; past three, one line summarises the rest until clicked.
const imageView = computed(() =>
  capImageRows(
    allRows.value,
    search.value ? Number.POSITIVE_INFINITY : PANEL_IMAGES_SHOWN,
    imagesShown.value,
  ),
);
const rows = computed(() => imageView.value.rows);
const moreAfter = computed(() => new Map(imageView.value.more.map((more) => [more.after, more])));
const expansionIds = computed(() => [...new Set([...expanded.value, ...moreAfter.value.keys()])]);
function moreLine(key: string) {
  const more = moreAfter.value.get(key);
  if (!more) return undefined;
  return {
    version: more.version,
    label: t(
      "serviceVersions.image.moreImagesRow",
      { count: more.count, version: more.version },
      more.count,
    ),
    range: raw(` · ${dayRange(more.from, more.to, lang.value)} · `),
    action: t("serviceVersions.image.showThem", {}, more.count),
  };
}
function showImages(version: string) {
  imagesShown.value = new Set([...imagesShown.value, version]);
}
function isBaseline(row: Version) {
  return Boolean(baseline.value && sameBuild(row, baseline.value));
}
function labelOf(row: Version) {
  return versionImageLabel(row.version, row.image, row.version_images, t);
}
function compareLabel(row: Version) {
  const to = latest.value;
  return to ? t("serviceVersions.panel.compareTo", { from: labelOf(row), to: labelOf(to) }) : "";
}
const latest = computed(
  () =>
    [...scoped.value]
      .filter((row) => row.version && !row.restricted)
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (b.deploys?.[0]?.at || b.first_seen) - (a.deploys?.[0]?.at || a.first_seen) ||
          a.version_key.localeCompare(b.version_key),
      )[0],
);
watch([() => props.service, where, org, user, inactive, search], () => {
  selected.value = [];
  expanded.value = [];
  imagesShown.value = new Set();
});
function toggle(key: string) {
  expanded.value = expanded.value.includes(key)
    ? expanded.value.filter((value) => value !== key)
    : [...expanded.value, key];
}
function transitionNote(deploy: Transition) {
  const base = deploy.verdict?.restricted ? "" : deploy.verdict?.baseline?.version;
  const parts = [
    base ? t("serviceVersions.panel.vsBaseline", { version: base }) : "",
    deploy.deploy_key && deploy.deploy_key === latest.value?.deploys?.[0]?.deploy_key
      ? t("serviceVersions.panel.current")
      : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
function select(key: string, checked: boolean) {
  selected.value = checked
    ? [...selected.value, key]
    : selected.value.filter((value) => value !== key);
}
function open(version: string, deployKey?: string, image?: string | null) {
  if (where.value && version)
    void drawer.open({
      service: props.service,
      where: where.value,
      a: version,
      aImage: image || undefined,
      deployKey,
      fromPanel: true,
    });
}
function compareWith(row: PanelRow) {
  if (where.value && latest.value)
    void drawer.open({
      service: props.service,
      where: where.value,
      a: latest.value.version,
      aImage: latest.value.image || undefined,
      b: row.version,
      bImage: row.image || undefined,
      fromPanel: true,
    });
}
function compare() {
  const chosen = rows.value
    .filter((row) => selected.value.includes(row.version_key) && !row.restricted && row.version)
    .sort((a, b) => b.first_seen - a.first_seen || a.version_key.localeCompare(b.version_key));
  if (chosen.length === 2 && chosen[0].where_key === chosen[1].where_key)
    void drawer.open({
      service: props.service,
      where: chosen[0].where_key,
      a: chosen[0].version,
      aImage: chosen[0].image || undefined,
      b: chosen[1].version,
      bImage: chosen[1].image || undefined,
      fromPanel: true,
    });
}
</script>
