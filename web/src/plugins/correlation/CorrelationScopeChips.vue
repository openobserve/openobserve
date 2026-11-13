<template>
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <span class="inline-flex" data-test="svcver-correlation-env-chip"
      ><ServiceEnvChip :identity="scope" :service="scope.service"
    /></span>
    <span class="inline-flex" data-test="svcver-correlation-where"
      ><ServiceScopeChip
        facet="where"
        :where-key="scope.where_key"
        :place="scope.where"
        :reason-tooltip="!byPod"
      /><OTooltip v-if="byPod" side="bottom"
        ><template #content
          ><span class="flex flex-col gap-0.5" data-test="svcver-correlation-where-by-pod"
            ><span
              ><b>{{ whereLabel }}</b
              >{{ raw(" · ") }}{{ t("serviceVersions.correlation.byPod") }}</span
            ><span v-if="podSpansLine" class="opacity-70">{{ podSpansLine }}</span
            ><span v-if="byPod.logCluster" class="opacity-70">{{
              t("serviceVersions.correlation.byPodLogCluster", { cluster: byPod.logCluster })
            }}</span></span
          ></template
        ></OTooltip
      ></span
    >
    <span v-if="shownVersion" class="inline-flex" data-test="svcver-correlation-version"
      ><ServiceScopeChip facet="version" :value="shownVersion"
    /></span>
    <button
      v-if="verdict"
      type="button"
      class="border-accent flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-solid px-1.5 py-0.5"
      data-test="svcver-correlation-rollout-verdict"
      @click="openCompare"
    >
      <span class="text-text-secondary text-xs">{{ verdictLabel }}</span>
      <VerdictChip
        :verdict="verdict"
        :clickable="false"
        test-id="svcver-correlation-verdict-chip"
      />
      <OIcon name="arrow-forward" size="xs" />
    </button>
    <span class="flex-1" />
    <OButton
      variant="outline"
      size="sm-action"
      data-test="svcver-correlation-open-service"
      @click="openService"
    >
      <OIcon name="account-tree" size="xs" class="me-1" />
      {{ t("serviceVersions.correlation.openService") }}
    </OButton>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Scope } from "@/services/service_versions";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ScopeByPod } from "./useCorrelationVersions";
import VerdictChip from "@/enterprise/components/ServiceVersions/VerdictChip.vue";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { verdictCode } from "@/enterprise/components/ServiceVersions/verdictText";
import { compareTitle, versionImageLabel, whereText } from "@/utils/serviceVersionsCopy";
import { shownVersionDetail } from "@/plugins/traces/servicesCatalogVersions";
const props = defineProps<{ scope: Scope; byPod?: ScopeByPod | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const compareDrawer = useVersionCompareDrawer();
const verdict = computed(() => props.scope.newest_verdict ?? null);
// The version serving now, as the catalog row shows it; the newest one may have stopped.
const shownVersion = computed(() => {
  const detail = shownVersionDetail(props.scope);
  const version = props.scope.current_version || props.scope.newest_version || "";
  return version ? versionImageLabel(version, detail.image, detail.versionImages, t) : "";
});
const whereLabel = computed(() => whereText(props.scope.where_key, props.scope.where, t));
const podSpansLine = computed(() => {
  const where = props.scope.where;
  if (!props.byPod || !where?.k8s_cluster || !where.k8s_namespace) return "";
  return t("serviceVersions.correlation.byPodSpans", {
    pod: props.byPod.pod,
    cluster: where.k8s_cluster,
    namespace: where.k8s_namespace,
  });
});
const verdictLabel = computed(() => {
  const value = verdict.value;
  const to = value?.version
    ? versionImageLabel(value.version, value.image, value.version_images, t)
    : shownVersion.value;
  const base = value?.baseline;
  const from = base?.version
    ? versionImageLabel(base.version, base.image, base.version_images, t)
    : "";
  if (!from) return t("serviceVersions.correlation.deployVerdictFirst", { to });
  const { suffix } = compareTitle(
    {
      compared: to,
      baseline: from,
      kind: verdict.value?.deploy?.kind,
      notServing: verdict.value ? verdictCode(verdict.value) === "not_serving" : false,
    },
    t,
  );
  const label = t("serviceVersions.correlation.deployVerdict", { from, to });
  return suffix ? raw(`${label} ${suffix}`) : label;
});
// The correlation drawer has no URL state, so it closes first and Back then closes only the compare drawer.
function openCompare() {
  if (!verdict.value) return;
  emit("close");
  void compareDrawer.open({
    service: props.scope.service,
    where: props.scope.where_key,
    a: verdict.value.version || props.scope.newest_version || "",
    aImage: verdict.value.image || undefined,
    deployKey: verdict.value.deploy_key,
  });
}
function openService() {
  emit("close");
  void router.push({
    name: "traces",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      tab: "services-catalog",
      panel: "versions",
      panelSvc: props.scope.service,
      panelWhere: props.scope.where_key,
    },
  });
}
</script>
